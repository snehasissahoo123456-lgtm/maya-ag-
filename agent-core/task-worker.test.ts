import test from "node:test";
import assert from "node:assert/strict";
import { ApprovalLedger } from "./approval-ledger.ts";
import { CapabilityRegistry } from "./capability-registry.ts";
import { createTask, transitionTask } from "./task-lifecycle.ts";
import { TaskOrchestrator, type TaskEnvelope, type TaskRepository } from "./task-orchestrator.ts";
import { TaskWorker } from "./task-worker.ts";

class MemoryRepo implements TaskRepository {
  private rows = new Map<string, TaskEnvelope>();
  async get(id: string) {
    const value = this.rows.get(id);
    return value ? structuredClone(value) : undefined;
  }
  async put(value: TaskEnvelope) {
    this.rows.set(value.task.id, structuredClone(value));
  }
  async list(founderId: string) {
    return [...this.rows.values()]
      .filter(value => value.task.founderId === founderId)
      .map(value => structuredClone(value));
  }
}

const founder = { id: "founder-session", founderId: "founder-primary", role: "founder" as const, scopes: ["workspace:read"] };
function setup(run: (input: any) => Promise<any> = async () => ({
  result: { path: "README.md" },
  evidence: { kind: "sha256", description: "Read-only file digest verified.", observedAt: new Date().toISOString() },
})) {
  const repository = new MemoryRepo();
  const registry = new CapabilityRegistry();
  registry.register({
    name: "workspace.read_file",
    description: "Read a non-secret workspace file.",
    risk: "low",
    allowedRoles: ["founder", "worker"],
    requiredScopes: ["workspace:read"],
    arguments: { path: { type: "string", required: true, maxLength: 1024 } },
    timeoutMs: 5000,
    requiresApproval: false,
    verification: "SHA-256 digest of file content.",
  });
  registry.register({
    name: "workspace.publish",
    description: "Publish an artifact.",
    risk: "high",
    allowedRoles: ["founder"],
    requiredScopes: ["workspace:publish"],
    arguments: { target: { type: "string", required: true, maxLength: 100 } },
    timeoutMs: 5000,
    requiresApproval: true,
    verification: "Publication receipt.",
  });
  const orchestrator = new TaskOrchestrator(repository, registry, new ApprovalLedger(), { run });
  const worker = new TaskWorker(repository, orchestrator, registry, { founderId: "founder-primary", pollIntervalMs: 1000 });
  return { repository, registry, orchestrator, worker };
}

test("worker executes only queued low-risk workspace read tasks using its scoped worker identity", async () => {
  const { orchestrator, worker, repository } = setup();
  await orchestrator.enqueue({
    id: "worker-read-1",
    founderId: "founder-primary",
    instruction: "Read README",
    capability: "workspace.read_file",
    args: { path: "README.md" },
    actor: founder,
  });

  const result = await worker.runOnce();
  assert.deepEqual(result, { scanned: 1, executed: 1, skipped: 0, failed: 0 });
  const saved = await repository.get("worker-read-1");
  assert.equal(saved?.task.status, "completed");
  assert.equal(saved?.task.verificationEvidence.length, 1);
});

test("worker skips high-risk actions and tasks requiring Founder approval", async () => {
  const { orchestrator, worker, repository } = setup();
  await orchestrator.enqueue({
    id: "worker-publish-1",
    founderId: "founder-primary",
    instruction: "Publish release",
    capability: "workspace.publish",
    args: { target: "production" },
    actor: { ...founder, scopes: ["workspace:publish"] },
  });

  const result = await worker.runOnce();
  assert.equal(result.executed, 0);
  assert.equal(result.skipped, 1);
  assert.equal((await repository.get("worker-publish-1"))?.task.status, "queued");
});

test("worker does not resume tasks parked in requires_recovery", async () => {
  const { worker, repository } = setup();
  const queued = createTask({ id: "worker-recovery-1", founderId: "founder-primary", instruction: "Review interrupted work" });
  const planning = transitionTask(queued, "planning");
  const running = transitionTask(planning, "running");
  const recovery = transitionTask(running, "requires_recovery", { error: "Server restarted during execution." });
  await repository.put({
    task: recovery,
    capability: "workspace.read_file",
    args: { path: "README.md" },
    attempts: 1,
    idempotencyKey: "worker-recovery-1",
  });

  const result = await worker.runOnce();
  assert.equal(result.executed, 0);
  assert.equal((await repository.get("worker-recovery-1"))?.task.status, "requires_recovery");
});

test("worker allows only one polling cycle at a time", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { orchestrator, worker } = setup(async () => {
    await gate;
    return {
      result: { path: "README.md" },
      evidence: { kind: "sha256", description: "Read-only file digest verified.", observedAt: new Date().toISOString() },
    };
  });
  await orchestrator.enqueue({
    id: "worker-race-1",
    founderId: "founder-primary",
    instruction: "Read README",
    capability: "workspace.read_file",
    args: { path: "README.md" },
    actor: founder,
  });

  const first = worker.runOnce();
  const second = await worker.runOnce();
  assert.equal(second.busy, true);
  release();
  const completed = await first;
  assert.equal(completed.executed, 1);
});

test("worker does not automatically retry a failed task", async () => {
  const { orchestrator, worker, repository } = setup(async () => {
    throw new Error("Temporary runner failure.");
  });
  await orchestrator.enqueue({
    id: "worker-fail-1",
    founderId: "founder-primary",
    instruction: "Read README",
    capability: "workspace.read_file",
    args: { path: "README.md" },
    actor: founder,
  });

  const first = await worker.runOnce();
  assert.equal(first.failed, 1);
  assert.equal((await repository.get("worker-fail-1"))?.task.status, "failed");
  const second = await worker.runOnce();
  assert.equal(second.executed, 0);
  assert.equal((await repository.get("worker-fail-1"))?.task.status, "failed");
});
