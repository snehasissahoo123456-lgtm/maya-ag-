import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileTaskRepository } from "./file-task-repository.ts";
import { createTask, transitionTask } from "./task-lifecycle.ts";
import type { TaskEnvelope } from "./task-orchestrator.ts";

function envelope(id: string, status: "queued" | "running" = "queued"): TaskEnvelope {
  let task = createTask({ id, founderId: "founder-1", instruction: "Inspect workspace" });
  if (status === "running") {
    task = transitionTask(task, "planning");
    task = transitionTask(task, "running");
  }
  return { task, capability: "workspace.inspect", args: { path: "." }, attempts: status === "running" ? 1 : 0, idempotencyKey: id };
}

test("persists tasks across repository instances and returns isolated copies", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maya-task-repo-"));
  const file = path.join(dir, "tasks.json");
  try {
    const first = new FileTaskRepository(file);
    await first.put(envelope("task-1"));
    const loaded = new FileTaskRepository(file);
    const result = await loaded.get("task-1");
    assert.equal(result?.task.status, "queued");
    result!.args.path = "/tampered";
    assert.equal((await loaded.get("task-1"))?.args.path, ".");
    assert.equal((await loaded.list("founder-1")).length, 1);
    if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("moves interrupted running tasks to requires_recovery after restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maya-task-recovery-"));
  const file = path.join(dir, "tasks.json");
  try {
    await new FileTaskRepository(file).put(envelope("task-running", "running"));
    const restarted = new FileTaskRepository(file);
    const recovered = await restarted.get("task-running");
    assert.equal(recovered?.task.status, "requires_recovery");
    assert.match(recovered?.task.lastError || "", /restarted/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("serializes concurrent writes without dropping task records", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maya-task-concurrency-"));
  const file = path.join(dir, "tasks.json");
  try {
    const repository = new FileTaskRepository(file);
    await Promise.all(Array.from({ length: 30 }, (_, index) => repository.put(envelope(`task-${index}`))));
    assert.equal((await repository.list("founder-1")).length, 30);
    assert.equal((await new FileTaskRepository(file).list("founder-1")).length, 30);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fails closed on corrupt task data instead of overwriting it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maya-task-corrupt-"));
  const file = path.join(dir, "tasks.json");
  try {
    fs.writeFileSync(file, "{broken");
    assert.throws(() => new FileTaskRepository(file), /corrupt/i);
    assert.equal(fs.readFileSync(file, "utf8"), "{broken");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects task id ownership collisions", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maya-task-owner-"));
  try {
    const repository = new FileTaskRepository(path.join(dir, "tasks.json"));
    await repository.put(envelope("shared-id"));
    const conflicting = envelope("shared-id");
    conflicting.task.founderId = "founder-2";
    await assert.rejects(() => repository.put(conflicting), /another Founder/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
