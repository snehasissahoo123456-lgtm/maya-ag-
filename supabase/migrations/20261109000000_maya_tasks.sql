-- Founder-scoped durable task envelopes.
-- Browser roles have no table or RPC access. Only the server service role can write.
create table if not exists public.maya_tasks (
  id text primary key,
  founder_id text not null,
  envelope jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maya_tasks_envelope_identity check (
    envelope->'task'->>'id' = id
    and envelope->'task'->>'founderId' = founder_id
  )
);
create index if not exists maya_tasks_founder_updated_idx on public.maya_tasks (founder_id, updated_at asc);
alter table public.maya_tasks enable row level security;
revoke all on public.maya_tasks from anon, authenticated;
grant all on public.maya_tasks to service_role;

create or replace function public.maya_save_task(p_task_id text, p_founder_id text, p_envelope jsonb)
returns setof public.maya_tasks
language plpgsql security definer set search_path = public
as $$
begin
  if p_task_id is null or length(p_task_id) < 1 or length(p_task_id) > 128 then raise exception 'Invalid task ID'; end if;
  if p_founder_id is null or length(p_founder_id) < 1 or length(p_founder_id) > 256 then raise exception 'Invalid Founder ID'; end if;
  if p_envelope is null or p_envelope->'task'->>'id' is distinct from p_task_id
    or p_envelope->'task'->>'founderId' is distinct from p_founder_id then
    raise exception 'Task envelope identity does not match requested owner';
  end if;
  return query
    insert into public.maya_tasks (id, founder_id, envelope, created_at, updated_at)
    values (p_task_id, p_founder_id, p_envelope, now(), now())
    on conflict (id) do update set envelope = excluded.envelope, updated_at = now()
    where public.maya_tasks.founder_id = excluded.founder_id
    returning *;
end;
$$;
revoke all on function public.maya_save_task(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.maya_save_task(text, text, jsonb) to service_role;
