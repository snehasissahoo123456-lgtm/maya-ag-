-- Founder-scoped persisted goal plans used by SupabaseGoalPlanStore.
create table if not exists public.maya_goal_plans (
  id text primary key,
  founder_id text not null,
  plan jsonb not null,
  status text not null check (status in ('proposed', 'running', 'awaiting_approval', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  step_states jsonb not null default '{}'::jsonb,
  constraint maya_goal_plans_owner_check check (length(founder_id) between 1 and 256),
  constraint maya_goal_plans_id_check check (length(id) between 1 and 128),
  constraint maya_goal_plans_objective_check check (
    jsonb_typeof(plan) = 'object'
    and jsonb_typeof(plan->'steps') = 'array'
    and length(coalesce(plan->>'objective', '')) between 1 and 2000
  ),
  constraint maya_goal_plans_step_states_check check (jsonb_typeof(step_states) = 'object')
);

create index if not exists maya_goal_plans_founder_updated_idx
  on public.maya_goal_plans (founder_id, updated_at desc);

alter table public.maya_goal_plans enable row level security;
revoke all on public.maya_goal_plans from anon, authenticated;
grant all on public.maya_goal_plans to service_role;

-- A plan ID can never be reassigned to another Founder.
create or replace function public.maya_prevent_goal_plan_owner_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.founder_id <> old.founder_id then
    raise exception 'Goal plan ownership cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists maya_goal_plans_owner_immutable on public.maya_goal_plans;
create trigger maya_goal_plans_owner_immutable
  before update on public.maya_goal_plans
  for each row execute function public.maya_prevent_goal_plan_owner_change();

revoke all on function public.maya_prevent_goal_plan_owner_change() from public, anon, authenticated;
