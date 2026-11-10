-- Founder-scoped recurring read-only schedules with cross-process worker leases.
create table if not exists public.maya_scheduled_jobs (
  id text primary key,
  founder_id text not null,
  title text not null check (length(title) between 1 and 160),
  path text not null check (length(path) between 1 and 1024),
  status text not null check (status in ('active', 'paused', 'completed')),
  next_run_at timestamptz not null,
  interval_ms bigint null check (interval_ms is null or interval_ms between 60000 and 2592000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_run_at timestamptz null,
  run_count integer not null default 0 check (run_count >= 0),
  failure_count integer not null default 0 check (failure_count >= 0),
  last_error text null,
  lease_owner text null,
  lease_until timestamptz null
);

create index if not exists maya_scheduled_jobs_due_idx
  on public.maya_scheduled_jobs (founder_id, next_run_at)
  where status = 'active';
create index if not exists maya_scheduled_jobs_lease_idx
  on public.maya_scheduled_jobs (lease_until)
  where lease_owner is not null;

alter table public.maya_scheduled_jobs enable row level security;
revoke all on public.maya_scheduled_jobs from anon, authenticated;
grant all on public.maya_scheduled_jobs to service_role;

create or replace function public.maya_claim_due_scheduled_jobs(
  p_founder_id text,
  p_worker_id text,
  p_lease_ms integer,
  p_limit integer
)
returns setof public.maya_scheduled_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_founder_id is null or length(p_founder_id) < 1 or length(p_founder_id) > 256 then raise exception 'Invalid Founder ID'; end if;
  if p_worker_id is null or length(p_worker_id) < 1 or length(p_worker_id) > 128 then raise exception 'Invalid worker ID'; end if;
  if p_lease_ms < 5000 or p_lease_ms > 300000 then raise exception 'Invalid lease duration'; end if;
  if p_limit < 1 or p_limit > 100 then raise exception 'Invalid claim limit'; end if;

  return query
    with due as (
      select id
      from public.maya_scheduled_jobs
      where founder_id = p_founder_id
        and status = 'active'
        and next_run_at <= now()
        and (lease_until is null or lease_until <= now())
      order by next_run_at
      limit p_limit
      for update skip locked
    )
    update public.maya_scheduled_jobs as job
      set lease_owner = p_worker_id,
          lease_until = now() + (p_lease_ms * interval '1 millisecond'),
          updated_at = now()
      from due
      where job.id = due.id
      returning job.*;
end;
$$;

create or replace function public.maya_complete_scheduled_job(
  p_founder_id text,
  p_job_id text,
  p_worker_id text,
  p_scheduled_at timestamptz,
  p_next_run_at timestamptz
)
returns setof public.maya_scheduled_jobs
language sql
security definer
set search_path = public
as $$
  update public.maya_scheduled_jobs
  set last_run_at = p_scheduled_at,
      run_count = run_count + 1,
      failure_count = 0,
      last_error = null,
      status = case when p_next_run_at is null then 'completed' else 'active' end,
      next_run_at = coalesce(p_next_run_at, next_run_at),
      lease_owner = null,
      lease_until = null,
      updated_at = now()
  where id = p_job_id
    and founder_id = p_founder_id
    and status = 'active'
    and next_run_at = p_scheduled_at
    and lease_owner = p_worker_id
    and lease_until > now()
  returning *;
$$;

create or replace function public.maya_fail_scheduled_job(
  p_founder_id text,
  p_job_id text,
  p_worker_id text,
  p_error text
)
returns setof public.maya_scheduled_jobs
language sql
security definer
set search_path = public
as $$
  update public.maya_scheduled_jobs
  set failure_count = failure_count + 1,
      last_error = left(coalesce(p_error, 'Unknown scheduler error'), 1000),
      status = case when failure_count + 1 >= 3 then 'paused' else 'active' end,
      lease_owner = null,
      lease_until = null,
      updated_at = now()
  where id = p_job_id
    and founder_id = p_founder_id
    and status = 'active'
    and lease_owner = p_worker_id
    and lease_until > now()
  returning *;
$$;

create or replace function public.maya_pause_scheduled_job(p_founder_id text, p_job_id text)
returns setof public.maya_scheduled_jobs
language sql
security definer
set search_path = public
as $$
  update public.maya_scheduled_jobs
  set status = 'paused', lease_owner = null, lease_until = null, updated_at = now()
  where id = p_job_id and founder_id = p_founder_id and status = 'active'
  returning *;
$$;

revoke all on function public.maya_claim_due_scheduled_jobs(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.maya_complete_scheduled_job(text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.maya_fail_scheduled_job(text, text, text, text) from public, anon, authenticated;
revoke all on function public.maya_pause_scheduled_job(text, text) from public, anon, authenticated;
grant execute on function public.maya_claim_due_scheduled_jobs(text, text, integer, integer) to service_role;
grant execute on function public.maya_complete_scheduled_job(text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.maya_fail_scheduled_job(text, text, text, text) to service_role;
grant execute on function public.maya_pause_scheduled_job(text, text) to service_role;
