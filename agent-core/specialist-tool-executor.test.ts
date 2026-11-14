import test from "node:test";
import assert from "node:assert/strict";
import { CapabilityRegistry } from "./capability-registry.ts";
import { SpecialistToolExecutor } from "./specialist-tool-executor.ts";
import type { TaskEnvelope, TaskRepository } from "./task-orchestrator.ts";

function registry() {
  const value = new CapabilityRegistry();
  value.register({
    name: "workspace.read_file",
    description: "Read a non-secret workspace file.",
    risk: "low",
    allowedRoles: ["developer"],
    requiredScopes: ["workspace:read"],
    arguments: { path: { type: "string", required: true, maxLength: 100 } },
    timeoutMs: 1000,
    requiresApproval: false,
    verification: "Return the bounded file contents and SHA-256 evidence.",
  });
  value.register({
    name: "workspace.write_file",
    description: "Write a workspace file.",
    risk: "high",
    allowedRoles: ["developer"],
    requiredScopes: ["workspace:write"],
    arguments: { path: { type: "string", required: true } },
    timeoutMs: 1000,
    requiresApproval: true,
    verification: "Verify the written file.",
  });
  value.register({
    name: "memory.search",
    description: "Search Founder memory.",
    risk: "low",
    allowedRoles: ["specialist"],
    requiredScopes: ["memory:read"],
    arguments: { query: { type: "string", required: true, maxLength: 100 } },
    timeoutMs: 1000,
    requiresApproval: false,
    verification: "Return matching Founder-owned notes.",
  });
  return value;
}

test("lists only low-risk capabilities whose scopes are present in the specialist manifest", () => {
  const executor = new SpecialistToolExecutor(registry(), async () => "ok");
  assert.deepEqual(executor.list("developer").map(tool => tool.name), ["workspace.read_file"]);
  assert.deepEqual(executor.list("research").map(tool => tool.name), ["memory.search"]);
  assert.deepEqual(executor.list("founder"), []);
  assert.deepEqual(executor.list("ceo"), []);
});

test("executes an allowed capability with the Founder identity and validated arguments", async () => {
  let observed: unknown;
  const executor = new SpecialistToolExecutor(registry(), async (name, args, context) => {
    observed = { name, args, founderId: context.founderId, aborted: context.signal.aborted };
    return { content: "read-only result" };
  });
  const result = await executor.execute("developer", "founder-1", "workspace.read_file", { path: "README.md" });
  assert.deepEqual(result, { content: "read-only result" });
  assert.deepEqual(observed, {
    name: "workspace.read_file",
    args: { path: "README.md" },
    founderId: "founder-1",
    aborted: false,
  });
});

test("denies write capabilities, unknown roles, missing Founder identity and invalid arguments", async () => {
  const executor = new SpecialistToolExecutor(registry(), async () => "should not run");
  await assert.rejects(executor.execute("developer", "founder-1", "workspace.write_file", { path: "README.md" }), /Specialists may execute only low-risk|Required capability scope|role is not allowed|not registered/);
  await assert.rejects(executor.execute("founder", "founder-1", "workspace.read_file", { path: "README.md" }), /non-runnable/);
  await assert.rejects(executor.execute("developer", "", "workspace.read_file", { path: "README.md" }), /Founder identity/);
  await assert.rejects(executor.execute("developer", "founder-1", "workspace.read_file", { path: "../.env", extra: true }), /Unexpected argument/);
});

test("enforces the capability timeout and aborts its execution signal", async () => {
  const value = new CapabilityRegistry();
  value.register({
    name: "workspace.slow_read",
    description: "Slow read.",
    risk: "low",
    allowedRoles: ["developer"],
    requiredScopes: ["workspace:read"],
    arguments: {},
    timeoutMs: 100,
    requiresApproval: false,
    verification: "Read and hash.",
  });
  let signal: AbortSignal | undefined;
  const executor = new SpecialistToolExecutor(value, async (_name, _args, context) => {
    signal = context.signal;
    await new Promise(resolve => setTimeout(resolve, 250));
    return "late";
  });
  await assert.rejects(executor.execute("developer", "founder-1", "workspace.slow_read", {}), /timed out/);
  assert.equal(signal?.aborted, true);
});

test("rejects oversized capability results", async () => {
  const executor = new SpecialistToolExecutor(registry(), async () => "x".repeat(100), 10);
  await assert.rejects(executor.execute("developer", "founder-1", "workspace.read_file", { path: "README.md" }), /response limit/);
});

