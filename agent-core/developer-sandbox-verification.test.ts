import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  approveDeveloperChange, createDeveloperChangeRequest, recordDeveloperReview,
  startDeveloperChangeExecution, submitDeveloperChange,
} from "./developer-change-control.ts";
import {
  verifyDeveloperWorkspaceExecution,
} from "./developer-sandbox-verification.ts";
import type { DeveloperExecutionResult, DeveloperWorkspaceAdapter } from "./developer-workspace-executor.ts";
import type { SandboxResult } from "./developer-sandbox-worker.ts";

const founderId = "founder-001";
const baselineCommit = "a".repeat(40);
const fixedNow = new Date("2026-11-11T14:00:00.000Z");
function execution(): DeveloperExecutionResult {
  const patch = "diff --git a/src/app.ts b/src/app.ts\n+export const ready = true;\n";
  const digest = "b".repeat(64);
  let change = createDeveloperChangeRequest({
    id: "change-001", founderId, title: "Build feature", objective: "Verify feature",
    workspaceId: "workspace-001", files: ["src/app.ts"], patch, diffSha256: digest, now: fixedNow,
  });
  change = submitDeveloperChange(change, fixedNow);
  change = recordDeveloperReview(change, { reviewerId: "reviewer-001", decision: "approved", notes: "Reviewed", now: fixedNow });
  change = approveDeveloperChange(change, founderId, fixedNow);
  change = startDeveloperChangeExecution(change, fixedNow);
  return { status: "applied", change, snapshotId: "snapshot-001", packageSha256: "c".repeat(64), appliedFiles: ["src/app.ts"] };
}
function workspace(calls: string[]): DeveloperWorkspaceAdapter {
  return {
    async inspect() { return { workspaceId: "workspace-001", baselineCommit, isolated: true, networkAccess: false, secretsMounted: false }; },
    async applyAtomically() { return { snapshotId: "snapshot-001" }; },
    async restoreSnapshot(id) { calls.push("restore:" + id); },
  };
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "maya-verify-"));
  const queueRoot = path.join(root, "queue");
  await fs.mkdir(path.join(queueRoot, "baselines"), { recursive: true });
  await fs.writeFile(path.join(queueRoot, "baselines", "workspace-001.sha"), baselineCommit + "\n");
  return { root, queueRoot };
}
async function fakeWorker(queueRoot: string, failCommand?: string) {
  const pending = path.join(queueRoot, "pending");
  const results = path.join(queueRoot, "results");
  await fs.mkdir(results, { recursive: true });
  for (const name of await fs.readdir(pending)) {
    if (!name.endsWith(".json")) continue;
    const job = JSON.parse(await fs.readFile(path.join(pending, name), "utf8"));
    const failed = job.command === failCommand;
    const result: SandboxResult = {
      id: job.id, workspaceId: job.workspaceId, command: job.command,
      status: failed ? "failed" : "passed", exitCode: failed ? 1 : 0,
      timedOut: false, durationMs: 10, output: failed ? "check failed" : "check passed",
      finishedAt: "2026-11-11T13:59:00.000Z",
    };
    await fs.writeFile(path.join(results, job.id + ".json"), JSON.stringify(result));
  }
}

test("records completion only after all three isolated checks pass", async () => {
  const f = await fixture(), calls: string[] = [], run = execution();
  let monotonic = 0;
  const outcome = await verifyDeveloperWorkspaceExecution({
    execution: run, baselineCommit, queueRoot: f.queueRoot, workspace: workspace(calls),
    now: () => fixedNow, monotonicNow: () => monotonic,
    sleep: async () => { await fakeWorker(f.queueRoot); monotonic += 100; },
  });
  assert.equal(outcome.qa.passed, true);
  assert.equal(outcome.change.status, "completed");
  assert.equal(outcome.rolledBack, false);
  assert.equal(outcome.jobs.length, 3);
  assert.deepEqual(calls, []);
  await fs.rm(f.root, { recursive: true, force: true });
});

test("rolls back automatically when any sandbox check fails", async () => {
  const f = await fixture(), calls: string[] = [], run = execution();
  let monotonic = 0;
  const outcome = await verifyDeveloperWorkspaceExecution({
    execution: run, baselineCommit, queueRoot: f.queueRoot, workspace: workspace(calls),
    now: () => fixedNow, monotonicNow: () => monotonic,
    sleep: async () => { await fakeWorker(f.queueRoot, "test"); monotonic += 100; },
  });
  assert.equal(outcome.qa.passed, false);
  assert.equal(outcome.change.status, "rolled_back");
  assert.equal(outcome.rolledBack, true);
  assert.deepEqual(calls, ["restore:snapshot-001"]);
  await fs.rm(f.root, { recursive: true, force: true });
});

test("rolls back when the worker does not return all required results before timeout", async () => {
  const f = await fixture(), calls: string[] = [], run = execution();
  let monotonic = 0;
  const outcome = await verifyDeveloperWorkspaceExecution({
    execution: run, baselineCommit, queueRoot: f.queueRoot, workspace: workspace(calls),
    maxWaitMs: 1000, pollIntervalMs: 500, now: () => fixedNow,
    monotonicNow: () => monotonic, sleep: async ms => { monotonic += ms; },
  });
  assert.equal(outcome.timedOut, true);
  assert.equal(outcome.qa.passed, false);
  assert.equal(outcome.change.status, "rolled_back");
  assert.deepEqual(calls, ["restore:snapshot-001"]);
  await fs.rm(f.root, { recursive: true, force: true });
});

test("rolls back if queue creation fails and rejects executions without applied state", async () => {
  const f = await fixture(), calls: string[] = [], run = execution();
  const mismatch = await verifyDeveloperWorkspaceExecution({
    execution: run, baselineCommit: "b".repeat(40), queueRoot: f.queueRoot, workspace: workspace(calls),
    now: () => fixedNow,
  });
  assert.equal(mismatch.rolledBack, true);
  assert.equal(mismatch.change.status, "rolled_back");
  assert.deepEqual(calls, ["restore:snapshot-001"]);
  await assert.rejects(() => verifyDeveloperWorkspaceExecution({
    execution: { ...run, status: "not_applied" as never }, baselineCommit, queueRoot: f.queueRoot, workspace: workspace([]),
  }), /successfully applied/i);
  await fs.rm(f.root, { recursive: true, force: true });
});

test("rolls back when the workspace is no longer isolated before checks begin", async () => {
  const f = await fixture(), calls: string[] = [], run = execution();
  const unsafe = workspace(calls);
  unsafe.inspect = async () => ({
    workspaceId: "workspace-001", baselineCommit, isolated: false,
    networkAccess: false, secretsMounted: false,
  });
  const outcome = await verifyDeveloperWorkspaceExecution({
    execution: run, baselineCommit, queueRoot: f.queueRoot, workspace: unsafe, now: () => fixedNow,
  });
  assert.equal(outcome.rolledBack, true);
  assert.match(outcome.failure ?? "", /isolation/i);
  assert.equal(outcome.change.status, "rolled_back");
  assert.deepEqual(calls, ["restore:snapshot-001"]);
  await fs.rm(f.root, { recursive: true, force: true });
});
