import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GoalPlanStore } from "./goal-plan-store.ts";
import { GoalPlanExecutor } from "./goal-plan-executor.ts";
import { FileTaskRepository } from "./file-task-repository.ts";
import type { GoalPlan } from "./goal-planner.ts";

async function setup(plan: GoalPlan, executeTool: (tool: string, args: Record<string, unknown>) => Promise<unknown>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-plan-executor-"));
  const store = new GoalPlanStore(directory);
  const saved = await store.create("founder-a", plan);
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
  const ctx = await setup(sample, async (tool) => { calls.push(tool); return { ok: true, tool }; });
  try {
    const paused = await ctx.executor.execute("founder-a", ctx.saved.id);
    assert.equal(paused.status, "awaiting_approval");
    assert.equal(paused.stepStates.inspect.status, "completed");
    assert.equal(paused.stepStates.save_note.status, "awaiting_approval");
    assert.deepEqual(calls, ["read_file"]);
    assert.match(paused.stepStates.inspect.evidence?.sha256 || "", /^[a-f0-9]{64}$/);

    await ctx.executor.approveStep("founder-a", ctx.saved.id, "save_note");
    const completed = await ctx.executor.execute("founder-a", ctx.saved.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.stepStates.save_note.status, "completed");
    assert.deepEqual(calls, ["read_file", "memory_save"]);
    const restored = await new GoalPlanStore(ctx.directory).get("founder-a", ctx.saved.id);
    assert.equal(restored?.status, "completed");
  } finally { fs.rmSync(ctx.directory, { recursive: true, force: true }); }
});


test("cannot pre-approve a later mutation while the current mutation is awaiting approval", async () => {
  const laterMutation: GoalPlan = {
    ...sample,
    steps: [
      sample.steps[0],
      { id: "first_write", title: "Save first note", tool: "memory_save", args: { content: "first" }, dependsOn: ["inspect"], expectedResult: "First note saved", requiresFounderApproval: true },
      { id: "second_write", title: "Schedule follow-up", tool: "schedule_task", args: { title: "Follow up" }, dependsOn: ["first_write"], expectedResult: "Follow-up scheduled", requiresFounderApproval: true },
    ],
  };
  const calls: string[] = [];
  const ctx = await setup(laterMutation, async tool => { calls.push(tool); return { ok: true, tool }; });
  try {
    const firstPause = await ctx.executor.execute("founder-a", ctx.saved.id);
    assert.equal(firstPause.status, "awaiting_approval");
    assert.equal(firstPause.stepStates.first_write.status, "awaiting_approval");
    assert.equal(firstPause.stepStates.second_write.status, "queued");
    await assert.rejects(
      ctx.executor.approveStep("founder-a", ctx.saved.id, "second_write"),
      /exact step currently awaiting Founder approval/i,
    );

    await ctx.executor.approveStep("founder-a", ctx.saved.id, "first_write");
    const secondPause = await ctx.executor.execute("founder-a", ctx.saved.id);
    assert.equal(secondPause.status, "awaiting_approval");
    assert.equal(secondPause.stepStates.first_write.status, "completed");
    assert.equal(secondPause.stepStates.second_write.status, "awaiting_approval");
    assert.deepEqual(calls, ["read_file", "memory_save"]);

    await ctx.executor.approveStep("founder-a", ctx.saved.id, "second_write");
    const completed = await ctx.executor.execute("founder-a", ctx.saved.id);
    assert.equal(completed.status, "completed");
    assert.deepEqual(calls, ["read_file", "memory_save", "schedule_task"]);
  } finally { fs.rmSync(ctx.directory, { recursive: true, force: true }); }
});

test("does not execute another Founder's plan or approve read-only steps", async () => {
  const ctx = await setup(sample, async () => ({ ok: true }));
  try {
    await assert.rejects(ctx.executor.execute("founder-b", ctx.saved.id), /not found/i);
    await assert.rejects(ctx.executor.approveStep("founder-a", ctx.saved.id, "inspect"), /does not require/);
  } finally { fs.rmSync(ctx.directory, { recursive: true, force: true }); }
});

test("stops and records failure without automatically retrying", async () => {
  let calls = 0;
  const ctx = await setup({ ...sample, steps: [sample.steps[0]] }, async () => { calls++; throw new Error("adapter offline"); });
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
  const ctx = await setup(altered, async () => ({ ok: true }));
  try {
    const paused = await ctx.executor.execute("founder-a", ctx.saved.id);
    assert.equal(paused.status, "awaiting_approval");
    assert.equal(paused.stepStates.save_note.status, "awaiting_approval");
    await ctx.executor.approveStep("founder-a", ctx.saved.id, "save_note");
    const resumed = await ctx.executor.execute("founder-a", ctx.saved.id);
    assert.equal(resumed.status, "completed");
  } finally { fs.rmSync(ctx.directory, { recursive: true, force: true }); }
});


