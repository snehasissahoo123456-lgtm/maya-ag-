-- The legacy conversation migration created maya_goal_plans before the stricter
-- goal-plan migration existed. CREATE TABLE IF NOT EXISTS does not retrofit checks,
-- so add and verify the constraints explicitly for both fresh and upgraded databases.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.maya_goal_plans'::regclass
      and conname = 'maya_goal_plans_id_length_check'
  ) then
    alter table public.maya_goal_plans
      add constraint maya_goal_plans_id_length_check
      check (char_length(id) between 1 and 128);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.maya_goal_plans'::regclass
      and conname = 'maya_goal_plans_founder_length_check'
  ) then
    alter table public.maya_goal_plans
      add constraint maya_goal_plans_founder_length_check
      check (char_length(founder_id) between 1 and 256);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.maya_goal_plans'::regclass
      and conname = 'maya_goal_plans_plan_shape_check'
  ) then
    alter table public.maya_goal_plans
      add constraint maya_goal_plans_plan_shape_check
      check (
        case
          when jsonb_typeof(plan) = 'object' and jsonb_typeof(plan->'steps') = 'array'
            then char_length(coalesce(plan->>'objective', '')) between 1 and 2000
          else false
        end
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.maya_goal_plans'::regclass
      and conname = 'maya_goal_plans_step_states_shape_check'
  ) then
    alter table public.maya_goal_plans
      add constraint maya_goal_plans_step_states_shape_check
      check (jsonb_typeof(step_states) = 'object');
  end if;
end;
$$;
