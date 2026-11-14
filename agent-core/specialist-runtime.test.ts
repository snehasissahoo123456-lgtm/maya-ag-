import test from "node:test";
import assert from "node:assert/strict";
import { SpecialistRuntime, listRunnableSpecialists } from "./specialist-runtime.ts";

test("runs a named specialist with bounded identity and no tool permissions", async () => {
  let prompt = "";
  const runtime = new SpecialistRuntime({ generate: async input => { prompt = input.systemInstruction; return "Findings: review the README and verify CI before release."; } });
  const result = await runtime.run({ agentId: "research", task: "Review the current product architecture." });
  assert.equal(result.agentId, "research");
  assert.equal(result.executionMode, "reasoning_only");
  assert.match(prompt, /no tools, browser, filesystem, shell/i);
  assert.match(prompt, /Do not claim to have executed actions/i);
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
