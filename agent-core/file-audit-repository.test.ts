import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileAuditRepository } from "./file-audit-repository.ts";
import type { MayaAuditEvent } from "./audit-repository.ts";

function event(id: string, founderId = "founder-a"): MayaAuditEvent {
  return { id, founderId, actorId: founderId, actorRole: "founder", type: "task.enqueued", taskId: "task-1", capability: "workspace.read_file", actionDigest: "a".repeat(64), occurredAt: new Date().toISOString(), metadata: {} };
}

test("audit events persist across instances and are isolated by Founder", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-audit-"));
  try {
    const first = new FileAuditRepository(directory);
    await Promise.all([first.append(event("event-1")), first.append(event("event-2"))]);
    const restored = new FileAuditRepository(directory);
    assert.equal((await restored.list("founder-a")).length, 2);
    assert.equal((await restored.list("founder-b")).length, 0);
    assert.equal((await restored.list("founder-a", 1)).length, 1);
    if (process.platform !== "win32") assert.equal(fs.statSync(path.join(directory, "audit-events.json")).mode & 0o777, 0o600);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("audit repository rejects duplicate IDs and corrupt storage without overwriting", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-audit-corrupt-"));
  const file = path.join(directory, "audit-events.json");
  try {
    const repository = new FileAuditRepository(directory);
    await repository.append(event("event-1"));
    await assert.rejects(() => repository.append(event("event-1")), /already exists/);
    fs.writeFileSync(file, "{broken");
    const broken = new FileAuditRepository(directory);
    await assert.rejects(() => broken.append(event("event-2")), /corrupt/);
    assert.equal(fs.readFileSync(file, "utf8"), "{broken");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
