-- Safe, repeatable legacy conversation backfill and renewable goal-plan leases.
-- Legacy JSONB remains intact after import; structured-only parts are retained as JSON text
-- because the current message table has a text-only payload contract.

alter table public.maya_conversations
  add column if not exists legacy_messages_backfilled_at timestamptz;

create or replace function public.maya_backfill_legacy_conversations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation_row public.maya_conversations;
  legacy_message jsonb;
  message_role text;
  message_content text;
  message_index bigint;
  inserted_count integer := 0;
  affected_count integer := 0;
begin
  for conversation_row in
    select *
    from public.maya_conversations
    where legacy_messages_backfilled_at is null
    order by created_at, id
    for update
  loop
    if conversation_row.messages is null or jsonb_typeof(conversation_row.messages) <> 'array' then
      raise exception 'Legacy conversation % has a non-array messages value; refusing lossy migration', conversation_row.id;
    end if;

    for legacy_message, message_index in
      select value, ordinality
      from jsonb_array_elements(conversation_row.messages) with ordinality
    loop
      message_role := lower(coalesce(legacy_message->>'role', ''));
      if message_role = 'user' then
        message_role := 'user';
      elsif message_role in ('assistant', 'model') then
        message_role := 'model';
      else
        raise exception 'Legacy conversation % message % has unsupported role "%"; refusing lossy migration',
          conversation_row.id, message_index, message_role;
      end if;

      message_content := coalesce(
        nullif(legacy_message->>'content', ''),
        nullif(legacy_message->>'text', ''),
        (
          select nullif(string_agg(part.value->>'text', '' order by part.ordinality), '')
          from jsonb_array_elements(
            case when jsonb_typeof(legacy_message->'parts') = 'array'
              then legacy_message->'parts' else '[]'::jsonb end
          ) with ordinality as part(value, ordinality)
          where jsonb_typeof(part.value) = 'object'
            and nullif(part.value->>'text', '') is not null
        ),
        legacy_message::text
      );

      insert into public.maya_conversation_messages (
        id, conversation_id, founder_id, role, content, created_at
      )
      values (
        (
          substr(md5(conversation_row.id || ':' || message_index::text), 1, 8) || '-' ||
          substr(md5(conversation_row.id || ':' || message_index::text), 9, 4) || '-' ||
          substr(md5(conversation_row.id || ':' || message_index::text), 13, 4) || '-' ||
          substr(md5(conversation_row.id || ':' || message_index::text), 17, 4) || '-' ||
          substr(md5(conversation_row.id || ':' || message_index::text), 21, 12)
        )::uuid,
        conversation_row.id,
        conversation_row.founder_id,
        message_role,
        message_content,
        conversation_row.created_at + (message_index * interval '1 microsecond')
      )
      on conflict (id) do nothing;

      get diagnostics affected_count = row_count;
      inserted_count := inserted_count + affected_count;
    end loop;

    update public.maya_conversations
      set legacy_messages_backfilled_at = now()
      where id = conversation_row.id and founder_id = conversation_row.founder_id;
  end loop;

  return inserted_count;
end;
$$;

revoke all on function public.maya_backfill_legacy_conversations() from public, anon, authenticated;
grant execute on function public.maya_backfill_legacy_conversations() to service_role;

-- Run the import in the migration transaction. Any unsupported role aborts the
-- transaction rather than silently dropping or misclassifying a legacy message.
select public.maya_backfill_legacy_conversations();

create or replace function public.maya_renew_goal_plan_claim(
  p_plan_id text,
  p_founder_id text,
  p_worker_id text,
  p_lease_ms integer
)
returns setof public.maya_goal_plans
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_plan_id is null or p_founder_id is null or p_worker_id is null then
    raise exception 'Plan, Founder and worker identities are required';
  end if;
  if p_lease_ms is null or p_lease_ms not between 5000 and 300000 then
    raise exception 'Invalid goal-plan lease duration';
  end if;

  return query
    update public.maya_goal_plans
      set lease_expires_at = now() + make_interval(secs => p_lease_ms::double precision / 1000.0),
          updated_at = now()
      where id = p_plan_id
        and founder_id = p_founder_id
        and lease_owner = p_worker_id
        and lease_expires_at > now()
      returning *;
end;
$$;

revoke all on function public.maya_renew_goal_plan_claim(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.maya_renew_goal_plan_claim(text, text, text, integer) to service_role;
