import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GoalPlanStore } from "./goal-plan-store.ts";
import { GoalPlanExecutor } from "./goal-plan-executor.ts";
import { GoalPlanWorker } from "./goal-plan-worker.ts";
import type { GoalPlan } from "./goal-planner.ts";

function plan(steps: GoalPlan["steps"]): GoalPlan {
  return { objective: "Complete the approved project steps", summary: "A bounded test plan", executionMode: "plan_only", steps };
}
const readStep: GoalPlan["steps"][number] = {
  id: "read_step", title: "Read system information", tool: "system_info", args: {}, dependsOn: [],
  expectedResult: "System information is returned", requiresFounderApproval: false,
};
const saveStep: GoalPlan["steps"][number] = {
  id: "save_step", title: "Save a Founder-approved note", tool: "memory_save",
  args: { content: "approved lesson" }, dependsOn: ["read_step"],
  expectedResult: "The memory note is saved", requiresFounderApproval: true,
};

test("background worker executes explicitly started plans and pauses at an unapproved mutation", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-plan-worker-"));
  try {
    const store = new GoalPlanStore(directory);
    const calls: string[] = [];
    const executor = new GoalPlanExecutor(store, async tool => { calls.push(tool); return { tool, ok: true }; });
    const created = await store.create("founder-a", plan([readStep, saveStep]));
    await executor.start("founder-a", created.id);
    const worker = new GoalPlanWorker(store, executor, "founder-a");
    const first = await worker.runOnce();
    assert.equal(first.resumed, 1);
    assert.equal(first.awaitingApproval, 1);
    assert.deepEqual(calls, ["system_info"]);
    assert.equal((await store.get("founder-a", created.id))?.status, "awaiting_approval");

    await executor.approveStep("founder-a", created.id, "save_step");
    const second = await worker.runOnce();
    assert.equal(second.completed, 1);
    assert.deepEqual(calls, ["system_info", "memory_save"]);
    assert.equal((await store.get("founder-a", created.id))?.status, "completed");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("worker never replays a step interrupted while it was running", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-plan-recovery-"));
  try {
    const store = new GoalPlanStore(directory);
    let executions = 0;
    const executor = new GoalPlanExecutor(store, async () => { executions++; return { ok: true }; });
    const created = await store.create("founder-a", plan([readStep]));
    await executor.start("founder-a", created.id);
    const interrupted = await store.get("founder-a", created.id);
    assert.ok(interrupted);
    interrupted.stepStates.read_step.status = "running";
    await store.save("founder-a", interrupted);
    const worker = new GoalPlanWorker(store, executor, "founder-a");
    const result = await worker.runOnce();
    assert.equal(result.recovered, 1);
    assert.equal(executions, 0);
    const recovered = await store.get("founder-a", created.id);
    assert.equal(recovered?.status, "failed");
    assert.match(recovered?.stepStates.read_step.error || "", /automatic replay is disabled/i);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("worker processes only its configured Founder's running plans", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-plan-owner-"));
  try {
    const store = new GoalPlanStore(directory);
    let executions = 0;
    const executor = new GoalPlanExecutor(store, async () => { executions++; return { ok: true }; });
    const own = await store.create("founder-a", plan([readStep]));
    const other = await store.create("founder-b", plan([readStep]));
    await executor.start("founder-a", own.id);
    await executor.start("founder-b", other.id);
    const worker = new GoalPlanWorker(store, executor, "founder-a");
    const result = await worker.runOnce();
    assert.equal(result.resumed, 1);
    assert.equal(executions, 1);
    assert.equal((await store.get("founder-b", other.id))?.status, "running");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
