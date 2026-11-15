import test from "node:test";
import assert from "node:assert/strict";
import { SpecialistRuntime, listRunnableSpecialists } from "./specialist-runtime.ts";
import { AGENT_MANIFESTS, getAgentManifest } from "./agent-manifests.ts";
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

test("lists runnable department templates but excludes Founder identity", () => {
  const agents = listRunnableSpecialists();
  const expected = [
    "research", "operations", "content", "finance", "product", "marketing", "sales",
    "customer-support", "people-ops", "legal-compliance", "procurement",
    "executive-assistant", "data-analytics", "security-it", "real-estate", "hospitality",
    "developer",
  ];
  for (const id of expected) assert.ok(agents.some(agent => agent.id === id), "missing department template: " + id);
  assert.ok(!agents.some(agent => agent.id === "founder"));
  assert.equal(AGENT_MANIFESTS.length, expected.length + 2);
});

test("department templates cannot create agents, approve actions or delegate recursively", () => {
  const departments = AGENT_MANIFESTS.filter(agent => agent.role === "specialist");
  assert.ok(departments.length >= 15);
  for (const agent of departments) {
    assert.equal(agent.mayCreateAgents, false, agent.id);
    assert.equal(agent.mayApproveActions, false, agent.id);
    assert.deepEqual(agent.allowedDelegates, [], agent.id);
    assert.ok(agent.maxConcurrentTasks >= 1 && agent.maxConcurrentTasks <= 3, agent.id);
  }
  assert.equal(getAgentManifest("ceo")?.mayApproveActions, false);
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
