import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GoalPlanStore } from "./goal-plan-store.ts";
import { GoalPlanExecutor } from "./goal-plan-executor.ts";
import type { GoalPlan } from "./goal-planner.ts";

function setup(plan: GoalPlan, executeTool: (tool: string, args: Record<string, unknown>) => Promise<unknown>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-plan-executor-"));
  const store = new GoalPlanStore(directory);
  const saved = store.create("founder-a", plan);
  return { directory, store, saved, executor: new GoalPlanExecutor(store, executeTool) };
}
const sample: GoalPlan = {
  objective: "Inspect then save an approved note.",
  summary: "Read a file and save the approved finding.",
  executionMode: "plan_only",
  steps: [
    { id: "inspect", title: "Inspect file", tool: "read_file", args: { path: "README.md" }, dependsOn: [], expectedResult: "File contents", requiresFounderApproval: false },
    { id: "save_note", title: "Save note", tool: "memory_save", args: { content: "Founder-approved note" }, dependsOn: ["inspect"], expectedResult: "Memory saved", requiresFounderApproval: true },
  ],
};

test("executes safe steps, pauses for approval, then resumes sequentially with evidence", async () => {
  const calls: string[] = [];
  const ctx = setup(sample, async (tool) => { calls.push(tool); return { ok: true, tool }; });
  try {
    const paused = await ctx.executor.execute("founder-a", ctx.saved.id);
    assert.equal(paused.status, "awaiting_approval");
    assert.equal(paused.stepStates.inspect.status, "completed");
    assert.equal(paused.stepStates.save_note.status, "awaiting_approval");
    assert.deepEqual(calls, ["read_file"]);
    assert.match(paused.stepStates.inspect.evidence?.sha256 || "", /^[a-f0-9]{64}$/);

    ctx.executor.approveStep("founder-a", ctx.saved.id, "save_note");
    const completed = await ctx.executor.execute("founder-a", ctx.saved.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.stepStates.save_note.status, "completed");
    assert.deepEqual(calls, ["read_file", "memory_save"]);
    const restored = new GoalPlanStore(ctx.directory).get("founder-a", ctx.saved.id);
    assert.equal(restored?.status, "completed");
  } finally { fs.rmSync(ctx.directory, { recursive: true, force: true }); }
});

test("does not execute another Founder's plan or approve read-only steps", async () => {
  const ctx = setup(sample, async () => ({ ok: true }));
  try {
    await assert.rejects(ctx.executor.execute("founder-b", ctx.saved.id), /not found/i);
    assert.throws(() => ctx.executor.approveStep("founder-a", ctx.saved.id, "inspect"), /does not require/);
  } finally { fs.rmSync(ctx.directory, { recursive: true, force: true }); }
});

test("stops and records failure without automatically retrying", async () => {
  let calls = 0;
  const ctx = setup({ ...sample, steps: [sample.steps[0]] }, async () => { calls++; throw new Error("adapter offline"); });
  try {
    const failed = await ctx.executor.execute("founder-a", ctx.saved.id);
    assert.equal(failed.status, "failed");
    assert.equal(failed.stepStates.inspect.status, "failed");
    assert.match(failed.stepStates.inspect.error || "", /adapter offline/);
    await assert.rejects(ctx.executor.execute("founder-a", ctx.saved.id), /automatic retry is disabled/);
    assert.equal(calls, 1);
  } finally { fs.rmSync(ctx.directory, { recursive: true, force: true }); }
});

test("enforces sensitive-tool approvals even if a model flag is false", async () => {
  const altered: GoalPlan = { ...sample, steps: sample.steps.map(step => step.id === "save_note" ? { ...step, requiresFounderApproval: false } : step) };
  const ctx = setup(altered, async () => ({ ok: true }));
  try {
    const paused = await ctx.executor.execute("founder-a", ctx.saved.id);
    assert.equal(paused.status, "awaiting_approval");
    assert.equal(paused.stepStates.save_note.status, "awaiting_approval");
    ctx.executor.approveStep("founder-a", ctx.saved.id, "save_note");
    const resumed = await ctx.executor.execute("founder-a", ctx.saved.id);
    assert.equal(resumed.status, "completed");
  } finally { fs.rmSync(ctx.directory, { recursive: true, force: true }); }
});
