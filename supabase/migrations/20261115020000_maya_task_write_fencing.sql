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
      and lease_expires_at > clock_timestamp()
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
      and lease_expires_at > clock_timestamp()
    returning * into saved;

  if not found then
    raise exception 'Task lease expired or changed before the fenced write completed';
  end if;
  return saved;
end;
$$;

revoke all on function public.maya_save_claimed_task(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.maya_save_claimed_task(text, text, text, jsonb) to service_role;

-- The queue may lease only read-only work without approval, or explicitly approved
-- write tasks. The worker still verifies the exact argument digest and atomically
-- consumes the one-time grant before executing any write.
drop index if exists public.maya_tasks_safe_claim_idx;
create index maya_tasks_safe_claim_idx
  on public.maya_tasks (founder_id, lease_expires_at, created_at)
  where envelope->'task'->>'status' = 'queued';

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
    from public.maya_tasks t
    where t.founder_id = p_founder_id
      and t.envelope->'task'->>'status' = 'queued'
      and (t.lease_expires_at is null or t.lease_expires_at <= clock_timestamp())
      and (
        (
          t.envelope->>'capability' in (
            'workspace.read_file',
            'device.workspace.read_file',
            'device.workspace.git_status',
            'device.workspace.search_files',
            'device.workspace.list_directory'
          )
          and coalesce(t.envelope->'task'->>'requiresApproval', 'false') = 'false'
        )
        or (
          t.envelope->>'capability' in (
            'workspace.write_file',
            'device.workspace.write_file',
            'device.workspace.create_file',
            'device.workspace.create_directory',
            'device.workspace.move_file'
          )
          and coalesce(t.envelope->'task'->>'requiresApproval', 'false') = 'true'
          and exists (
            select 1
              from public.maya_approvals a
              where a.task_id = t.id
                and a.founder_id = t.founder_id
                and a.capability = t.envelope->>'capability'
                and a.status = 'approved'
                and a.expires_at > now()
          )
        )
      )
    order by t.created_at asc
    limit 1
    for update of t skip locked;

  if not found then return; end if;

  update public.maya_tasks
    set lease_owner = p_worker_id,
        lease_expires_at = clock_timestamp() + (bounded_ms * interval '1 millisecond')
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
    where id = p_task_id
      and founder_id = p_founder_id
      and lease_owner = p_worker_id
      and lease_expires_at > clock_timestamp()
    returning * into released;
  if not found then
    raise exception 'Task lease is expired, missing, or not owned by this Founder and worker';
  end if;
  return next released;
end;
$$;

revoke all on function public.maya_claim_next_task(text, text, integer) from public, anon, authenticated;
revoke all on function public.maya_release_task_claim(text, text, text) from public, anon, authenticated;
grant execute on function public.maya_claim_next_task(text, text, integer) to service_role;
grant execute on function public.maya_release_task_claim(text, text, text) to service_role;
