import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GoalPlanStore } from "./goal-plan-store.ts";
import { GoalPlanExecutor } from "./goal-plan-executor.ts";
import { GoalPlanWorker, assertGoalPlanWorkerStorage } from "./goal-plan-worker.ts";
import { SupabaseGoalPlanStore } from "./supabase-goal-plan-store.ts";
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


test("running plans cannot pre-approve a future step while another step is executing", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-plan-approval-race-"));
  try {
    const store = new GoalPlanStore(directory);
    const executor = new GoalPlanExecutor(store, async () => ({ ok: true }));
    const created = await store.create("founder-a", plan([readStep, saveStep]));
    await executor.start("founder-a", created.id);
    await assert.rejects(() => executor.approveStep("founder-a", created.id, "save_step"), /exact step currently awaiting Founder approval/i);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("database-backed worker uses atomic claims and releases every claimed plan", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-plan-leased-worker-"));
  try {
    const store = new GoalPlanStore(directory);
    const created = await store.create("founder-a", plan([readStep]));
    await store.save("founder-a", { ...created, status: "running" });
    const claims: string[] = [];
    const releases: string[] = [];
    let available = true;
    const repository = {
      create: store.create.bind(store),
      list: store.list.bind(store),
      get: store.get.bind(store),
      save: store.save.bind(store),
      claimNext: async (founderId: string, workerId: string, leaseMs: number) => {
        assert.equal(founderId, "founder-a");
        assert.equal(workerId, "worker-test");
        assert.equal(leaseMs, 30_000);
        if (!available) return undefined;
        available = false;
        claims.push(created.id);
        return store.get(founderId, created.id);
      },
      releaseClaim: async (founderId: string, planId: string, workerId: string) => {
        assert.equal(founderId, "founder-a");
        assert.equal(workerId, "worker-test");
        releases.push(planId);
      },
      renewClaim: async (founderId: string, planId: string, workerId: string, leaseMs: number) => {
        assert.equal(founderId, "founder-a");
        assert.equal(planId, created.id);
        assert.equal(workerId, "worker-test");
        assert.equal(leaseMs, 30_000);
        return true;
      },
    };
    const executor = new GoalPlanExecutor(store, async () => ({ ok: true }));
    const worker = new GoalPlanWorker(repository, executor, "founder-a", 3000, 5, "worker-test", 30_000);
    const result = await worker.runOnce();
    assert.equal(result.completed, 1);
    assert.deepEqual(claims, [created.id]);
    assert.deepEqual(releases, [created.id]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("two independent workers cannot claim and execute the same running plan", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-plan-two-workers-"));
  try {
    const store = new GoalPlanStore(directory);
    const created = await store.create("founder-a", plan([readStep]));
    await store.save("founder-a", { ...created, status: "running" });
    let claimed = false;
    let executions = 0;
    let concurrentExecutions = 0;
    let maxConcurrentExecutions = 0;
    const repository = {
      create: store.create.bind(store), list: store.list.bind(store), get: store.get.bind(store), save: store.save.bind(store),
      claimNext: async (founderId: string) => {
        if (founderId !== "founder-a" || claimed) return undefined;
        const current = await store.get(founderId, created.id);
        if (!current || current.status !== "running") return undefined;
        claimed = true;
        return current;
      },
      renewClaim: async () => true,
      releaseClaim: async () => { claimed = false; },
    };
    const executor = new GoalPlanExecutor(store, async () => {
      executions++;
      concurrentExecutions++;
      maxConcurrentExecutions = Math.max(maxConcurrentExecutions, concurrentExecutions);
      await new Promise(resolve => setTimeout(resolve, 30));
      concurrentExecutions--;
      return { ok: true };
    });
    const first = new GoalPlanWorker(repository, executor, "founder-a", 3000, 5, "worker-one", 30_000);
    const second = new GoalPlanWorker(repository, executor, "founder-a", 3000, 5, "worker-two", 30_000);
    const results = await Promise.all([first.runOnce(), second.runOnce()]);
    assert.equal(results.reduce((sum, item) => sum + item.completed, 0), 1);
    assert.equal(executions, 1);
    assert.equal(maxConcurrentExecutions, 1);
    assert.equal((await store.get("founder-a", created.id))?.status, "completed");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("database-backed worker renews its lease while a long-running step is executing", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-plan-heartbeat-"));
  try {
    const store = new GoalPlanStore(directory);
    const created = await store.create("founder-a", plan([readStep]));
    await store.save("founder-a", { ...created, status: "running" });
    let claimed = false;
    let renewals = 0;
    const repository = {
      create: store.create.bind(store), list: store.list.bind(store), get: store.get.bind(store), save: store.save.bind(store),
      claimNext: async (founderId: string) => {
        if (claimed) return undefined;
        const current = await store.get(founderId, created.id);
        if (!current || current.status !== "running") return undefined;
        claimed = true;
        return current;
      },
      renewClaim: async () => { renewals++; return true; },
      releaseClaim: async () => { claimed = false; },
    };
    const executor = new GoalPlanExecutor(store, async () => {
      await new Promise(resolve => setTimeout(resolve, 1_900));
      return { ok: true };
    });
    const worker = new GoalPlanWorker(repository, executor, "founder-a", 3000, 5, "heartbeat-worker", 5_000);
    const result = await worker.runOnce();
    assert.equal(result.completed, 1);
    assert.ok(renewals >= 1, "the worker should renew the 5-second lease during the running tool call");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("worker stops before the next step and does not write stale state after lease loss", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-plan-lease-lost-"));
  try {
    const store = new GoalPlanStore(directory);
    const secondStep = { ...readStep, id: "second_read", title: "Second read", dependsOn: ["read_step"] };
    const created = await store.create("founder-a", plan([readStep, secondStep]));
    await store.save("founder-a", { ...created, status: "running" });
    let claimed = false;
    const calls: string[] = [];
    const repository = {
      create: store.create.bind(store), list: store.list.bind(store), get: store.get.bind(store), save: store.save.bind(store),
      claimNext: async (founderId: string) => {
        if (claimed) return undefined;
        claimed = true;
        return store.get(founderId, created.id);
      },
      renewClaim: async () => false,
      releaseClaim: async () => { throw new Error("A worker that lost its lease must not release a successor's claim."); },
    };
    const executor = new GoalPlanExecutor(store, async tool => {
      calls.push(tool);
      await new Promise(resolve => setTimeout(resolve, 1_900));
      return { ok: true };
    });
    const worker = new GoalPlanWorker(repository, executor, "founder-a", 3000, 5, "lease-lost-worker", 5_000);
    const result = await worker.runOnce();
    assert.equal(result.failed, 1);
    assert.deepEqual(calls, ["system_info"]);
    const persisted = await store.get("founder-a", created.id);
    assert.equal(persisted?.status, "running");
    assert.equal(persisted?.stepStates.read_step.status, "running");
    assert.equal(persisted?.stepStates.second_read.status, "queued");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});


test("worker storage guard permits single-instance file storage", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-plan-storage-guard-"));
  try {
    assertGoalPlanWorkerStorage(new GoalPlanStore(directory), "file");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("worker storage guard permits Supabase only with atomic claim, renewal and release", () => {
  const leasedStore = new SupabaseGoalPlanStore("https://project.supabase.co", "service-secret", async () => new Response("[]", { status: 200 }));
  assertGoalPlanWorkerStorage(leasedStore, "supabase");
  assert.throws(() => assertGoalPlanWorkerStorage(new GoalPlanStore(), "supabase"), /atomic claim, lease renewal and release/i);
});


test("waits for an in-flight lease renewal before releasing the plan claim", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-plan-renew-release-order-"));
  try {
    const store = new GoalPlanStore(directory);
    const created = await store.create("founder-a", plan([readStep]));
    await store.save("founder-a", { ...created, status: "running" });
    let claimed = false;
    let renewalStarted = false;
    let renewalFinished = false;
    let released = false;
    const repository = {
      create: store.create.bind(store), list: store.list.bind(store), get: store.get.bind(store), save: store.save.bind(store),
      claimNext: async (founderId: string) => {
        if (claimed) return undefined;
        claimed = true;
        return store.get(founderId, created.id);
      },
      renewClaim: async () => {
        renewalStarted = true;
        await new Promise(resolve => setTimeout(resolve, 80));
        renewalFinished = true;
        return true;
      },
      releaseClaim: async () => {
        assert.equal(renewalFinished, true, "claim release must wait for any in-flight renewal");
        released = true;
      },
    };
    const executor = new GoalPlanExecutor(store, async () => {
      await new Promise(resolve => setTimeout(resolve, 1_800));
      return { ok: true };
    });
    const worker = new GoalPlanWorker(repository, executor, "founder-a", 3000, 5, "renew-release-worker", 5_000);
    const result = await worker.runOnce();
    assert.equal(result.completed, 1);
    assert.equal(renewalStarted, true);
    assert.equal(renewalFinished, true);
    assert.equal(released, true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("waits for an in-flight renewal result before persisting a step or starting the next one", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-plan-renew-loss-race-"));
  try {
    const store = new GoalPlanStore(directory);
    const secondStep = { ...readStep, id: "second_read", title: "Second read", dependsOn: ["read_step"] };
    const created = await store.create("founder-a", plan([readStep, secondStep]));
    await store.save("founder-a", { ...created, status: "running" });
    let claimed = false;
    let executions = 0;
    let released = false;
    const repository = {
      create: store.create.bind(store), list: store.list.bind(store), get: store.get.bind(store), save: store.save.bind(store),
      claimNext: async (founderId: string) => {
        if (claimed) return undefined;
        claimed = true;
        return store.get(founderId, created.id);
      },
      renewClaim: async () => {
        await new Promise(resolve => setTimeout(resolve, 80));
        return false;
      },
      releaseClaim: async () => { released = true; },
    };
    const executor = new GoalPlanExecutor(store, async () => {
      executions++;
      await new Promise(resolve => setTimeout(resolve, 1_800));
      return { ok: true };
    });
    const worker = new GoalPlanWorker(repository, executor, "founder-a", 3000, 5, "renew-loss-race-worker", 5_000);
    const result = await worker.runOnce();
    assert.equal(result.failed, 1);
    assert.equal(executions, 1, "the second step must not start after renewal reports lease loss");
    assert.equal(released, false, "a worker that lost its lease must not release the successor's claim");
    const persisted = await store.get("founder-a", created.id);
    assert.equal(persisted?.status, "running");
    assert.equal(persisted?.stepStates.read_step.status, "running", "stale results must not be persisted after lease loss");
    assert.equal(persisted?.stepStates.second_read.status, "queued");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
