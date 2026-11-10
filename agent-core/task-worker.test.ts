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
function setup(
  run: (input: any) => Promise<any> = async () => ({
    result: { path: "README.md" },
    evidence: { kind: "sha256", description: "Read-only file digest verified.", observedAt: new Date().toISOString() },
  }),
  isDeviceAvailable: (deviceId: string, founderId: string) => boolean = () => true,
) {
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
  registry.register({
    name: "workspace.write_file",
    description: "Replace an existing non-sensitive workspace file.",
    risk: "high",
    allowedRoles: ["founder", "worker"],
    requiredScopes: ["workspace:write"],
    arguments: { path: { type: "string", required: true, maxLength: 1024 }, content: { type: "string", required: true, maxLength: 100_000 } },
    timeoutMs: 5000,
    requiresApproval: true,
    verification: "Read back and hash the written file.",
  });
  registry.register({
    name: "workspace.run_validation",
    description: "Run fixed repository validation scripts.",
    risk: "high",
    allowedRoles: ["founder", "worker", "developer"],
    requiredScopes: ["tests:run"],
    arguments: {},
    timeoutMs: 180_000,
    requiresApproval: true,
    verification: "All fixed validation scripts passed.",
  });
  registry.register({
    name: "device.workspace.write_file",
    description: "Replace an existing local device workspace file after Founder approval.",
    risk: "high",
    allowedRoles: ["founder", "worker"],
    requiredScopes: ["device:write"],
    arguments: {
      deviceId: { type: "string", required: true, maxLength: 128 },
      path: { type: "string", required: true, maxLength: 1024 },
      content: { type: "string", required: true, maxLength: 100_000 },
    },
    timeoutMs: 5000,
    requiresApproval: true,
    verification: "Read back the local file and verify its SHA-256 digest.",
  });
  registry.register({
    name: "device.workspace.create_file",
    description: "Create a new local device workspace file after Founder approval.",
    risk: "high",
    allowedRoles: ["founder", "worker"],
    requiredScopes: ["device:write"],
    arguments: {
      deviceId: { type: "string", required: true, maxLength: 128 },
      path: { type: "string", required: true, maxLength: 1024 },
      content: { type: "string", required: true, maxLength: 100_000 },
    },
    timeoutMs: 5000,
    requiresApproval: true,
    verification: "Verify the newly created local file with SHA-256.",
  });
  registry.register({
    name: "device.workspace.move_file",
    description: "Move a local workspace file without overwriting an existing destination after Founder approval.",
    risk: "high",
    allowedRoles: ["founder", "worker"],
    requiredScopes: ["device:write"],
    arguments: {
      deviceId: { type: "string", required: true, maxLength: 128 },
      fromPath: { type: "string", required: true, maxLength: 1024 },
      toPath: { type: "string", required: true, maxLength: 1024 },
    },
    timeoutMs: 5000,
    requiresApproval: true,
    verification: "Verify the destination bytes and SHA-256 digest before removing the source.",
  });
  registry.register({
    name: "device.workspace.search_files",
    description: "Search bounded non-sensitive local workspace text files.",
    risk: "low",
    allowedRoles: ["founder", "worker"],
    requiredScopes: ["device:read"],
    arguments: {
      deviceId: { type: "string", required: true, maxLength: 128 },
      path: { type: "string", required: false, maxLength: 1024 },
      query: { type: "string", required: true, maxLength: 200 },
    },
    timeoutMs: 5000,
    requiresApproval: false,
    verification: "Hash the bounded workspace search result.",
  });
  registry.register({
    name: "device.workspace.list_directory",
    description: "List up to 100 non-sensitive entries in one local workspace directory.",
    risk: "low",
    allowedRoles: ["founder", "worker"],
    requiredScopes: ["device:read"],
    arguments: {
      deviceId: { type: "string", required: true, maxLength: 128 },
      path: { type: "string", required: false, maxLength: 1024 },
    },
    timeoutMs: 5000,
    requiresApproval: false,
    verification: "Hash the bounded directory listing.",
  });
  const approvals = new ApprovalLedger();
  const orchestrator = new TaskOrchestrator(repository, registry, approvals, { run });
  const worker = new TaskWorker(repository, orchestrator, registry, { founderId: "founder-primary", pollIntervalMs: 1000, isDeviceAvailable }, approvals);
  return { repository, registry, orchestrator, worker, approvals };
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

test("file-backed worker respects maxTasksPerCycle and leaves excess queued tasks for the next cycle", async () => {
  const { orchestrator, repository, registry, approvals } = setup();
  const worker = new TaskWorker(repository, orchestrator, registry, {
    founderId: "founder-primary",
    maxTasksPerCycle: 1,
  }, approvals);

  for (const id of ["worker-batch-1", "worker-batch-2", "worker-batch-3"]) {
    await orchestrator.enqueue({
      id,
      founderId: "founder-primary",
      instruction: "Read README",
      capability: "workspace.read_file",
      args: { path: "README.md" },
      actor: founder,
    });
  }

  const firstCycle = await worker.runOnce();
  assert.deepEqual(firstCycle, { scanned: 1, executed: 1, skipped: 0, failed: 0 });
  assert.equal((await repository.get("worker-batch-1"))?.task.status, "completed");
  assert.equal((await repository.get("worker-batch-2"))?.task.status, "queued");
  assert.equal((await repository.get("worker-batch-3"))?.task.status, "queued");

  const secondCycle = await worker.runOnce();
  assert.deepEqual(secondCycle, { scanned: 1, executed: 1, skipped: 0, failed: 0 });
  assert.equal((await repository.get("worker-batch-2"))?.task.status, "completed");
  assert.equal((await repository.get("worker-batch-3"))?.task.status, "queued");
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

test("worker uses atomic repository claims and releases each claimed task", async () => {
  class LeaseRepo implements TaskRepository {
    private item: TaskEnvelope = {
      task: createTask({ id: "leased-task-1", founderId: "founder-primary", instruction: "Read README" }),
      capability: "workspace.read_file", args: { path: "README.md" }, attempts: 0, idempotencyKey: "leased-task-1",
    };
    private claimed = false;
    releases = 0;
    async get(id: string, founderId?: string) {
      return this.item.task.id === id && (!founderId || this.item.task.founderId === founderId) ? structuredClone(this.item) : undefined;
    }
    async put(value: TaskEnvelope) { this.item = structuredClone(value); }
    async list(founderId: string) { return this.item.task.founderId === founderId ? [structuredClone(this.item)] : []; }
    async claimNext(founderId: string, workerId: string, leaseMs: number) {
      assert.equal(founderId, "founder-primary");
      assert.ok(workerId.length > 0);
      assert.ok(leaseMs >= 5000);
      if (this.claimed || this.item.task.status !== "queued") return undefined;
      this.claimed = true;
      return structuredClone(this.item);
    }
    async releaseClaim(taskId: string, founderId: string, workerId: string) {
      assert.equal(taskId, "leased-task-1");
      assert.equal(founderId, "founder-primary");
      assert.ok(workerId.length > 0);
      this.releases++;
    }
    async recoverExpiredClaims(founderId: string) { assert.equal(founderId, "founder-primary"); return 0; }
  }
  const repository = new LeaseRepo();
  const registry = new CapabilityRegistry();
  registry.register({
    name: "workspace.read_file", description: "Read a non-secret workspace file.", risk: "low",
    allowedRoles: ["founder", "worker"], requiredScopes: ["workspace:read"],
    arguments: { path: { type: "string", required: true, maxLength: 1024 } },
    timeoutMs: 5000, requiresApproval: false, verification: "SHA-256 digest of file content.",
  });
  const orchestrator = new TaskOrchestrator(repository, registry, new ApprovalLedger(), { run: async () => ({
    result: { path: "README.md" },
    evidence: { kind: "sha256", description: "Read-only file digest verified.", observedAt: new Date().toISOString() },
  }) });
  const worker = new TaskWorker(repository, orchestrator, registry, { founderId: "founder-primary" });
  const result = await worker.runOnce();
  assert.equal(result.executed, 1);
  assert.equal(repository.releases, 1);
  assert.equal((await repository.get("leased-task-1"))?.task.status, "completed");
});

test("worker executes a workspace write only after exact Founder approval", async () => {
  let executedCapability = "";
  const { orchestrator, worker, repository, approvals } = setup(async input => {
    executedCapability = input.capability;
    return { result: { written: true }, evidence: { kind: "write-sha256", description: "Approved file replacement verified.", reference: "sha256:" + "b".repeat(64), observedAt: new Date().toISOString() } };
  });
  const writeFounder = { ...founder, scopes: ["workspace:write"] };
  await orchestrator.enqueue({
    id: "worker-write-1", founderId: "founder-primary", instruction: "Replace the approved report",
    capability: "workspace.write_file", args: { path: "report.md", content: "Approved contents" }, actor: writeFounder,
  });
  const pending = await orchestrator.requestApproval("worker-write-1", writeFounder);
  await orchestrator.decideApproval({ approvalId: pending.approvalId, approved: true, actor: writeFounder });
  assert.equal((await repository.get("worker-write-1"))?.task.status, "queued");
  const result = await worker.runOnce();
  assert.equal(result.executed, 1);
  assert.equal(executedCapability, "workspace.write_file");
  assert.equal((await repository.get("worker-write-1"))?.task.status, "completed");
  assert.equal((await approvals.listForFounder("founder-primary")).find(item => item.id === pending.approvalId)?.status, "consumed");
});

test("worker never executes a write without a matching approval digest", async () => {
  let executions = 0;
  const { orchestrator, worker, repository } = setup(async () => {
    executions++;
    return { result: {}, evidence: { kind: "write", description: "Should not run", observedAt: new Date().toISOString() } };
  });
  const writeFounder = { ...founder, scopes: ["workspace:write"] };
  await orchestrator.enqueue({
    id: "worker-write-unapproved", founderId: "founder-primary", instruction: "Replace a report",
    capability: "workspace.write_file", args: { path: "report.md", content: "Original approved payload" }, actor: writeFounder,
  });
  const pending = await orchestrator.requestApproval("worker-write-unapproved", writeFounder);
  await orchestrator.decideApproval({ approvalId: pending.approvalId, approved: true, actor: writeFounder });
  const envelope = await repository.get("worker-write-unapproved");
  assert.ok(envelope);
  envelope.args.content = "Different unapproved payload";
  await repository.put(envelope);
  const result = await worker.runOnce();
  assert.equal(result.executed, 0);
  assert.equal(result.skipped, 1);
  assert.equal(executions, 0);
  assert.equal((await repository.get("worker-write-unapproved"))?.task.status, "queued");
});


test("worker executes local device writes only after exact Founder approval", async () => {
  let executedArgs: Record<string, unknown> | undefined;
  const { orchestrator, worker, repository, approvals } = setup(async input => {
    executedArgs = input.args;
    return {
      result: { verified: true, sha256: "c".repeat(64) },
      evidence: { kind: "device-write-sha256", description: "Local device file replacement verified.", reference: "sha256:" + "c".repeat(64), observedAt: new Date().toISOString() },
    };
  });
  const deviceFounder = { ...founder, scopes: ["device:write"] };
  const args = { deviceId: "device-123", path: "reports/status.md", content: "Approved local PC content" };
  await orchestrator.enqueue({
    id: "worker-device-write-1", founderId: "founder-primary", instruction: "Replace a local PC report",
    capability: "device.workspace.write_file", args, actor: deviceFounder,
  });
  const pending = await orchestrator.requestApproval("worker-device-write-1", deviceFounder);
  await orchestrator.decideApproval({ approvalId: pending.approvalId, approved: true, actor: founder });
  const result = await worker.runOnce();
  assert.equal(result.executed, 1);
  assert.deepEqual(executedArgs, args);
  assert.equal((await repository.get("worker-device-write-1"))?.task.status, "completed");
  assert.equal((await approvals.listForFounder("founder-primary")).find(item => item.id === pending.approvalId)?.status, "consumed");
});

test("worker refuses local device write when the approved device or payload changes", async () => {
  let executions = 0;
  const { orchestrator, worker, repository } = setup(async () => {
    executions++;
    return { result: {}, evidence: { kind: "device-write", description: "Should not run", observedAt: new Date().toISOString() } };
  });
  const deviceFounder = { ...founder, scopes: ["device:write"] };
  await orchestrator.enqueue({
    id: "worker-device-write-tamper", founderId: "founder-primary", instruction: "Replace a local PC report",
    capability: "device.workspace.write_file",
    args: { deviceId: "device-123", path: "reports/status.md", content: "Original approved payload" },
    actor: deviceFounder,
  });
  const pending = await orchestrator.requestApproval("worker-device-write-tamper", deviceFounder);
  await orchestrator.decideApproval({ approvalId: pending.approvalId, approved: true, actor: founder });
  const envelope = await repository.get("worker-device-write-tamper");
  assert.ok(envelope);
  envelope.args.deviceId = "different-device";
  await repository.put(envelope);
  const result = await worker.runOnce();
  assert.equal(result.executed, 0);
  assert.equal(result.skipped, 1);
  assert.equal(executions, 0);
});


test("file-backed worker parks interrupted running tasks for manual recovery", async () => {
  const { worker, repository } = setup();
  const queued = createTask({ id: "worker-interrupted-1", founderId: "founder-primary", instruction: "Replace a file" });
  const planning = transitionTask(queued, "planning");
  const running = transitionTask(planning, "running");
  await repository.put({
    task: running,
    capability: "workspace.read_file",
    args: { path: "README.md" },
    attempts: 1,
    idempotencyKey: "worker-interrupted-1",
  });
  const result = await worker.runOnce();
  assert.equal(result.executed, 0);
  assert.equal(result.skipped, 1);
  const saved = await repository.get("worker-interrupted-1");
  assert.equal(saved?.task.status, "requires_recovery");
  assert.match(saved?.task.lastError || "", /interrupted/i);
});


test("worker leaves an approved local device write queued when this process has no device connection", async () => {
  let executions = 0;
  const { orchestrator, worker, repository } = setup(async () => {
    executions++;
    return { result: {}, evidence: { kind: "device-write", description: "Should not run", observedAt: new Date().toISOString() } };
  }, () => false);
  const deviceFounder = { ...founder, scopes: ["device:write"] };
  await orchestrator.enqueue({
    id: "worker-device-offline", founderId: "founder-primary", instruction: "Replace local file",
    capability: "device.workspace.write_file",
    args: { deviceId: "device-123", path: "notes.md", content: "Approved payload" },
    actor: deviceFounder,
  });
  const pending = await orchestrator.requestApproval("worker-device-offline", deviceFounder);
  await orchestrator.decideApproval({ approvalId: pending.approvalId, approved: true, actor: founder });
  const result = await worker.runOnce();
  assert.equal(result.executed, 0);
  assert.equal(result.skipped, 1);
  assert.equal(executions, 0);
  assert.equal((await repository.get("worker-device-offline"))?.task.status, "queued");
});


test("startup recovery can run while the background worker remains disabled", async () => {
  const { worker, repository } = setup();
  const task = transitionTask(transitionTask(createTask({
    id: "worker-startup-recovery-disabled", founderId: "founder-primary", instruction: "Replace a local file",
  }), "planning"), "running");
  await repository.put({
    task,
    capability: "device.workspace.write_file",
    args: { deviceId: "device-123", path: "notes.md", content: "approved content" },
    attempts: 1,
    idempotencyKey: "worker-startup-recovery-disabled",
  });
  assert.equal(worker.getStatus().enabled, false);
  assert.equal(await worker.recoverInterrupted(), 1);
  assert.equal(worker.getStatus().enabled, false);
  assert.equal((await repository.get("worker-startup-recovery-disabled"))?.task.status, "requires_recovery");
});





test("worker executes bounded local directory listing without mutation approval", async () => {
  let executedCapability = "";
  let executedArgs: Record<string, unknown> | undefined;
  const { orchestrator, worker, repository } = setup(async input => {
    executedCapability = input.capability;
    executedArgs = input.args;
    return {
      result: { path: "src", entries: [{ name: "agent.ts", type: "file" }, { name: "core", type: "directory" }], count: 2, truncated: false },
      evidence: { kind: "device-list-sha256", description: "Bounded local directory listing hashed.", reference: "sha256:" + "d".repeat(64), observedAt: new Date().toISOString() },
    };
  });
  const deviceFounder = { ...founder, scopes: ["device:read"] };
  const args = { deviceId: "device-123", path: "src" };
  await orchestrator.enqueue({
    id: "worker-device-list-1", founderId: "founder-primary", instruction: "List the paired PC source directory",
    capability: "device.workspace.list_directory", args, actor: deviceFounder,
  });
  const result = await worker.runOnce();
  assert.equal(result.executed, 1);
  assert.equal(executedCapability, "device.workspace.list_directory");
  assert.deepEqual(executedArgs, args);
  assert.equal((await repository.get("worker-device-list-1"))?.task.status, "completed");
});

test("worker executes bounded local workspace search without mutation approval", async () => {
  let executedCapability = "";
  let executedArgs: Record<string, unknown> | undefined;
  const { orchestrator, worker, repository } = setup(async input => {
    executedCapability = input.capability;
    executedArgs = input.args;
    return {
      result: { query: "executeTask", matches: [{ path: "src/agent.ts", line: 12, preview: "executeTask()" }], filesScanned: 8, directoriesScanned: 2, truncated: false },
      evidence: { kind: "device-search-sha256", description: "Bounded local search result hashed.", reference: "sha256:" + "a".repeat(64), observedAt: new Date().toISOString() },
    };
  });
  const deviceFounder = { ...founder, scopes: ["device:read"] };
  const args = { deviceId: "device-123", path: ".", query: "executeTask" };
  await orchestrator.enqueue({
    id: "worker-device-search-1", founderId: "founder-primary", instruction: "Find executeTask in the paired PC workspace",
    capability: "device.workspace.search_files", args, actor: deviceFounder,
  });
  const result = await worker.runOnce();
  assert.equal(result.executed, 1);
  assert.equal(executedCapability, "device.workspace.search_files");
  assert.deepEqual(executedArgs, args);
  assert.equal((await repository.get("worker-device-search-1"))?.task.status, "completed");
});

test("worker executes a local PC file move only after exact Founder approval", async () => {
  let executedCapability = "";
  let executedArgs: Record<string, unknown> | undefined;
  const { orchestrator, worker, repository, approvals } = setup(async input => {
    executedCapability = input.capability;
    executedArgs = input.args;
    return {
      result: { moved: true, verified: true, fromPath: "inbox/report.md", toPath: "archive/report.md", sha256: "f".repeat(64) },
      evidence: { kind: "device-move-sha256", description: "Local file move verified.", reference: "sha256:" + "f".repeat(64), observedAt: new Date().toISOString() },
    };
  });
  const deviceFounder = { ...founder, scopes: ["device:write"] };
  const args = { deviceId: "device-123", fromPath: "inbox/report.md", toPath: "archive/report.md" };
  await orchestrator.enqueue({
    id: "worker-device-move-1", founderId: "founder-primary", instruction: "Move the report into the archive",
    capability: "device.workspace.move_file", args, actor: deviceFounder,
  });
  const pending = await orchestrator.requestApproval("worker-device-move-1", deviceFounder);
  await orchestrator.decideApproval({ approvalId: pending.approvalId, approved: true, actor: founder });
  const result = await worker.runOnce();
  assert.equal(result.executed, 1);
  assert.equal(executedCapability, "device.workspace.move_file");
  assert.deepEqual(executedArgs, args);
  assert.equal((await repository.get("worker-device-move-1"))?.task.status, "completed");
  assert.equal((await approvals.listForFounder("founder-primary")).find(item => item.id === pending.approvalId)?.status, "consumed");
});

test("worker creates a new local PC file only after exact Founder approval", async () => {
  let executedArgs: Record<string, unknown> | undefined;
  const { orchestrator, worker, repository, approvals } = setup(async input => {
    executedArgs = input.args;
    return {
      result: { created: true, verified: true, sha256: "e".repeat(64) },
      evidence: { kind: "device-create-sha256", description: "Local file creation verified.", reference: "sha256:" + "e".repeat(64), observedAt: new Date().toISOString() },
    };
  });
  const deviceFounder = { ...founder, scopes: ["device:write"] };
  const args = { deviceId: "device-123", path: "reports/new.md", content: "Exact approved new file" };
  await orchestrator.enqueue({
    id: "worker-device-create-1", founderId: "founder-primary", instruction: "Create a local PC report",
    capability: "device.workspace.create_file", args, actor: deviceFounder,
  });
  const pending = await orchestrator.requestApproval("worker-device-create-1", deviceFounder);
  await orchestrator.decideApproval({ approvalId: pending.approvalId, approved: true, actor: founder });
  const result = await worker.runOnce();
  assert.equal(result.executed, 1);
  assert.deepEqual(executedArgs, args);
  assert.equal((await repository.get("worker-device-create-1"))?.task.status, "completed");
  assert.equal((await approvals.listForFounder("founder-primary")).find(item => item.id === pending.approvalId)?.status, "consumed");
});

test("worker executes fixed repository validation only after exact Founder approval", async () => {
  let executedCapability = "";
  const { orchestrator, worker, repository, approvals } = setup(async input => {
    executedCapability = input.capability;
    return {
      result: { passed: true, commands: ["lint", "test", "build"] },
      evidence: { kind: "workspace-validation-suite", description: "All fixed validation commands passed.", reference: "sha256:" + "d".repeat(64), observedAt: new Date().toISOString() },
    };
  });
  const validationFounder = { ...founder, scopes: ["tests:run"] };
  await orchestrator.enqueue({
    id: "worker-validation-1", founderId: "founder-primary",
    instruction: "Run fixed lint, test and build suite.",
    capability: "workspace.run_validation", args: {}, actor: validationFounder,
  });
  const pending = await orchestrator.requestApproval("worker-validation-1", validationFounder);
  await orchestrator.decideApproval({ approvalId: pending.approvalId, approved: true, actor: validationFounder });
  const result = await worker.runOnce();
  assert.equal(result.executed, 1);
  assert.equal(executedCapability, "workspace.run_validation");
  assert.equal((await repository.get("worker-validation-1"))?.task.status, "completed");
  assert.equal((await approvals.listForFounder("founder-primary")).find(item => item.id === pending.approvalId)?.status, "consumed");
});
