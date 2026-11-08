-- Durable, exact-action Founder approvals with atomic decision and single-use consumption.
create table if not exists public.maya_approvals (
  id text primary key,
  task_id text not null,
  founder_id text not null,
  capability text not null,
  action_digest char(64) not null check (action_digest ~ '^[a-f0-9]{64}$'),
  requested_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null check (status in ('pending', 'approved', 'rejected', 'consumed', 'expired')),
  decided_at timestamptz,
  check (expires_at > requested_at),
  check ((status in ('approved', 'rejected', 'consumed') and decided_at is not null) or status in ('pending', 'expired'))
);

create index if not exists maya_approvals_founder_requested_idx
  on public.maya_approvals (founder_id, requested_at desc);
create index if not exists maya_approvals_task_status_idx
  on public.maya_approvals (founder_id, task_id, status);

alter table public.maya_approvals enable row level security;
revoke all on public.maya_approvals from anon, authenticated;
grant select, insert on public.maya_approvals to service_role;
revoke update, delete, truncate on public.maya_approvals from service_role;

create or replace function public.maya_decide_approval(
  p_approval_id text,
  p_founder_id text,
  p_approved boolean,
  p_now timestamptz
)
returns setof public.maya_approvals
language plpgsql
security definer
set search_path = public
as $$
declare changed public.maya_approvals;
begin
  update public.maya_approvals
    set status = 'expired'
    where id = p_approval_id and founder_id = p_founder_id
      and status = 'pending' and expires_at <= p_now
    returning * into changed;
  if found then
    return next changed;
    return;
  end if;

  update public.maya_approvals
    set status = case when p_approved then 'approved' else 'rejected' end,
        decided_at = p_now
    where id = p_approval_id and founder_id = p_founder_id
      and status = 'pending' and expires_at > p_now
    returning * into changed;
  if not found then
    raise exception 'Approval not found for this Founder or no longer pending';
  end if;
  return next changed;
end;
$$;

create or replace function public.maya_consume_approval(
  p_approval_id text,
  p_founder_id text,
  p_task_id text,
  p_capability text,
  p_action_digest char(64),
  p_now timestamptz
)
returns setof public.maya_approvals
language plpgsql
security definer
set search_path = public
as $$
declare changed public.maya_approvals;
begin
  update public.maya_approvals
    set status = 'expired'
    where id = p_approval_id and founder_id = p_founder_id and task_id = p_task_id
      and status = 'approved' and expires_at <= p_now
    returning * into changed;
  if found then
    return next changed;
    return;
  end if;

  update public.maya_approvals
    set status = 'consumed'
    where id = p_approval_id and founder_id = p_founder_id and task_id = p_task_id
      and capability = p_capability and action_digest = p_action_digest
      and status = 'approved' and expires_at > p_now
    returning * into changed;
  if not found then
    raise exception 'Approval is invalid, expired, already consumed, or does not match the exact action';
  end if;
  return next changed;
end;
$$;

revoke all on function public.maya_decide_approval(text, text, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.maya_consume_approval(text, text, text, text, char, timestamptz) from public, anon, authenticated;
grant execute on function public.maya_decide_approval(text, text, boolean, timestamptz) to service_role;
grant execute on function public.maya_consume_approval(text, text, text, text, char, timestamptz) to service_role;
