#!/usr/bin/env bash
set -euo pipefail

psql_cmd=(psql --host 127.0.0.1 --username postgres --dbname maya_ci --set ON_ERROR_STOP=1 --no-align --tuples-only --quiet)
run_sql() { "${psql_cmd[@]}" --command "$1"; }

founder="task-lease-ci-founder"
task_id="task-lease-ci-read"
write_id="task-lease-ci-approved-write"
blocked_id="task-lease-ci-unapproved-write"
recovery_id="task-lease-ci-recovery"

run_sql "
delete from public.maya_tasks where id in ('$task_id', '$write_id', '$blocked_id', '$recovery_id');
delete from public.maya_approvals where task_id in ('$task_id', '$write_id', '$blocked_id', '$recovery_id');
insert into public.maya_tasks (id, founder_id, envelope)
values (
  '$task_id', '$founder',
  jsonb_build_object(
    'task', jsonb_build_object('id', '$task_id', 'founderId', '$founder', 'status', 'queued', 'requiresApproval', false, 'verificationEvidence', '[]'::jsonb),
    'capability', 'workspace.read_file', 'args', jsonb_build_object('path', 'README.md'),
    'attempts', 0, 'idempotencyKey', '$task_id'
  )
);
"

# Two workers racing for one queued task must produce exactly one lease owner.
"${psql_cmd[@]}" --command "select id from public.maya_claim_next_task('$founder', 'worker-a', 60000)" > /tmp/maya-task-claim-a.txt &
pid_a=$!
"${psql_cmd[@]}" --command "select id from public.maya_claim_next_task('$founder', 'worker-b', 60000)" > /tmp/maya-task-claim-b.txt &
pid_b=$!
wait "$pid_a"
wait "$pid_b"
claims=$(cat /tmp/maya-task-claim-a.txt /tmp/maya-task-claim-b.txt | grep -c . || true)
if [[ "$claims" -ne 1 ]]; then
  echo "Expected exactly one concurrent task claim; received $claims"
  cat /tmp/maya-task-claim-a.txt /tmp/maya-task-claim-b.txt
  exit 1
fi
owner=$(run_sql "select lease_owner from public.maya_tasks where id = '$task_id'")
if [[ "$owner" != "worker-a" && "$owner" != "worker-b" ]]; then
  echo "Unexpected task lease owner: $owner"
  exit 1
fi

running_envelope="jsonb_build_object('task', jsonb_build_object('id', '$task_id', 'founderId', '$founder', 'status', 'running', 'requiresApproval', false, 'verificationEvidence', '[]'::jsonb), 'capability', 'workspace.read_file', 'args', jsonb_build_object('path', 'README.md'), 'attempts', 1, 'idempotencyKey', '$task_id')"
run_sql "select (public.maya_save_claimed_task('$task_id', '$founder', '$owner', $running_envelope)).id" >/dev/null

# Renewal is allowed only after the claim has entered an active execution state.
renewed=$(run_sql "select count(*) from public.maya_renew_task_claim('$task_id', '$founder', '$owner', 60000)")
if [[ "$renewed" != "1" ]]; then echo "Exact lease owner could not renew the active task lease"; exit 1; fi

# A different worker must not renew or write the claimed task.
wrong_renew=$(run_sql "do \$\$ begin perform * from public.maya_renew_task_claim('$task_id', '$founder', 'not-owner', 60000); raise exception 'wrong worker renewed lease'; exception when others then if sqlerrm = 'wrong worker renewed lease' then raise; end if; end \$\$")