test("creates an empty store only when the goal-plan file is genuinely missing", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-plan-store-missing-"));
  try {
    const store = new GoalPlanStore(directory);
    assert.deepEqual(await store.list("founder-a"), []);
    const created = await store.create("founder-a", sample);
    assert.equal((await store.get("founder-a", created.id))?.id, created.id);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("fails closed on corrupt JSON without replacing the original goal-plan file", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-plan-store-corrupt-"));
  const filePath = path.join(directory, "goal-plans.json");
  const corrupt = "{ this is not valid JSON";
  fs.writeFileSync(filePath, corrupt, "utf8");
  try {
    const store = new GoalPlanStore(directory);
    await assert.rejects(store.list("founder-a"), /invalid JSON.*refusing to overwrite/i);
    await assert.rejects(store.create("founder-a", sample), /invalid JSON.*refusing to overwrite/i);
    assert.equal(fs.readFileSync(filePath, "utf8"), corrupt);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("fails closed on unsupported or malformed goal-plan storage instead of silently dropping records", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-plan-store-schema-"));
  const filePath = path.join(directory, "goal-plans.json");
  try {
    fs.writeFileSync(filePath, JSON.stringify({ version: 2, plans: [] }), "utf8");
    const store = new GoalPlanStore(directory);
    await assert.rejects(store.list("founder-a"), /unsupported or invalid format/i);
    fs.writeFileSync(filePath, JSON.stringify({ version: 1, plans: [{ id: "plan-1", founderId: "founder-a" }] }), "utf8");
    await assert.rejects(store.create("founder-a", sample), /malformed plan record/i);
    assert.equal(JSON.parse(fs.readFileSync(filePath, "utf8")).plans[0].id, "plan-1");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});


test("links every goal-plan step to a persistent task lifecycle without placing child tasks in the generic queue", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-plan-task-link-"));
  try {
    const store = new GoalPlanStore(path.join(directory, "plans"));
    const tasks = new FileTaskRepository(path.join(directory, "tasks.json"));
    const saved = await store.create("founder-a", sample);
    const executor = new GoalPlanExecutor(store, async (tool) => ({ ok: true, tool }), tasks);

    const paused = await executor.execute("founder-a", saved.id);
    const readTaskId = paused.stepStates.inspect.taskId;
    const approvalTaskId = paused.stepStates.save_note.taskId;
    assert.ok(readTaskId);
    assert.ok(approvalTaskId);
    let readTask = await tasks.get(readTaskId!, "founder-a");
    let approvalTask = await tasks.get(approvalTaskId!, "founder-a");
    assert.equal(readTask?.capability, "goal_plan.step");
    assert.equal(readTask?.task.status, "completed");
    assert.equal(readTask?.task.progress, 100);
    assert.equal(readTask?.attempts, 1);
    assert.equal(approvalTask?.task.status, "awaiting_approval");
    assert.equal(approvalTask?.task.requiresApproval, false, "parent plan digest is the approval authority");
    assert.notEqual(approvalTask?.task.status, "queued", "generic task worker must not claim plan child tasks");

    await executor.approveStep("founder-a", saved.id, "save_note");
    approvalTask = await tasks.get(approvalTaskId!, "founder-a");
    assert.equal(approvalTask?.task.status, "paused", "approved child remains outside the generic task queue");

    const completed = await executor.execute("founder-a", saved.id);
    assert.equal(completed.status, "completed");
    approvalTask = await tasks.get(approvalTaskId!, "founder-a");
    assert.equal(approvalTask?.task.status, "completed");
    assert.equal(approvalTask?.task.verificationEvidence.length, 1);
    assert.match(String((approvalTask?.result as { sha256?: string })?.sha256), /^[a-f0-9]{64}$/);
    const persisted = await new GoalPlanStore(path.join(directory, "plans")).get("founder-a", saved.id);
    assert.equal(persisted?.stepStates.save_note.taskId, approvalTaskId);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("records failed goal-plan tool steps as failed child tasks", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-plan-task-failure-"));
  try {
    const store = new GoalPlanStore(path.join(directory, "plans"));
    const tasks = new FileTaskRepository(path.join(directory, "tasks.json"));
    const saved = await store.create("founder-a", { ...sample, steps: [sample.steps[0]] });
    const executor = new GoalPlanExecutor(store, async () => { throw new Error("tool adapter offline"); }, tasks);
    const failed = await executor.execute("founder-a", saved.id);
    assert.equal(failed.status, "failed");
    const taskId = failed.stepStates.inspect.taskId;
    assert.ok(taskId);
    const task = await tasks.get(taskId!, "founder-a");
    assert.equal(task?.task.status, "failed");
    assert.match(task?.task.lastError || "", /tool adapter offline/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
