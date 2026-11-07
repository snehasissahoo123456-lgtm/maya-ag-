import test from "node:test";
import assert from "node:assert/strict";
import { createTask, isTerminalTaskStatus, TaskTransitionError, transitionTask } from "./task-lifecycle.ts";

const time = "2026-11-07T00:00:00.000Z";

test("creates a queued task with validated identity and instruction", () => {
  const task = createTask({ id: "task-1", founderId: "founder-1", instruction: "  Research vendors  " }, time);
  assert.equal(task.status, "queued");
  assert.equal(task.instruction, "Research vendors");
  assert.equal(task.progress, 0);
});

test("high-risk tasks require approval before execution", () => {
  const task = createTask({ id: "task-2", founderId: "founder-1", instruction: "Transfer funds", riskLevel: "critical" }, time);
  const planning = transitionTask(task, "planning", { now: time });
  const approval = transitionTask(planning, "awaiting_approval", { now: time });
  assert.throws(() => transitionTask(approval, "running", { now: time }), TaskTransitionError);
  const running = transitionTask(approval, "running", { approvalGranted: true, now: time });
  assert.equal(running.status, "running");
  assert.equal(running.approvalGrantedAt, time);
});

test("completion is blocked without verification evidence", () => {
  const task = createTask({ id: "task-3", founderId: "founder-1", instruction: "Create report" }, time);
  const planning = transitionTask(task, "planning", { now: time });
  const running = transitionTask(planning, "running", { now: time });
  const verifying = transitionTask(running, "verifying", { now: time });
  assert.throws(() => transitionTask(verifying, "completed", { now: time }), TaskTransitionError);
  const completed = transitionTask(verifying, "completed", {
    now: time,
    evidence: { kind: "artifact", description: "Report file exists and passed validation.", reference: "reports/report.md", observedAt: time },
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.progress, 100);
  assert.equal(completed.verificationEvidence.length, 1);
});

test("rejects invalid transitions and changes from terminal states", () => {
  const task = createTask({ id: "task-4", founderId: "founder-1", instruction: "Do work" }, time);
  assert.throws(() => transitionTask(task, "completed", { now: time }), TaskTransitionError);
  const cancelled = transitionTask(task, "cancelled", { now: time });
  assert.equal(isTerminalTaskStatus(cancelled.status), true);
  assert.throws(() => transitionTask(cancelled, "queued", { now: time }), TaskTransitionError);
});

test("failed tasks retain a failure reason and can be re-queued", () => {
  const task = createTask({ id: "task-5", founderId: "founder-1", instruction: "Build app" }, time);
  const planning = transitionTask(task, "planning", { now: time });
  const failed = transitionTask(planning, "failed", { error: "Missing build dependency", now: time });
  assert.equal(failed.lastError, "Missing build dependency");
  assert.equal(transitionTask(failed, "queued", { now: time }).status, "queued");
});
