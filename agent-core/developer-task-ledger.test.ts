import test from "node:test";
import assert from "node:assert/strict";
import type { TaskEnvelope, TaskRepository } from "./task-orchestrator.ts";
import {
  developerQAEvidenceDigest,
  finishDeveloperExecutionTask,
  markDeveloperExecutionRecovery,
  markDeveloperExecutionVerifying,
  startDeveloperExecutionTask,
} from "./developer-task-ledger.ts";

function repository(): TaskRepository & { records: Map<string, TaskEnvelope> } {
  const records = new Map<string, TaskEnvelope>();
  return {
    records,
    get: async (id, founderId) => {
      const value = records.get(id);
      return value && (!founderId || value.task.founderId === founderId) ? structuredClone(value) : undefined;
    },
    put: async envelope => { records.set(envelope.task.id, structuredClone(envelope)); },
    list: async founderId => [...records.values()].filter(value => value.task.founderId === founderId),
  };
}

test("tracks approved Developer apply through independent QA to verified completion", async () => {
  const repo = repository();
  let task = await startDeveloperExecutionTask(repo, {
    taskId: "dev-task-1", founderId: "founder-1", changeId: "change-1", packageSha256: "a".repeat(64),
  });
  assert.equal(task.task.status, "running");
  assert.equal(task.capability, "developer.change.apply");
  assert.equal(task.task.requiresApproval, false, "exact approval is enforced by the separate apply-approval ledger");
  task = await markDeveloperExecutionVerifying(repo, task, { snapshotId: "snapshot-1", appliedFiles: ["src/a.ts"] });
  assert.equal(task.task.status, "verifying");
  const digest = developerQAEvidenceDigest({
    passed: true, summary: "typecheck, tests and build passed",
    results: [{ command: "typecheck", status: "passed", exitCode: 0, timedOut: false }],
  });
  task = await finishDeveloperExecutionTask(repo, task, { passed: true, summary: "typecheck, tests and build passed", evidenceDigest: digest });
  assert.equal(task.task.status, "completed");
  assert.equal(task.task.progress, 100);
  assert.equal(task.task.verificationEvidence[0].reference, "sha256:" + digest);
  assert.equal((await repo.get("dev-task-1", "founder-1"))?.task.status, "completed");
});

test("records QA failure after rollback as a failed Developer task", async () => {
  const repo = repository();
  let task = await startDeveloperExecutionTask(repo, {
    taskId: "dev-task-2", founderId: "founder-1", changeId: "change-2", packageSha256: "b".repeat(64),
  });
  task = await markDeveloperExecutionVerifying(repo, task, { snapshotId: "snapshot-2", appliedFiles: ["src/b.ts"] });
  task = await finishDeveloperExecutionTask(repo, task, { passed: false, summary: "tests failed; exact snapshot restored", evidenceDigest: "c".repeat(64) });
  assert.equal(task.task.status, "failed");
  assert.match(task.task.lastError || "", /rolled back/);
});

test("parks uncertain execution and QA outcomes for explicit recovery, never auto-queues them", async () => {
  const repo = repository();
  const task = await startDeveloperExecutionTask(repo, {
    taskId: "dev-task-3", founderId: "founder-1", changeId: "change-3", packageSha256: "d".repeat(64),
  });
  await markDeveloperExecutionRecovery(repo, task, "QA worker stopped before returning evidence.");
  const saved = await repo.get("dev-task-3", "founder-1");
  assert.equal(saved?.task.status, "requires_recovery");
});

test("rejects task ID reuse across Developer executions", async () => {
  const repo = repository();
  const input = { taskId: "dev-task-4", founderId: "founder-1", changeId: "change-4", packageSha256: "e".repeat(64) };
  await startDeveloperExecutionTask(repo, input);
  await assert.rejects(startDeveloperExecutionTask(repo, input), /already present/);
});