test("emits redacted success audit evidence without arguments or returned content", async () => {
  const events: Array<Record<string, unknown>> = [];
  const executor = new SpecialistToolExecutor(
    registry(),
    async () => ({ content: "private file contents must not enter the audit record" }),
    32_000,
    event => { events.push(event as unknown as Record<string, unknown>); },
  );
  await executor.execute("developer", "founder-1", "workspace.read_file", { path: "private.txt" });
  assert.equal(events.length, 1);
  assert.equal(events[0].status, "success");
  assert.equal(events[0].agentId, "developer");
  assert.equal(events[0].founderId, "founder-1");
  assert.equal(events[0].capability, "workspace.read_file");
  assert.equal(typeof events[0].resultSha256, "string");
  assert.equal((events[0].resultSha256 as string).length, 64);
  assert.equal(typeof events[0].resultBytes, "number");
  assert.equal("args" in events[0], false);
  assert.equal(JSON.stringify(events[0]).includes("private file contents"), false);
});

test("emits a redacted denial event when policy rejects a specialist tool", async () => {
  const events: Array<Record<string, unknown>> = [];
  const executor = new SpecialistToolExecutor(
    registry(),
    async () => "should not execute",
    32_000,
    event => { events.push(event as unknown as Record<string, unknown>); },
  );
  await assert.rejects(executor.execute("developer", "founder-1", "workspace.write_file", { path: "private.txt" }), /low-risk/);
  assert.equal(events.length, 1);
  assert.equal(events[0].status, "denied");
  assert.equal(events[0].errorCode, "policy_denied");
  assert.equal("args" in events[0], false);
});

test("waits for durable audit acknowledgement before returning specialist tool results", async () => {
  const order: string[] = [];
  const executor = new SpecialistToolExecutor(
    registry(),
    async () => { order.push("handler"); return { content: "safe" }; },
    32_000,
    async event => {
      order.push("audit-start");
      await Promise.resolve();
      assert.equal(event.actorRole, "developer");
      order.push("audit-committed");
    },
  );
  const result = await executor.execute("developer", "founder-1", "workspace.read_file", { path: "README.md" });
  assert.deepEqual(result, { content: "safe" });
  assert.deepEqual(order, ["handler", "audit-start", "audit-committed"]);
});

test("fails closed when specialist audit persistence cannot be acknowledged", async () => {
  const executor = new SpecialistToolExecutor(
    registry(),
    async () => ({ content: "safe" }),
    32_000,
    async () => { throw new Error("durable audit unavailable"); },
  );
  await assert.rejects(
    executor.execute("developer", "founder-1", "workspace.read_file", { path: "README.md" }),
    /durable audit unavailable/,
  );
});


test("records successful specialist tool execution in the shared Founder task ledger", async () => {
  const rows = new Map<string, TaskEnvelope>();
  const repository: TaskRepository = {
    async get(id, founderId) {
      const value = rows.get(id);
      return value && (!founderId || value.task.founderId === founderId) ? structuredClone(value) : undefined;
    },
    async put(value) { rows.set(value.task.id, structuredClone(value)); },
    async list(founderId) {
      return [...rows.values()].filter(value => value.task.founderId === founderId).map(value => structuredClone(value));
    },
  };
  const events: Array<Record<string, unknown>> = [];
  const executor = new SpecialistToolExecutor(
    registry(),
    async () => ({ content: "private tool output" }),
    32_000,
    event => { events.push(event as unknown as Record<string, unknown>); },
    repository,
  );
  const result = await executor.execute("developer", "founder-1", "workspace.read_file", { path: "README.md" });
  assert.deepEqual(result, { content: "private tool output" });
  const tasks = await repository.list("founder-1");
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].task.status, "completed");
  assert.equal(tasks[0].capability, "workspace.read_file");
  assert.equal(tasks[0].task.verificationEvidence.length, 1);
  assert.equal(typeof (tasks[0].result as any).resultSha256, "string");
  assert.equal(JSON.stringify(tasks[0]).includes("private tool output"), false);
  assert.equal(events[0].taskId, tasks[0].task.id);
});

test("parks specialist tool task for recovery if durable success audit fails after tool result", async () => {
  const rows = new Map<string, TaskEnvelope>();
  const repository: TaskRepository = {
    async get(id) { const value = rows.get(id); return value ? structuredClone(value) : undefined; },
    async put(value) { rows.set(value.task.id, structuredClone(value)); },
    async list(founderId) {
      return [...rows.values()].filter(value => value.task.founderId === founderId).map(value => structuredClone(value));
    },
  };
  const executor = new SpecialistToolExecutor(
    registry(),
    async () => ({ content: "result returned" }),
    32_000,
    async () => { throw new Error("audit unavailable"); },
    repository,
  );
  await assert.rejects(executor.execute("developer", "founder-1", "workspace.read_file", { path: "README.md" }), /audit unavailable/);
  const tasks = await repository.list("founder-1");
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].task.status, "requires_recovery");
});
