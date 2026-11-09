import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileAuditLogStore } from "./audit-log-store.ts";

test("persists audit events across restarts and redacts secret fields", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maya-audit-store-"));
  const file = path.join(dir, "audit.json");
  try {
    const store = new FileAuditLogStore<{ id: string; action: string; params: Record<string, unknown> }>(file);
    store.append({ id: "event-1", action: "founder-login", params: {
      email: "founder@example.invalid",
      password: "must-not-persist",
      content: "private document contents must not be retained",
      nested: { access_token: "also-secret", safe: "visible" },
    } });
    const disk = fs.readFileSync(file, "utf8");
    assert.equal(disk.includes("must-not-persist"), false);
    assert.equal(disk.includes("also-secret"), false);
    assert.equal(disk.includes("private document contents must not be retained"), false);
    assert.match(disk, /\[REDACTED\]/);
    const restarted = new FileAuditLogStore<{ id: string; action: string; params: Record<string, unknown> }>(file);
    const entries = restarted.list();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].params.password, "[REDACTED]");
    assert.equal(entries[0].params.content, "[REDACTED]");
    assert.deepEqual(entries[0].params.nested, { access_token: "[REDACTED]", safe: "visible" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("bounds retained history and rejects corrupt audit stores", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maya-audit-retention-"));
  const file = path.join(dir, "audit.json");
  try {
    const store = new FileAuditLogStore<{ id: string }>(file, 2);
    store.append({ id: "one" });
    store.append({ id: "two" });
    store.append({ id: "three" });
    assert.deepEqual(store.list().map(entry => entry.id), ["three", "two"]);
    fs.writeFileSync(file, "{broken", "utf8");
    assert.throws(() => new FileAuditLogStore(file, 2), /Audit log store is corrupt/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("does not mutate in-memory audit history when a durable write fails", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maya-audit-rollback-"));
  const parent = path.join(dir, "not-a-directory");
  fs.writeFileSync(parent, "file");
  try {
    const store = new FileAuditLogStore<{ id: string }>(path.join(parent, "audit.json"));
    assert.throws(() => store.append({ id: "not-written" }));
    assert.deepEqual(store.list(), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
