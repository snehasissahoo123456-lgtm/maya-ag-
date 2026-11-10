-- Add atomic, Founder-scoped leases for goal-plan workers.
alter table public.maya_goal_plans
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz;

create index if not exists maya_goal_plans_runnable_lease_idx
  on public.maya_goal_plans (founder_id, status, lease_expires_at, updated_at);

create or replace function public.maya_claim_next_goal_plan(
  p_founder_id text,
  p_worker_id text,
  p_lease_ms integer
)
returns setof public.maya_goal_plans
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate public.maya_goal_plans;
begin
  if p_founder_id is null or char_length(p_founder_id) not between 1 and 256 then
    raise exception 'Invalid Founder ID';
  end if;
  if p_worker_id is null or char_length(p_worker_id) not between 1 and 128 then
    raise exception 'Invalid worker ID';
  end if;
  if p_lease_ms is null or p_lease_ms not between 5000 and 300000 then
    raise exception 'Invalid goal-plan lease duration';
  end if;

  select * into candidate
    from public.maya_goal_plans
    where founder_id = p_founder_id
      and status = 'running'
      and (lease_expires_at is null or lease_expires_at <= now())
    order by updated_at asc
    for update skip locked
    limit 1;

  if not found then return; end if;

  return query
    update public.maya_goal_plans
      set lease_owner = p_worker_id,
          lease_expires_at = now() + make_interval(secs => p_lease_ms::double precision / 1000.0),
          updated_at = now()
      where id = candidate.id and founder_id = p_founder_id
      returning *;
end;
$$;

create or replace function public.maya_release_goal_plan_claim(
  p_plan_id text,
  p_founder_id text,
  p_worker_id text
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

  return query
    update public.maya_goal_plans
      set lease_owner = null,
          lease_expires_at = null,
          updated_at = now()
      where id = p_plan_id
        and founder_id = p_founder_id
        and lease_owner = p_worker_id
      returning *;
end;
$$;

revoke all on function public.maya_claim_next_goal_plan(text, text, integer) from public, anon, authenticated;
revoke all on function public.maya_release_goal_plan_claim(text, text, text) from public, anon, authenticated;
grant execute on function public.maya_claim_next_goal_plan(text, text, integer) to service_role;
grant execute on function public.maya_release_goal_plan_claim(text, text, text) to service_role;
