-- Renew only a live task lease owned by the exact Founder and worker.
-- Expired leases cannot be resurrected; recovery owns that transition.
create or replace function public.maya_renew_task_claim(
  p_task_id text,
  p_founder_id text,
  p_worker_id text,
  p_lease_ms integer
)
returns setof public.maya_tasks
language plpgsql
security definer
set search_path = public
as $$
declare renewed public.maya_tasks;
declare bounded_ms integer;
begin
  if p_task_id is null or char_length(p_task_id) < 1 or char_length(p_task_id) > 256 then
    raise exception 'Invalid task ID';
  end if;
  if p_founder_id is null or char_length(p_founder_id) < 1 or char_length(p_founder_id) > 256 then
    raise exception 'Invalid Founder ID';
  end if;
  if p_worker_id is null or char_length(p_worker_id) < 1 or char_length(p_worker_id) > 128 then
    raise exception 'Invalid worker ID';
  end if;
  bounded_ms := greatest(5000, least(coalesce(p_lease_ms, 60000), 300000));

  update public.maya_tasks
    set lease_expires_at = now() + (bounded_ms * interval '1 millisecond'),
        updated_at = now()
    where id = p_task_id
      and founder_id = p_founder_id
      and lease_owner = p_worker_id
      and lease_expires_at > now()
      and envelope->'task'->>'status' in ('running', 'verifying')
    returning * into renewed;

  if not found then
    raise exception 'Task lease is missing, expired, not active, or owned by another worker';
  end if;
  return next renewed;
end;
$$;

revoke all on function public.maya_renew_task_claim(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.maya_renew_task_claim(text, text, text, integer) to service_role;
