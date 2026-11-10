import assert from "node:assert/strict";
import test from "node:test";
import { validateSelfBuildPlan, SelfBuildPlanValidationError } from "./self-build-planner.ts";

const baselineCommit = "a".repeat(40);
const baseTask = (overrides: Record<string, unknown> = {}) => ({
  id: "implement-core",
  title: "Implement bounded feature",
  objective: "Add the requested feature within the approved workspace.",
  agentId: "developer",
  kind: "implementation",
  files: ["agent-core/new-feature.ts"],
  acceptanceCriteria: ["Typecheck passes", "Behavior is covered by tests"],
  dependsOn: [],
  ...overrides,
});
const validPlan = (overrides: Record<string, unknown> = {}) => ({
  goal: "Improve Maya safely",
  summary: "Plan a bounded implementation and independent test task.",
  baselineCommit,
  workspaceId: "maya-dev-workspace",
  tasks: [
    baseTask(),
    {
      id: "test-core",
      title: "Test the feature",
      objective: "Add regression coverage for the implementation.",
      agentId: "developer",
      kind: "test",
      files: ["agent-core/new-feature.test.ts"],
      acceptanceCriteria: ["Regression tests pass"],
      dependsOn: ["implement-core"],
    },
  ],
  ...overrides,
});

test("accepts a bounded proposal and marks it proposal-only", () => {
  const plan = validateSelfBuildPlan(validPlan(), { now: new Date("2026-11-10T12:00:00.000Z") });
  assert.equal(plan.executionMode, "proposal_only");
  assert.equal(plan.requiresFounderApproval, true);
  assert.equal(plan.requiresIndependentQA, true);
  assert.equal(plan.tasks.length, 2);
});

test("rejects malformed plans and invalid baseline commit hashes", () => {
  assert.throws(() => validateSelfBuildPlan(null), SelfBuildPlanValidationError);
  assert.throws(() => validateSelfBuildPlan(validPlan({ baselineCommit: "main" })), /40-character Git SHA/);
});

test("rejects unregistered agents and non-Developer code assignments", () => {
  const unknown = validPlan();
  (unknown.tasks[0] as Record<string, unknown>).agentId = "unknown-agent";
  assert.throws(() => validateSelfBuildPlan(unknown), /registered Developer or specialist/);
  const wrongRole = validPlan();
  (wrongRole.tasks[0] as Record<string, unknown>).agentId = "research";
  assert.throws(() => validateSelfBuildPlan(wrongRole), /Only the Developer agent/);
});

test("rejects credential, security and infrastructure control paths", () => {
  for (const path of [".env", "agent-core/approval-ledger.ts", "server.ts", ".github/workflows/ci.yml", "supabase/migrations/new.sql"]) {
    const draft = validPlan();
    (draft.tasks[0] as Record<string, unknown>).files = [path];
    assert.throws(() => validateSelfBuildPlan(draft));
  }
});

test("requires every implementation task to have a dependent test task", () => {
  const draft = validPlan();
  draft.tasks = [baseTask()];
  assert.throws(() => validateSelfBuildPlan(draft), /dependent test task/);
});

test("rejects duplicate IDs, unknown dependencies and dependency cycles", () => {
  const duplicate = validPlan();
  duplicate.tasks[1].id = "implement-core";
  assert.throws(() => validateSelfBuildPlan(duplicate), /unique lowercase identifiers/);

  const unknown = validPlan();
  unknown.tasks[1].dependsOn = ["missing-task"];
  assert.throws(() => validateSelfBuildPlan(unknown), /unknown task/);

  const cycle = validPlan();
  cycle.tasks[0].dependsOn = ["test-core"];
  assert.throws(() => validateSelfBuildPlan(cycle), /cycle/);
});

test("enforces task, file and acceptance-criteria budgets", () => {
  const tooManyTasks = validPlan({ tasks: Array.from({ length: 9 }, (_, i) => ({
    ...baseTask({ id: "task-" + i, kind: "documentation" }),
  })) });
  assert.throws(() => validateSelfBuildPlan(tooManyTasks), /bounded tasks/);

  const tooManyFiles = validPlan();
  (tooManyFiles.tasks[0] as Record<string, unknown>).files = Array.from({ length: 13 }, (_, i) => "src/file-" + i + ".ts");
  assert.throws(() => validateSelfBuildPlan(tooManyFiles), /bounded list of target files/);

  const noCriteria = validPlan();
  (noCriteria.tasks[0] as Record<string, unknown>).acceptanceCriteria = [];
  assert.throws(() => validateSelfBuildPlan(noCriteria), /acceptance criteria/);
});

test("marks build configuration changes as elevated risk", () => {
  const draft = validPlan();
  (draft.tasks[0] as Record<string, unknown>).files = ["package.json"];
  const plan = validateSelfBuildPlan(draft);
  assert.equal(plan.tasks[0].risk, "elevated");
});

test("rejects invalid dates and excessive plan budgets", () => {
  assert.throws(() => validateSelfBuildPlan(validPlan(), { now: new Date("invalid") }), /valid Date/);
  assert.throws(() => validateSelfBuildPlan(validPlan(), { policy: { maxTasks: 1 } }), /bounded tasks/);
});
