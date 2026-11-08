import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileScheduledJobRepository } from "./file-scheduled-job-repository.ts";
import type { ScheduledReadJob } from "./scheduled-job-repository.ts";

function job(id: string, founderId = "founder-a", intervalMs: number | null = null): ScheduledReadJob {
  const now = new Date(Date.now() - 1000).toISOString();
  return { id, founderId, title: "Read project status", path: "README.md", status: "active", nextRunAt: now, intervalMs, createdAt: now, updatedAt: now, runCount: 0, failureCount: 0 };
}

test("scheduled job repository persists, lists due jobs and completes one-time schedules", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-schedules-"));
  try {
    const repository = new FileScheduledJobRepository(directory);
    await repository.create(job("once"));
    assert.equal((await repository.list("founder-a")).length, 1);
    assert.equal((await repository.listDue("founder-a", new Date().toISOString(), 5)).length, 1);
    await repository.markEnqueued("founder-a", "once", (await repository.get("founder-a", "once"))!.nextRunAt, null);
    assert.equal((await repository.get("founder-a", "once"))?.status, "completed");
    assert.equal((await new FileScheduledJobRepository(directory).list("founder-a"))[0].runCount, 1);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("recurring schedules advance, pause and automatically pause after repeated failures", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-schedule-repeat-"));
  try {
    const repository = new FileScheduledJobRepository(directory);
    await repository.create(job("daily", "founder-a", 24 * 60 * 60_000));
    const due = (await repository.get("founder-a", "daily"))!;
    await repository.markEnqueued("founder-a", "daily", due.nextRunAt, new Date(Date.now() + 24 * 60 * 60_000).toISOString());
    assert.equal((await repository.get("founder-a", "daily"))?.status, "active");
    await repository.recordFailure("founder-a", "daily", "first failure");
    await repository.recordFailure("founder-a", "daily", "second failure");
    await repository.recordFailure("founder-a", "daily", "third failure");
    assert.equal((await repository.get("founder-a", "daily"))?.status, "paused");
    assert.equal(await repository.pause("founder-a", "daily"), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("scheduled job records are Founder-scoped and reject stale run timestamps", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-schedule-owner-"));
  try {
    const repository = new FileScheduledJobRepository(directory);
    await repository.create(job("owner"));
    assert.equal(await repository.get("founder-b", "owner"), undefined);
    assert.equal((await repository.list("founder-b")).length, 0);
    await assert.rejects(() => repository.markEnqueued("founder-b", "owner", "wrong", null), /not found/i);
    await assert.rejects(() => repository.markEnqueued("founder-a", "owner", "wrong", null), /no longer active/i);
    assert.equal(await repository.pause("founder-b", "owner"), false);
    assert.equal(await repository.pause("founder-a", "owner"), true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("scheduled job repository fails closed on corrupt storage", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-schedule-corrupt-"));
  try {
    const repository = new FileScheduledJobRepository(directory);
    await repository.create(job("corrupt"));
    fs.writeFileSync(path.join(directory, "scheduled-jobs.json"), "{broken");
    await assert.rejects(() => repository.list("founder-a"), /corrupt/i);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
