import test from "node:test";
import assert from "node:assert/strict";
import { SpecialistRuntime, listRunnableSpecialists } from "./specialist-runtime.ts";
import { CapabilityRegistry } from "./capability-registry.ts";
import { SpecialistToolExecutor } from "./specialist-tool-executor.ts";

test("runs a named specialist with bounded identity and no tool permissions", async () => {
  let prompt = "";
  const runtime = new SpecialistRuntime({ generate: async input => { prompt = input.systemInstruction; return "Findings: review the README and verify CI before release."; } });
  const result = await runtime.run({ agentId: "research", task: "Review the current product architecture." });
  assert.equal(result.agentId, "research");
  assert.equal(result.executionMode, "reasoning_only");
  assert.match(prompt, /no tools, browser, filesystem, shell/i);
  assert.match(prompt, /Never claim to have executed actions/i);
});

test("lists runnable roles but excludes Founder identity", () => {
  const agents = listRunnableSpecialists();
  assert.ok(agents.some(agent => agent.id === "research"));
  assert.ok(agents.some(agent => agent.id === "developer"));
  assert.ok(!agents.some(agent => agent.id === "founder"));
});

test("rejects Founder, unknown roles, and oversized tasks", async () => {
  const runtime = new SpecialistRuntime({ generate: async () => "ok" });
  await assert.rejects(runtime.run({ agentId: "founder", task: "Do this" }), /non-runnable/);
  await assert.rejects(runtime.run({ agentId: "unknown", task: "Do this" }), /non-runnable/);
  await assert.rejects(runtime.run({ agentId: "research", task: "x".repeat(4001) }), /1–4,000/);
});

test("rejects empty and oversized model output", async () => {
  const empty = new SpecialistRuntime({ generate: async () => " " });
  await assert.rejects(empty.run({ agentId: "finance", task: "Review the budget." }), /empty result/);
  const large = new SpecialistRuntime({ generate: async () => "x".repeat(16001) });
  await assert.rejects(large.run({ agentId: "finance", task: "Review the budget." }), /16 KB/);
});

test("passes only manifest-scoped read-only tools into the specialist model adapter", async () => {
  const registry = new CapabilityRegistry();
  registry.register({
    name: "specialist.workspace.read_file",
    description: "Read one safe workspace file.",
    risk: "low",
    allowedRoles: ["developer"],
    requiredScopes: ["workspace:read"],
    arguments: { path: { type: "string", required: true, maxLength: 100 } },
    timeoutMs: 1000,
    requiresApproval: false,
    verification: "Read bounded file content.",
  });
  registry.register({
    name: "specialist.workspace.write_file",
    description: "Write a file.",
    risk: "high",
    allowedRoles: ["developer"],
    requiredScopes: ["workspace:write"],
    arguments: { path: { type: "string", required: true, maxLength: 100 } },
    timeoutMs: 1000,
    requiresApproval: true,
    verification: "Verify file.",
  });
  let seenTools: string[] = [];
  let executed: unknown;
  const toolExecutor = new SpecialistToolExecutor(registry, async (name, args) => ({ name, args, content: "safe" }));
  const runtime = new SpecialistRuntime({
    generate: async input => {
      seenTools = input.tools.map(tool => tool.name);
      assert.ok(input.executeTool);
      executed = await input.executeTool("specialist.workspace.read_file", { path: "README.md" });
      return "Reviewed README using the read-only workspace capability.";
    },
  }, toolExecutor);
  const result = await runtime.run({ agentId: "developer", founderId: "founder-7", task: "Inspect the README." });
  assert.deepEqual(seenTools, ["specialist.workspace.read_file"]);
  assert.deepEqual(executed, { name: "specialist.workspace.read_file", args: { path: "README.md" }, content: "safe" });
  assert.equal(result.executionMode, "bounded_read_only_tools");
});

test("Developer receives a proposal-only tool that cannot write before Founder approval", async () => {
  const registry = new CapabilityRegistry();
  registry.register({
    name: "specialist.workspace.read_file",
    description: "Read a safe workspace file.",
    risk: "low",
    allowedRoles: ["developer"],
    requiredScopes: ["workspace:read"],
    arguments: { path: { type: "string", required: true, maxLength: 100 } },
    timeoutMs: 1000,
    requiresApproval: false,
    verification: "Return file text and its SHA-256.",
  });
  registry.register({
    name: "developer.propose_file_change",
    description: "Queue an exact file replacement for Founder approval.",
    risk: "low",
    allowedRoles: ["developer"],
    requiredScopes: ["workspace:write"],
    arguments: {
      path: { type: "string", required: true, maxLength: 100 },
      expectedSha256: { type: "string", required: true, maxLength: 64 },
      content: { type: "string", required: true, maxLength: 1000 },
      instruction: { type: "string", required: true, maxLength: 500 },
    },
    timeoutMs: 1000,
    requiresApproval: false,
    verification: "Queues a high-risk task; Founder approval is required before execution.",
  });
  registry.register({
    name: "developer.propose_validation",
    description: "Queue the fixed lint/test/build suite for Founder approval.",
    risk: "low",
    allowedRoles: ["developer"],
    requiredScopes: ["tests:run"],
    arguments: {},
    timeoutMs: 1000,
    requiresApproval: false,
    verification: "Queue a Founder-approved validation task.",
  });
  let prompt = "";
  let proposed: unknown;
  const executor = new SpecialistToolExecutor(registry, async () => ({ queued: true, requiresFounderApproval: true }));
  const runtime = new SpecialistRuntime({
    generate: async input => {
      prompt = input.systemInstruction;
      assert.ok(input.tools.some(tool => tool.name === "developer.propose_file_change"));
      assert.ok(input.tools.some(tool => tool.name === "developer.propose_validation"));
      proposed = await input.executeTool!("developer.propose_file_change", {
        path: "src/example.ts",
        expectedSha256: "a".repeat(64),
        content: "export const value = 2;",
        instruction: "Update the verified source file.",
      });
      return "Queued an exact-hash change proposal for Founder approval.";
    },
  }, executor);
  const result = await runtime.run({ agentId: "developer", founderId: "founder-1", task: "Inspect and propose a safe change." });
  assert.equal(result.executionMode, "bounded_tools_with_approval_requests");
  assert.match(prompt, /only queues a high-risk file replacement for Founder approval/i);
  assert.deepEqual(proposed, { queued: true, requiresFounderApproval: true });
});
