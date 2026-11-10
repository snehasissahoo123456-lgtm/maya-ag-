import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migration = (name: string) => fs.readFileSync(
  path.join(process.cwd(), "supabase", "migrations", name),
  "utf8",
);

test("task save RPC keeps the scalar row contract expected by SupabaseTaskRepository", () => {
  const initial = migration("20261108010000_maya_tasks.sql");
  const followup = migration("20261109000000_maya_tasks.sql");
  assert.match(initial, /returns\s+public\.maya_tasks/i);
  assert.match(followup, /returns\s+public\.maya_tasks/i);
  assert.doesNotMatch(followup, /returns\s+setof\s+public\.maya_tasks/i);
  assert.match(followup, /returning\s+\*\s+into\s+saved/i);
});

test("goal-plan claim query places LIMIT before the PostgreSQL locking clause", () => {
  const sql = migration("20261110040000_maya_goal_plan_leases.sql");
  const claim = sql.match(/select\s+\*\s+into\s+candidate[\s\S]*?;/i)?.[0] || "";
  assert.ok(claim, "claim SELECT must exist");
  assert.ok(claim.indexOf("limit 1") >= 0, "claim must be bounded to one plan");
  assert.ok(claim.indexOf("for update skip locked") > claim.indexOf("limit 1"),
    "PostgreSQL SELECT syntax requires the row-locking clause after LIMIT");
});

test("goal-plan constraints are added to the legacy-created table", () => {
  const sql = migration("20261110060000_maya_goal_plan_constraints.sql");
  assert.match(sql, /maya_goal_plans_id_length_check/);
  assert.match(sql, /maya_goal_plans_founder_length_check/);
  assert.match(sql, /maya_goal_plans_plan_shape_check/);
  assert.match(sql, /maya_goal_plans_step_states_shape_check/);
  assert.match(sql, /case[\\s\\S]*jsonb_typeof/i);
});

test("conversation storage compatibility adds the JSONB messages column and immutable owner trigger", () => {
  const sql = migration("20261110050000_maya_conversation_schema_compat.sql");
  assert.match(sql, /add column if not exists messages jsonb/i);
  assert.match(sql, /maya_conversations_owner_immutable/);
  assert.match(sql, /maya_prevent_conversation_owner_change/);
});