# A worker that does not own the lease cannot write, and an active task cannot be released.
wrong_write="$(run_sql "do \$\$ begin perform public.maya_save_claimed_task('$task_id', '$founder', 'not-owner', $running_envelope); raise exception 'wrong worker wrote task'; exception when others then if sqlerrm = 'wrong worker wrote task' then raise; end if; end \$\$")"
active_release="$(run_sql "do \$\$ begin perform * from public.maya_release_task_claim('$task_id', '$founder', '$owner'); raise exception 'running task lease was released'; exception when others then if sqlerrm = 'running task lease was released' then raise; end if; end \$\$")"
verifying_envelope="jsonb_build_object('task', jsonb_build_object('id', '$task_id', 'founderId', '$founder', 'status', 'verifying', 'requiresApproval', false, 'verificationEvidence', '[]'::jsonb), 'capability', 'workspace.read_file', 'args', jsonb_build_object('path', 'README.md'), 'attempts', 1, 'idempotencyKey', '$task_id')"
run_sql "select (public.maya_save_claimed_task('$task_id', '$founder', '$owner', $verifying_envelope)).id" >/dev/null
completed_envelope="jsonb_build_object('task', jsonb_build_object('id', '$task_id', 'founderId', '$founder', 'status', 'completed', 'requiresApproval', false, 'verificationEvidence', jsonb_build_array(jsonb_build_object('kind', 'ci', 'description', 'database fence test'))), 'capability', 'workspace.read_file', 'args', jsonb_build_object('path', 'README.md'), 'attempts', 1, 'idempotencyKey', '$task_id')"
run_sql "select (public.maya_save_claimed_task('$task_id', '$founder', '$owner', $completed_envelope)).id" >/dev/null
status=$(run_sql "select envelope->'task'->>'status' from public.maya_tasks where id = '$task_id'")
if [[ "$status" != "completed" ]]; then echo "Fenced task did not reach completed state"; exit 1; fi
released=$(run_sql "select count(*) from public.maya_release_task_claim('$task_id', '$founder', '$owner')")
if [[ "$released" != "1" ]]; then echo "Completed task lease could not be released"; exit 1; fi

# A task without an approved grant must not be claimed.
run_sql "
insert into public.maya_tasks (id, founder_id, envelope)
values ('$blocked_id', '$founder',
  jsonb_build_object('task', jsonb_build_object('id', '$blocked_id', 'founderId', '$founder', 'status', 'queued', 'requiresApproval', true),
  'capability', 'workspace.write_file', 'args', jsonb_build_object('path', 'report.md', 'content', 'x'), 'attempts', 0, 'idempotencyKey', '$blocked_id'));
"
blocked_claim=$(run_sql "select count(*) from public.maya_claim_next_task('$founder', 'worker-a', 60000)")
if [[ "$blocked_claim" != "0" ]]; then echo "Unapproved write task was claimable"; exit 1; fi

# An approved task may be claimed, but the application layer still verifies the exact action digest before execution.
run_sql "
insert into public.maya_tasks (id, founder_id, envelope)
values ('$write_id', '$founder',
  jsonb_build_object('task', jsonb_build_object('id', '$write_id', 'founderId', '$founder', 'status', 'queued', 'requiresApproval', true),
  'capability', 'workspace.write_file', 'args', jsonb_build_object('path', 'report.md', 'content', 'approved'), 'attempts', 0, 'idempotencyKey', '$write_id'));
insert into public.maya_approvals (id, task_id, founder_id, capability, action_digest, requested_at, expires_at, status, decided_at)
values ('approval-task-lease-ci', '$write_id', '$founder', 'workspace.write_file', '45c96a60b8c178229802dfc6289dfebf788a5d7b18978a37faa8172fad110c91',
  clock_timestamp() - interval '1 minute', clock_timestamp() + interval '5 minutes', 'approved', clock_timestamp());
"
approved_claim=$(run_sql "select id from public.maya_claim_next_task('$founder', 'worker-a', 60000)")
if [[ "$approved_claim" != "$write_id" ]]; then echo "Approved write task was not claimable"; exit 1; fi

