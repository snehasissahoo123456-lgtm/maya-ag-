import test from "node:test";
import assert from "node:assert/strict";
import { CapabilityRegistry } from "./capability-registry.ts";
import { SpecialistToolExecutor } from "./specialist-tool-executor.ts";

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
