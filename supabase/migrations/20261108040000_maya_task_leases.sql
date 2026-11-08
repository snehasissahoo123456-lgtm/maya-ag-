-- Atomic leases for the narrowly scoped, read-only Supabase task worker.
alter table public.maya_tasks
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz;

create index if not exists maya_tasks_safe_claim_idx
  on public.maya_tasks (founder_id, lease_expires_at, created_at)
  where envelope->>'capability' = 'workspace.read_file'
    and envelope->'task'->>'status' = 'queued'
    and coalesce(envelope->'task'->>'requiresApproval', 'false') = 'false';

create or replace function public.maya_claim_next_task(
  p_founder_id text,
  p_worker_id text,
  p_lease_ms integer
)
returns setof public.maya_tasks
language plpgsql
security definer
set search_path = public
as $$
declare candidate public.maya_tasks;
declare bounded_ms integer;
begin
  if p_founder_id is null or char_length(p_founder_id) < 1 or char_length(p_founder_id) > 256 then
    raise exception 'Invalid Founder ID';
  end if;
  if p_worker_id is null or char_length(p_worker_id) < 1 or char_length(p_worker_id) > 128 then
    raise exception 'Invalid worker ID';
  end if;
  bounded_ms := greatest(5000, least(coalesce(p_lease_ms, 60000), 300000));

  select * into candidate
    from public.maya_tasks
    where founder_id = p_founder_id
      and envelope->>'capability' = 'workspace.read_file'
      and envelope->'task'->>'status' = 'queued'
      and coalesce(envelope->'task'->>'requiresApproval', 'false') = 'false'
      and (lease_expires_at is null or lease_expires_at <= now())
    order by created_at asc
    for update skip locked
    limit 1;

  if not found then return; end if;

  update public.maya_tasks
    set lease_owner = p_worker_id,
        lease_expires_at = now() + (bounded_ms * interval '1 millisecond')
    where id = candidate.id and founder_id = p_founder_id
    returning * into candidate;

  return next candidate;
end;
$$;

create or replace function public.maya_release_task_claim(
  p_task_id text,
  p_founder_id text,
  p_worker_id text
)
returns setof public.maya_tasks
language plpgsql
security definer
set search_path = public
as $$
declare released public.maya_tasks;
begin
  update public.maya_tasks
    set lease_owner = null, lease_expires_at = null
    where id = p_task_id and founder_id = p_founder_id and lease_owner = p_worker_id
    returning * into released;
  if not found then raise exception 'Task lease not found for this Founder and worker'; end if;
  return next released;
end;
$$;

create or replace function public.maya_recover_expired_task_claims(p_founder_id text)
returns table(recovered integer)
language plpgsql
security definer
set search_path = public
as $$
declare changed_count integer;
begin
  update public.maya_tasks
    set envelope = jsonb_set(
      jsonb_set(envelope, '{task,status}', to_jsonb('requires_recovery'::text), true),
      '{task,lastError}', to_jsonb('Worker lease expired during execution; inspect side effects before retrying.'::text), true
    ),
    updated_at = now(), lease_owner = null, lease_expires_at = null
    where founder_id = p_founder_id
      and lease_expires_at <= now()
      and envelope->'task'->>'status' in ('running', 'verifying');
  get diagnostics changed_count = row_count;
  return query select changed_count;
end;
$$;

revoke all on function public.maya_claim_next_task(text, text, integer) from public, anon, authenticated;
revoke all on function public.maya_release_task_claim(text, text, text) from public, anon, authenticated;
revoke all on function public.maya_recover_expired_task_claims(text) from public, anon, authenticated;
grant execute on function public.maya_claim_next_task(text, text, integer) to service_role;
grant execute on function public.maya_release_task_claim(text, text, text) to service_role;
grant execute on function public.maya_recover_expired_task_claims(text) to service_role;