# A claimed mutation cannot start until its exact one-time approval has been consumed.
unapproved_running="jsonb_build_object('task', jsonb_build_object('id', '$write_id', 'founderId', '$founder', 'status', 'running', 'requiresApproval', true), 'capability', 'workspace.write_file', 'args', jsonb_build_object('path', 'report.md', 'content', 'approved'), 'attempts', 1, 'idempotencyKey', '$write_id')"
unapproved_write="$(run_sql "do \$\$ begin perform public.maya_save_claimed_task('$write_id', '$founder', 'worker-a', $unapproved_running); raise exception 'write started without consumed approval'; exception when others then if sqlerrm = 'write started without consumed approval' then raise; end if; end \$\$")"
consumed=$(run_sql "select count(*) from public.maya_consume_approval('approval-task-lease-ci', '$founder', '$write_id', 'workspace.write_file', '45c96a60b8c178229802dfc6289dfebf788a5d7b18978a37faa8172fad110c91', clock_timestamp())")
if [[ "$consumed" != "1" ]]; then echo "Exact Founder approval could not be consumed"; exit 1; fi
approved_running="jsonb_build_object('task', jsonb_build_object('id', '$write_id', 'founderId', '$founder', 'status', 'running', 'requiresApproval', true, 'approval', jsonb_build_object('approvalId', 'approval-task-lease-ci', 'taskId', '$write_id', 'founderId', '$founder', 'approvedAt', clock_timestamp()::text)), 'capability', 'workspace.write_file', 'args', jsonb_build_object('path', 'report.md', 'content', 'approved'), 'attempts', 1, 'idempotencyKey', '$write_id')"
run_sql "select (public.maya_save_claimed_task('$write_id', '$founder', 'worker-a', $approved_running)).id" >/dev/null
approved_verifying="jsonb_build_object('task', jsonb_build_object('id', '$write_id', 'founderId', '$founder', 'status', 'verifying', 'requiresApproval', true, 'approval', jsonb_build_object('approvalId', 'approval-task-lease-ci', 'taskId', '$write_id', 'founderId', '$founder', 'approvedAt', clock_timestamp()::text)), 'capability', 'workspace.write_file', 'args', jsonb_build_object('path', 'report.md', 'content', 'approved'), 'attempts', 1, 'idempotencyKey', '$write_id')"
run_sql "select (public.maya_save_claimed_task('$write_id', '$founder', 'worker-a', $approved_verifying)).id" >/dev/null
approved_completed="jsonb_build_object('task', jsonb_build_object('id', '$write_id', 'founderId', '$founder', 'status', 'completed', 'requiresApproval', true, 'approval', jsonb_build_object('approvalId', 'approval-task-lease-ci', 'taskId', '$write_id', 'founderId', '$founder', 'approvedAt', clock_timestamp()::text), 'verificationEvidence', jsonb_build_array(jsonb_build_object('kind', 'ci', 'description', 'approved write fence test'))), 'capability', 'workspace.write_file', 'args', jsonb_build_object('path', 'report.md', 'content', 'approved'), 'attempts', 1, 'idempotencyKey', '$write_id')"
run_sql "select (public.maya_save_claimed_task('$write_id', '$founder', 'worker-a', $approved_completed)).id" >/dev/null
write_released=$(run_sql "select count(*) from public.maya_release_task_claim('$write_id', '$founder', 'worker-a')")
if [[ "$write_released" != "1" ]]; then echo "Approved write task lease could not be released"; exit 1; fi

# An in-flight lease cannot be released; after expiry, recovery parks it instead of replaying it.
run_sql "
insert into public.maya_tasks (id, founder_id, envelope, lease_owner, lease_expires_at)
values ('$recovery_id', '$founder',
  jsonb_build_object('task', jsonb_build_object('id', '$recovery_id', 'founderId', '$founder', 'status', 'running', 'requiresApproval', false),
  'capability', 'workspace.read_file', 'args', jsonb_build_object('path', 'README.md'), 'attempts', 1, 'idempotencyKey', '$recovery_id'),
  'worker-stale', clock_timestamp() - interval '1 second');
"
release_active="$(run_sql "do \$\$ begin perform * from public.maya_release_task_claim('$recovery_id', '$founder', 'worker-stale'); raise exception 'active lease was released'; exception when others then if sqlerrm = 'active lease was released' then raise; end if; end \$\$")"
recovered=$(run_sql "select recovered from public.maya_recover_expired_task_claims('$founder')")
if [[ "$recovered" -lt 1 ]]; then echo "Expired in-flight task was not recovered"; exit 1; fi
recovery_status=$(run_sql "select envelope->'task'->>'status' from public.maya_tasks where id = '$recovery_id'")
if [[ "$recovery_status" != "requires_recovery" ]]; then echo "Expired in-flight task was not parked for recovery"; exit 1; fi

echo "PostgreSQL task claim concurrency, renewal, lease fencing, approved-write gating, release and expiry recovery checks passed."
