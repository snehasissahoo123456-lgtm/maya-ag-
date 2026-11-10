import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SelfBuildPlanStore } from "./self-build-plan-store.ts";

const baselineCommit = "b".repeat(40);
const proposal = () => ({
  goal: "Persist a bounded Maya self-build proposal",
  summary: "A small plan with implementation and dependent test work.",
  baselineCommit,
  workspaceId: "isolated-dev-workspace",
  tasks: [
    {
      id: "implement-store", title: "Implement store", objective: "Add the plan persistence module.",
      agentId: "developer", kind: "implementation", files: ["agent-core/plan-store.ts"],
      acceptanceCriteria: ["Typecheck passes"], dependsOn: [],
    },
    {
      id: "test-store", title: "Test store", objective: "Cover persistence and access boundaries.",
      agentId: "developer", kind: "test", files: ["agent-core/plan-store.test.ts"],
      acceptanceCriteria: ["Tests pass"], dependsOn: ["implement-store"],
    },
  ],
});

test("saves and retrieves validated plans with Founder scoping", async () => {
  const store = new SelfBuildPlanStore();
  const saved = await store.save({ planId: "proposal-001", founderId: "founder-1", plan: proposal() });
  assert.equal(saved.plan.executionMode, "proposal_only");
  assert.equal((await store.get({ planId: "proposal-001", founderId: "founder-1" }))?.planId, "proposal-001");
  assert.equal(await store.get({ planId: "proposal-001", founderId: "founder-2" }), null);
  assert.equal((await store.list({ founderId: "founder-2" })).length, 0);
});

test("rejects duplicate IDs, malformed plans and invalid limits", async () => {
  const store = new SelfBuildPlanStore();
  await store.save({ planId: "proposal-002", founderId: "founder-1", plan: proposal() });
  await assert.rejects(store.save({ planId: "proposal-002", founderId: "founder-1", plan: proposal() }), /already exists/);
  await assert.rejects(store.save({ planId: "proposal-003", founderId: "founder-1", plan: { ...proposal(), baselineCommit: "main" } }));
  await assert.rejects(store.list({ founderId: "founder-1", limit: 0 }), /limit/);
});

test("persists atomically across store instances and supports owner-only deletion", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-plan-store-"));
  const file = path.join(directory, "plans.json");
  try {
    const first = new SelfBuildPlanStore(file);
    await first.save({ planId: "proposal-004", founderId: "founder-1", plan: proposal() });
    const second = new SelfBuildPlanStore(file);
    assert.equal((await second.get({ planId: "proposal-004", founderId: "founder-1" }))?.founderId, "founder-1");
    assert.equal(await second.delete({ planId: "proposal-004", founderId: "founder-2" }), false);
    assert.equal(await second.delete({ planId: "proposal-004", founderId: "founder-1" }), true);
    assert.equal(await new SelfBuildPlanStore(file).get({ planId: "proposal-004", founderId: "founder-1" }), null);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("refuses to load corrupt or over-limit storage", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-plan-corrupt-"));
  const file = path.join(directory, "plans.json");
  try {
    fs.writeFileSync(file, "{bad json");
    assert.throws(() => new SelfBuildPlanStore(file), /corrupt/);
    fs.writeFileSync(file, JSON.stringify({ version: 1, records: [], padding: "x".repeat(1200) }));
    assert.throws(() => new SelfBuildPlanStore(file, { maxBytes: 1024 }), /size limit/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
