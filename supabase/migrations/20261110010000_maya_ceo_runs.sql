-- Persistent Founder-scoped CEO orchestration runs and specialist findings.
create table if not exists public.maya_ceo_runs (
  id text primary key,
  founder_id text not null,
  objective text not null check (length(objective) between 1 and 2000),
  status text not null check (status in ('running', 'completed', 'failed')),
  assignments jsonb not null default '[]'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  summary text null,
  error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  duration_ms integer null check (duration_ms is null or duration_ms >= 0),
  lease_until timestamptz null
);
create index if not exists maya_ceo_runs_founder_created_idx
  on public.maya_ceo_runs (founder_id, created_at desc);
create index if not exists maya_ceo_runs_expired_lease_idx
  on public.maya_ceo_runs (lease_until)
  where status = 'running';

alter table public.maya_ceo_runs enable row level security;
revoke all on public.maya_ceo_runs from anon, authenticated;
grant all on public.maya_ceo_runs to service_role;

create or replace function public.maya_recover_interrupted_ceo_runs()
returns table(recovered integer)
language sql
security definer
set search_path = public
as $$
  with changed as (
    update public.maya_ceo_runs
    set status = 'failed',
        error = 'CEO run lease expired before completion. It was not replayed; start a new reviewed run.',
        updated_at = now(),
        lease_until = null
    where status = 'running'
      and lease_until is not null
      and lease_until < now()
    returning id
  )
  select count(*)::integer from changed;
$$;

revoke all on function public.maya_recover_interrupted_ceo_runs() from public, anon, authenticated;
grant execute on function public.maya_recover_interrupted_ceo_runs() to service_role;
