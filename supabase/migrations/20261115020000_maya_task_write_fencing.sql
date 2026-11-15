-- Every state mutation made by a leased worker must prove current lease ownership.
-- A worker whose lease expired or was reassigned cannot overwrite newer task state.
create or replace function public.maya_save_claimed_task(
  p_task_id text,
  p_founder_id text,
  p_worker_id text,
  p_envelope jsonb
)
returns public.maya_tasks
language plpgsql
security definer
set search_path = public
as $$
declare saved public.maya_tasks;
declare previous_status text;
declare next_status text;
begin
  if p_task_id is null or char_length(p_task_id) < 1 or char_length(p_task_id) > 128 then
    raise exception 'Invalid task ID';
  end if;
  if p_founder_id is null or char_length(p_founder_id) < 1 or char_length(p_founder_id) > 256 then
    raise exception 'Invalid Founder ID';
  end if;
  if p_worker_id is null or char_length(p_worker_id) < 1 or char_length(p_worker_id) > 128 then
    raise exception 'Invalid worker ID';
  end if;
  if p_envelope is null
    or p_envelope->'task'->>'id' is distinct from p_task_id
    or p_envelope->'task'->>'founderId' is distinct from p_founder_id then
    raise exception 'Task envelope identity does not match requested owner';
  end if;

  next_status := p_envelope->'task'->>'status';
  if next_status not in ('running', 'verifying', 'completed', 'failed', 'requires_recovery') then
    raise exception 'Invalid claimed task status';
  end if;

  select envelope->'task'->>'status'
    into previous_status
    from public.maya_tasks
    where id = p_task_id
      and founder_id = p_founder_id
      and lease_owner = p_worker_id
      and lease_expires_at > now()
    for update;

  if not found then
    raise exception 'Task lease is missing, expired, or owned by another worker';
  end if;

  if not (
    (previous_status in ('queued', 'awaiting_approval') and next_status = 'running')
    or (previous_status = 'running' and next_status in ('verifying', 'failed', 'requires_recovery'))
    or (previous_status = 'verifying' and next_status in ('completed', 'requires_recovery'))
  ) then
    raise exception 'Task state transition is not permitted for the current leased state';
  end if;

  update public.maya_tasks
    set envelope = p_envelope,
        updated_at = now()
    where id = p_task_id
      and founder_id = p_founder_id
      and lease_owner = p_worker_id
      and lease_expires_at > now()
    returning * into saved;

  if not found then
    raise exception 'Task lease expired or changed before the fenced write completed';
  end if;
  return saved;
end;
$$;

revoke all on function public.maya_save_claimed_task(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.maya_save_claimed_task(text, text, text, jsonb) to service_role;
