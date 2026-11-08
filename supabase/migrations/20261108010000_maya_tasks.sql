-- Founder-scoped task envelopes for Maya's durable task queue.
create table if not exists public.maya_tasks (
  id text primary key,
  founder_id text not null,
  envelope jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maya_tasks_envelope_owner_check check (envelope->'task'->>'founderId' = founder_id),
  constraint maya_tasks_envelope_id_check check (envelope->'task'->>'id' = id)
);

create index if not exists maya_tasks_founder_updated_idx
  on public.maya_tasks (founder_id, updated_at desc);

alter table public.maya_tasks enable row level security;
revoke all on public.maya_tasks from anon, authenticated;
grant all on public.maya_tasks to service_role;

-- Atomic owner-bound insert/update. A task ID can never be reassigned to another Founder.
create or replace function public.maya_save_task(
  p_task_id text,
  p_founder_id text,
  p_envelope jsonb
)
returns public.maya_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.maya_tasks;
begin
  if p_task_id is null or char_length(p_task_id) < 1 or char_length(p_task_id) > 128 then
    raise exception 'Invalid task ID';
  end if;
  if p_founder_id is null or char_length(p_founder_id) < 1 or char_length(p_founder_id) > 256 then
    raise exception 'Invalid Founder ID';
  end if;
  if p_envelope->'task'->>'id' <> p_task_id or p_envelope->'task'->>'founderId' <> p_founder_id then
    raise exception 'Task envelope identity does not match the requested owner';
  end if;

  insert into public.maya_tasks (id, founder_id, envelope, created_at, updated_at)
    values (p_task_id, p_founder_id, p_envelope, now(), now())
  on conflict (id) do update
    set envelope = excluded.envelope, updated_at = now()
    where maya_tasks.founder_id = excluded.founder_id
  returning * into saved;

  if not found then
    raise exception 'Task ID is already owned by another Founder or write was not applied';
  end if;
  return saved;
end;
$$;

revoke all on function public.maya_save_task(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.maya_save_task(text, text, jsonb) to service_role;
