#!/usr/bin/env bash
set -euo pipefail

psql --host 127.0.0.1 --username postgres --dbname maya_ci --set ON_ERROR_STOP=1 --quiet <<'SQL'
delete from public.maya_goal_plans where id = 'goal-plan-lease-concurrency-ci';
insert into public.maya_goal_plans (id, founder_id, plan, status, step_states)
values (
  'goal-plan-lease-concurrency-ci',
  'founder-lease-ci',
  '{"objective":"CI lease test","summary":"Verify atomic claims","executionMode":"plan_only","steps":[]}'::jsonb,
  'running',
  '{}'::jsonb
);
SQL

psql --host 127.0.0.1 --username postgres --dbname maya_ci --no-align --tuples-only --quiet \
  --set ON_ERROR_STOP=1 \
  --command "select id from public.maya_claim_next_goal_plan('founder-lease-ci', 'worker-a', 5000)" > /tmp/maya-claim-a.txt &
pid_a=$!
psql --host 127.0.0.1 --username postgres --dbname maya_ci --no-align --tuples-only --quiet \
  --set ON_ERROR_STOP=1 \
  --command "select id from public.maya_claim_next_goal_plan('founder-lease-ci', 'worker-b', 5000)" > /tmp/maya-claim-b.txt &
pid_b=$!
wait "$pid_a"
wait "$pid_b"

claims=$(cat /tmp/maya-claim-a.txt /tmp/maya-claim-b.txt | grep -c . || true)
if [[ "$claims" -ne 1 ]]; then
  echo "Expected exactly one concurrent worker claim; received $claims"
  cat /tmp/maya-claim-a.txt /tmp/maya-claim-b.txt
  exit 1
fi

owner=$(psql --host 127.0.0.1 --username postgres --dbname maya_ci --no-align --tuples-only --quiet \
  --set ON_ERROR_STOP=1 \
  --command "select lease_owner from public.maya_goal_plans where id = 'goal-plan-lease-concurrency-ci'")
if [[ "$owner" != "worker-a" && "$owner" != "worker-b" ]]; then
  echo "Unexpected lease owner: $owner"
  exit 1
fi

renewed=$(psql --host 127.0.0.1 --username postgres --dbname maya_ci --no-align --tuples-only --quiet \
  --set ON_ERROR_STOP=1 \
  --command "select count(*) from public.maya_renew_goal_plan_claim('goal-plan-lease-concurrency-ci', 'founder-lease-ci', '$owner', 5000)")
if [[ "$renewed" != "1" ]]; then
  echo "The active worker could not renew its lease"
  exit 1
fi

wrong_owner=$(psql --host 127.0.0.1 --username postgres --dbname maya_ci --no-align --tuples-only --quiet \
  --set ON_ERROR_STOP=1 \
  --command "select count(*) from public.maya_renew_goal_plan_claim('goal-plan-lease-concurrency-ci', 'founder-lease-ci', 'not-the-owner', 5000)")
if [[ "$wrong_owner" != "0" ]]; then
  echo "A non-owner unexpectedly renewed the goal-plan lease"
  exit 1
fi

released=$(psql --host 127.0.0.1 --username postgres --dbname maya_ci --no-align --tuples-only --quiet \
  --set ON_ERROR_STOP=1 \
  --command "select count(*) from public.maya_release_goal_plan_claim('goal-plan-lease-concurrency-ci', 'founder-lease-ci', '$owner')")
if [[ "$released" != "1" ]]; then
  echo "The lease owner could not release its claim"
  exit 1
fi

echo "PostgreSQL goal-plan lease concurrency, renewal, owner isolation, and release checks passed."
