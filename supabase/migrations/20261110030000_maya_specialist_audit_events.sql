-- Extend the append-only audit event vocabulary for scoped specialist tool calls.
alter table public.maya_audit_events
  drop constraint if exists maya_audit_events_event_type_check;

alter table public.maya_audit_events
  add constraint maya_audit_events_event_type_check
  check (event_type in (
    'task.enqueued', 'task.approval_requested', 'task.approval_decided',
    'task.execution_started', 'task.execution_verified', 'task.execution_failed',
    'specialist.tool_succeeded', 'specialist.tool_denied', 'specialist.tool_failed'
  ));
