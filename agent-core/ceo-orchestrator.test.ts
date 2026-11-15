import test from "node:test";
import assert from "node:assert/strict";
import { CEOOrchestrator, validateCEODispatchPlan, CEOPlanValidationError } from "./ceo-orchestrator.ts";
import type { SpecialistResult } from "./specialist-runtime.ts";
import { TaskOrchestrator, type TaskEnvelope, type TaskRepository } from "./task-orchestrator.ts";
import { CapabilityRegistry } from "./capability-registry.ts";
import { ApprovalLedger } from "./approval-ledger.ts";
import { TaskWorker } from "./task-worker.ts";

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

test("CEO specialist assignments are queued, executed and verified by the shared TaskWorker", async () => {
  const repository = memoryTaskRepository();
  const registry = new CapabilityRegistry();
  registry.register({
    name: "ceo.specialist.run",
    description: "Run a bounded read-only specialist assignment.",
    risk: "low",
    allowedRoles: ["worker"],
    requiredScopes: ["agents:execute"],
    arguments: {
      runId: { type: "string", required: true, maxLength: 128 },
      agentId: { type: "string", required: true, maxLength: 64 },
      task: { type: "string", required: true, maxLength: 2000 },
      context: { type: "string", required: false, maxLength: 8000 },
    },
    timeoutMs: 10_000,
    requiresApproval: false,
    verification: "Persist a digest of the bounded specialist output.",
  });
  const orchestrator = new TaskOrchestrator(repository, registry, new ApprovalLedger(), {
    run: async ({ capability, args, founderId }) => {
      assert.equal(capability, "ceo.specialist.run");
      assert.equal(founderId, "founder-42");
      const finding = result(String(args.agentId));
      return {
        result: finding,
        evidence: {
          kind: "ceo-specialist-output-sha256",
          description: "Specialist output digest verified.",
          reference: "sha256:" + "b".repeat(64),
          observedAt: finding.completedAt,
        },
      };
    },
  });
  const worker = new TaskWorker(repository, orchestrator, registry, { founderId: "founder-42" }, new ApprovalLedger());
  const ceo = new CEOOrchestrator({
    plan: async () => JSON.stringify(dispatch),
    synthesize: async ({ findings }) => findings.map(item => item.output).join("\\n"),
  }, {
    run: async () => { throw new Error("CEO must dispatch through TaskWorker, not execute specialists directly."); },
  }, repository, {
    dispatch: async ({ founderId, taskIds }) => {
      assert.equal(founderId, "founder-42");
      const queued = await Promise.all(taskIds.map(id => repository.get(id, founderId)));
      assert.ok(queued.every(item => item?.task.status === "queued"));
      const cycle = await worker.runOnce();
      assert.equal(cycle.executed, taskIds.length);
    },
  });
  const output = await ceo.run({ objective: "Review the launch plan", founderId: "founder-42", runId: "ceo-shared-worker-run" });
  assert.equal(output.executionMode, "multi_specialist_durable_task_worker");
  assert.deepEqual(output.findings.map(item => item.agentId), ["research", "finance"]);
  const records = await repository.list("founder-42");
  assert.equal(records.length, 2);
  assert.ok(records.every(item => item.task.status === "completed"));
  assert.ok(records.every(item => item.task.verificationEvidence.some(evidence => evidence.kind === "ceo-specialist-output-sha256")));
  assert.ok(records.every(item => (item.result as SpecialistResult).output.endsWith("findings")));
});

test("CEO rejects oversized run identifiers before dispatch", async () => {
  const ceo = new CEOOrchestrator({
    plan: async () => JSON.stringify(dispatch),
    synthesize: async () => "unused",
  }, { run: async input => result(input.agentId) });
  await assert.rejects(
    () => ceo.run({ objective: "Review launch plan", runId: "r".repeat(129) }),
    /run ID must be at most 128 characters/,
  );
});
