import test from "node:test";
import assert from "node:assert/strict";
import { CEOOrchestrator, validateCEODispatchPlan, CEOPlanValidationError } from "./ceo-orchestrator.ts";
import type { SpecialistResult } from "./specialist-runtime.ts";
import type { TaskEnvelope, TaskRepository } from "./task-orchestrator.ts";

const dispatch = { summary: "Use research and finance perspectives.", assignments: [
  { agentId: "research", task: "Identify the key technical risks." },
  { agentId: "finance", task: "Assess cost and resource implications." },
] };
const result = (agentId: string): SpecialistResult => ({
  agentId, displayName: agentId, role: agentId as any, task: "review", output: agentId + " findings",
  executionMode: "reasoning_only", completedAt: new Date().toISOString(),
});
function memoryTaskRepository(): TaskRepository & { records: Map<string, TaskEnvelope> } {
  const records = new Map<string, TaskEnvelope>();
  return {
    records,
    get: async id => records.get(id),
    put: async envelope => { records.set(envelope.task.id, structuredClone(envelope)); },
    list: async founderId => [...records.values()].filter(item => item.task.founderId === founderId),
  };
}

test("validates dispatches and rejects Founder, CEO recursion, duplicates and over-delegation", () => {
  assert.equal(validateCEODispatchPlan(dispatch, "Review the launch plan").assignments.length, 2);
  assert.throws(() => validateCEODispatchPlan({ ...dispatch, assignments: [{ agentId: "founder", task: "x" }] }, "Review"), CEOPlanValidationError);
  assert.throws(() => validateCEODispatchPlan({ ...dispatch, assignments: [{ agentId: "ceo", task: "recursive" }] }, "Review"), /unavailable/);
  assert.throws(() => validateCEODispatchPlan({ ...dispatch, assignments: [dispatch.assignments[0], dispatch.assignments[0]] }, "Review"), /once/);
  assert.throws(() => validateCEODispatchPlan({ ...dispatch, assignments: Array.from({ length: 5 }, (_, i) => ({ agentId: ["research","finance","developer","operations","content"][i], task: "x" })) }, "Review"), /1 and 4/);
});

test("runs assigned specialists concurrently and synthesizes findings in dispatch order", async () => {
  let active = 0;
  let maxActive = 0;
  let started = 0;
  let synthesisStarted = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const orchestrator = new CEOOrchestrator({
    plan: async () => JSON.stringify(dispatch),
    synthesize: async ({ findings }) => {
      synthesisStarted = true;
      assert.deepEqual(findings.map(f => f.agentId), ["research", "finance"]);
      return findings.map(f => f.output).join("\n");
    },
  }, {
    run: async ({ agentId, founderId }) => {
      assert.equal(founderId, "founder-42");
      active++;
      maxActive = Math.max(maxActive, active);
      started++;
      if (started === 2) release();
      await gate;
      active--;
      assert.equal(synthesisStarted, false);
      return result(agentId);
    },
  });
  const output = await orchestrator.run({ objective: "Review the launch plan", founderId: "founder-42" });
  assert.equal(maxActive, 2, "specialist work should overlap instead of running sequentially");
  assert.equal(output.findings.length, 2);
  assert.equal(output.executionMode, "multi_specialist_reasoning_only");
});

test("records CEO specialist assignments in the persistent task lifecycle without queueing them for generic workers", async () => {
  const repository = memoryTaskRepository();
  const orchestrator = new CEOOrchestrator({
    plan: async () => JSON.stringify(dispatch),
    synthesize: async ({ findings }) => findings.map(item => item.output).join("\n"),
  }, { run: async ({ agentId }) => result(agentId) }, repository);
  const output = await orchestrator.run({ objective: "Review the launch plan", founderId: "founder-42", runId: "ceo-run-fixed" });
  assert.equal(output.assignments.length, 2);
  assert.ok(output.assignments.every(item => item.taskId));
  const records = await repository.list("founder-42");
  assert.equal(records.length, 2);
  assert.ok(records.every(item => item.task.status === "completed"));
  assert.ok(records.every(item => item.task.verificationEvidence.some(evidence => evidence.kind === "ceo-specialist-output-sha256")));
  assert.ok(records.every(item => item.capability === "ceo.specialist.run"));
  assert.ok(records.every(item => item.task.status !== "queued"), "generic TaskWorker must never claim CEO-managed assignments");
});

test("marks a failed specialist assignment failed in the task ledger", async () => {
  const repository = memoryTaskRepository();
  const orchestrator = new CEOOrchestrator({
    plan: async () => JSON.stringify({ summary: "One specialist", assignments: [dispatch.assignments[0]] }),
    synthesize: async () => "unused",
  }, { run: async () => { throw new Error("specialist provider unavailable"); } }, repository);
  await assert.rejects(orchestrator.run({ objective: "Review", founderId: "founder-42", runId: "ceo-run-failure" }), /specialist provider unavailable/);
  const records = await repository.list("founder-42");
  assert.equal(records.length, 1);
  assert.equal(records[0].task.status, "failed");
  assert.match(records[0].task.lastError || "", /provider unavailable/);
});

test("does not start any specialist when CEO dispatch JSON is invalid", async () => {
  let started = false;
  const orchestrator = new CEOOrchestrator({
    plan: async () => "not json",
    synthesize: async () => "summary",
  }, { run: async () => { started = true; return result("research"); } });
  await assert.rejects(orchestrator.run({ objective: "Review" }), /invalid dispatch JSON/);
  assert.equal(started, false);
});
