-- Append-only, Founder-scoped Maya audit events.
create table if not exists public.maya_audit_events (
  id uuid primary key,
  founder_id text not null,
  actor_id text not null,
  actor_role text not null,
  event_type text not null check (event_type in (
    'task.enqueued', 'task.approval_requested', 'task.approval_decided',
    'task.execution_started', 'task.execution_verified', 'task.execution_failed',
    'specialist.tool_succeeded', 'specialist.tool_denied', 'specialist.tool_failed'
  )),
  task_id text not null,
  capability text not null,
  action_digest char(64) not null check (action_digest ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (octet_length(metadata::text) <= 8000)
);

create index if not exists maya_audit_events_founder_time_idx
  on public.maya_audit_events (founder_id, occurred_at desc);

alter table public.maya_audit_events enable row level security;
revoke all on public.maya_audit_events from anon, authenticated;
grant select, insert on public.maya_audit_events to service_role;
revoke update, delete, truncate on public.maya_audit_events from service_role;

-- Deliberately no UPDATE or DELETE function: audit rows are append-only.
