-- Allow durable CEO specialist assignments through the shared task queue.
-- The specialist capability is low-risk and its runtime is restricted to manifest-scoped read-only tools.
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
            'device.workspace.list_directory',
            'ceo.specialist.run'
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
                and a.expires_at > clock_timestamp()
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

revoke all on function public.maya_claim_next_task(text, text, integer) from public, anon, authenticated;
grant execute on function public.maya_claim_next_task(text, text, integer) to service_role;
