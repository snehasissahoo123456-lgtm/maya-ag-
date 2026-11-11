import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  enqueueDeveloperSandboxJob, collectDeveloperSandboxResult, evaluateDeveloperSandboxQA,
} from "./developer-sandbox-queue.ts";
import type { SandboxResult } from "./developer-sandbox-worker.ts";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "maya-queue-"));
  const queueRoot = path.join(root, "queue");
  await fs.mkdir(path.join(queueRoot, "baselines"), { recursive: true });
  await fs.writeFile(path.join(queueRoot, "baselines", "workspace-001.sha"), "a".repeat(40) + "\n");
  return { root, queueRoot };
}
const clock = () => new Date("2026-11-11T14:00:00.000Z");

test("enqueues only fixed commands against the exact provisioned baseline", async () => {
  const f = await fixture();
  const job = await enqueueDeveloperSandboxJob({ queueRoot: f.queueRoot, now: clock }, {
    workspaceId: "workspace-001", baselineCommit: "a".repeat(40), command: "test",
  });
  const saved = JSON.parse(await fs.readFile(path.join(f.queueRoot, "pending", job.id + ".json"), "utf8"));
  assert.deepEqual(saved, job);
  assert.equal(job.command, "test");
  await assert.rejects(() => enqueueDeveloperSandboxJob({ queueRoot: f.queueRoot }, {
    workspaceId: "workspace-001", baselineCommit: "b".repeat(40), command: "test",
  }), /baseline/i);
  await assert.rejects(() => enqueueDeveloperSandboxJob({ queueRoot: f.queueRoot }, {
    workspaceId: "workspace-001", baselineCommit: "a".repeat(40), command: "rm" as never,
  }), /fixed command/i);
  await fs.rm(f.root, { recursive: true, force: true });
});

test("collector waits for a result and rejects mismatched worker output", async () => {
  const f = await fixture();
  const job = await enqueueDeveloperSandboxJob({ queueRoot: f.queueRoot, now: clock }, {
    workspaceId: "workspace-001", baselineCommit: "a".repeat(40), command: "build",
  });
  assert.equal(await collectDeveloperSandboxResult({ queueRoot: f.queueRoot }, job), null);
  const result: SandboxResult = {
    id: job.id, workspaceId: job.workspaceId, command: job.command, status: "passed",
    exitCode: 0, timedOut: false, durationMs: 20, output: "build passed",
    finishedAt: "2026-11-11T14:00:10.000Z",
  };
  await fs.mkdir(path.join(f.queueRoot, "results"), { recursive: true });
  await fs.writeFile(path.join(f.queueRoot, "results", job.id + ".json"), JSON.stringify(result));
  assert.deepEqual(await collectDeveloperSandboxResult({ queueRoot: f.queueRoot }, job), result);
  await fs.writeFile(path.join(f.queueRoot, "results", job.id + ".json"), JSON.stringify({ ...result, workspaceId: "other-workspace" }));
  await assert.rejects(() => collectDeveloperSandboxResult({ queueRoot: f.queueRoot }, job), /does not match/i);
  await fs.rm(f.root, { recursive: true, force: true });
});

test("QA passes only when all three worker commands have fresh passing evidence", () => {
  const now = clock();
  const make = (command: "typecheck" | "test" | "build", id: string): SandboxResult => ({
    id, workspaceId: "workspace-001", command, status: "passed", exitCode: 0,
    timedOut: false, durationMs: 20, output: command + " passed",
    finishedAt: "2026-11-11T13:59:00.000Z",
  });
  const all = [make("typecheck", "job-typecheck"), make("test", "job-test"), make("build", "job-build")];
  assert.equal(evaluateDeveloperSandboxQA(all, now).passed, true);
  assert.equal(evaluateDeveloperSandboxQA(all.slice(0, 2), now).passed, false);
  assert.equal(evaluateDeveloperSandboxQA([all[0], { ...all[1], status: "failed" }, all[2]], now).passed, false);
  assert.equal(evaluateDeveloperSandboxQA([{ ...all[0], finishedAt: "2026-11-09T00:00:00.000Z" }, all[1], all[2]], now).passed, false);
  assert.throws(() => evaluateDeveloperSandboxQA([all[0], all[0], all[2]], now), /Duplicate/);
});

test("rejects symlinked queue result directories and result files", async () => {
  const f = await fixture();
  const job = await enqueueDeveloperSandboxJob({ queueRoot: f.queueRoot }, {
    workspaceId: "workspace-001", baselineCommit: "a".repeat(40), command: "typecheck",
  });
  const outside = path.join(f.root, "outside");
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(f.queueRoot, "results"));
  await assert.rejects(() => collectDeveloperSandboxResult({ queueRoot: f.queueRoot }, job), /symlink|regular/i);
  await fs.rm(f.root, { recursive: true, force: true });
});
