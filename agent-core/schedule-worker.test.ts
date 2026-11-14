import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileScheduledJobRepository } from "./file-scheduled-job-repository.ts";
import { ScheduleWorker } from "./schedule-worker.ts";
import type { TaskEnvelope } from "./task-orchestrator.ts";
import { createTask } from "./task-lifecycle.ts";

class FakeTasks {
  records = new Map<string, TaskEnvelope>();
  async get(id: string, founderId?: string) { const value = this.records.get(id); return value?.task.founderId === founderId ? structuredClone(value) : undefined; }
  async put(value: TaskEnvelope) { this.records.set(value.task.id, structuredClone(value)); }
  async list(founderId: string) { return [...this.records.values()].filter(value => value.task.founderId === founderId); }
}
function expectedTaskId(scheduleId: string, scheduledAt: string) {
  return "scheduled-" + createHash("sha256").update(scheduleId + ":" + scheduledAt).digest("hex").slice(0, 24);
}
function makeEnqueuer(tasks: FakeTasks, calls: any[]) {
  return { enqueue: async (input: any) => {
    calls.push(input);
    const task: TaskEnvelope = { task: createTask({ id: input.id, founderId: input.founderId, instruction: input.instruction, riskLevel: "low", requiresApproval: false }), capability: input.capability, args: input.args, attempts: 0, idempotencyKey: input.id };
    await tasks.put(task);
    return task;
  } };
}

test("schedule worker queues only due read-only file tasks and completes one-time schedules", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-schedule-worker-"));
  try {
    const schedules = new FileScheduledJobRepository(directory);
    const dueAt = new Date(Date.now() - 1000).toISOString();
    await schedules.create({ id: "once", founderId: "founder-a", title: "Check readme", path: "README.md", status: "active", nextRunAt: dueAt, intervalMs: null, createdAt: dueAt, updatedAt: dueAt, runCount: 0, failureCount: 0 });
    const tasks = new FakeTasks(); const calls: any[] = [];
    const worker = new ScheduleWorker(schedules, tasks as any, makeEnqueuer(tasks, calls), { founderId: "founder-a" });
    const result = await worker.runOnce();
    assert.equal(result.enqueued, 1);
    assert.equal(calls[0].capability, "workspace.read_file");
    assert.deepEqual(calls[0].args, { path: "README.md" });
    assert.equal(calls[0].actor.role, "founder");
    assert.equal((await schedules.get("founder-a", "once"))?.status, "completed");
    assert.ok(tasks.records.has(expectedTaskId("once", dueAt)));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("schedule worker is idempotent if task enqueue succeeded but schedule advancement failed", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-schedule-idempotent-"));
  try {
    const schedules = new FileScheduledJobRepository(directory);
    const dueAt = new Date(Date.now() - 1000).toISOString();
    await schedules.create({ id: "retry", founderId: "founder-a", title: "Check file", path: "README.md", status: "active", nextRunAt: dueAt, intervalMs: null, createdAt: dueAt, updatedAt: dueAt, runCount: 0, failureCount: 0 });
    const tasks = new FakeTasks(); const calls: any[] = [];
    let failFirstMark = true;
    const wrapped = {
      listDue: schedules.listDue.bind(schedules),
      get: schedules.get.bind(schedules),
      markEnqueued: async (...args: any[]) => { if (failFirstMark) { failFirstMark = false; throw new Error("simulated persistence interruption"); } return schedules.markEnqueued(args[0], args[1], args[2], args[3]); },
      recordFailure: schedules.recordFailure.bind(schedules),
    };
    const worker = new ScheduleWorker(wrapped as any, tasks as any, makeEnqueuer(tasks, calls), { founderId: "founder-a" });
    assert.equal((await worker.runOnce()).failed, 1);
    assert.equal(calls.length, 1);
    assert.equal((await worker.runOnce()).duplicateSkips, 1);
    assert.equal(calls.length, 1, "deterministic task ID must prevent duplicate enqueue");
    assert.equal((await schedules.get("founder-a", "retry"))?.status, "completed");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("schedule worker never queues another Founder's jobs", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-schedule-founder-"));
  try {
    const schedules = new FileScheduledJobRepository(directory);
    const dueAt = new Date(Date.now() - 1000).toISOString();
    await schedules.create({ id: "private", founderId: "founder-b", title: "Private job", path: "README.md", status: "active", nextRunAt: dueAt, intervalMs: null, createdAt: dueAt, updatedAt: dueAt, runCount: 0, failureCount: 0 });
    const tasks = new FakeTasks(); const calls: any[] = [];
    const worker = new ScheduleWorker(schedules, tasks as any, makeEnqueuer(tasks, calls), { founderId: "founder-a" });
    assert.equal((await worker.runOnce()).scanned, 0);
    assert.equal(calls.length, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});


test("schedule worker claims and completes jobs through distributed lease methods when available", async () => {
  const dueAt = new Date(Date.now() - 1000).toISOString();
  const claimedJob = { id: "leased", founderId: "founder-a", title: "Leased read", path: "README.md", status: "active", nextRunAt: dueAt, intervalMs: null, createdAt: dueAt, updatedAt: dueAt, runCount: 0, failureCount: 0 };
  const calls: any[] = [];
  const schedules = {
    claimDue: async (founderId: string, workerId: string, leaseMs: number, limit: number) => {
      calls.push({ method: "claim", founderId, workerId, leaseMs, limit }); return [claimedJob];
    },
    listDue: async () => { throw new Error("non-leased list path must not be used"); },
    markEnqueued: async (...args: any[]) => { calls.push({ method: "complete", args }); },
    recordFailure: async (...args: any[]) => { calls.push({ method: "fail", args }); },
  };
  const tasks = new FakeTasks(); const enqueued: any[] = [];
  const worker = new ScheduleWorker(schedules as any, tasks as any, makeEnqueuer(tasks, enqueued), { founderId: "founder-a", workerId: "lease-worker", leaseMs: 20_000 });
  const result = await worker.runOnce();
  assert.equal(result.enqueued, 1);
  assert.deepEqual(calls[0], { method: "claim", founderId: "founder-a", workerId: "lease-worker", leaseMs: 20_000, limit: 10 });
  assert.equal(calls[1].method, "complete");
  assert.equal(calls[1].args[4], "lease-worker");
});
