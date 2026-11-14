import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { ApprovalLedger, digestAction } from "./approval-ledger.ts";

test("approval is bound to exact Founder task capability and arguments", async () => {
 const ledger = new ApprovalLedger();
 const record = await ledger.request({ taskId: "t1", founderId: "f1", capability: "publish.release", args: { version: "1.0" }, now: 1000 });
 await ledger.decide({ approvalId: record.id, founderId: "f1", approved: true, now: 2000 });
 await assert.rejects(() => ledger.consume({ approvalId: record.id, founderId: "f1", taskId: "t1", capability: "publish.release", args: { version: "2.0" }, now: 3000 }));
 const used = await ledger.consume({ approvalId: record.id, founderId: "f1", taskId: "t1", capability: "publish.release", args: { version: "1.0" }, now: 3000 });
 assert.equal(used.status, "consumed");
 await assert.rejects(() => ledger.consume({ approvalId: record.id, founderId: "f1", taskId: "t1", capability: "publish.release", args: { version: "1.0" }, now: 3001 }));
});

test("rejects approval decisions by a different Founder and expires old requests", async () => {
 const ledger = new ApprovalLedger();
 const record = await ledger.request({ taskId: "t1", founderId: "f1", capability: "x.y", args: {}, ttlMs: 30000, now: 1000 });
 await assert.rejects(() => ledger.decide({ approvalId: record.id, founderId: "f2", approved: true, now: 2000 }));
 await assert.rejects(() => ledger.decide({ approvalId: record.id, founderId: "f1", approved: true, now: 40000 }), /expired/i);
});

test("canonical digest is independent of object key order", () => {
 assert.equal(digestAction("x.y", { a: 1, b: 2 }), digestAction("x.y", { b: 2, a: 1 }));
});

test("persists approval decisions and single-use consumption across restarts", async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maya-approval-store-"));
 const file = path.join(dir, "approvals.json");
 try {
  const first = new ApprovalLedger(file);
  const requested = await first.request({ taskId: "persist-task", founderId: "founder-1", capability: "workspace.publish", args: { target: "release" } });
  const second = new ApprovalLedger(file);
  assert.equal((await second.listForFounder("founder-1"))[0].status, "pending");
  await second.decide({ approvalId: requested.id, founderId: "founder-1", approved: true });
  const third = new ApprovalLedger(file);
  assert.equal((await third.listForFounder("founder-1"))[0].status, "approved");
  await third.consume({ approvalId: requested.id, founderId: "founder-1", taskId: "persist-task", capability: "workspace.publish", args: { target: "release" } });
  const fourth = new ApprovalLedger(file);
  assert.equal((await fourth.listForFounder("founder-1"))[0].status, "consumed");
  await assert.rejects(() => fourth.consume({ approvalId: requested.id, founderId: "founder-1", taskId: "persist-task", capability: "workspace.publish", args: { target: "release" } }), /approved grant/i);
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
 } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("persists expiry and fails closed on corrupt approval storage", async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maya-approval-expiry-"));
 const file = path.join(dir, "approvals.json");
 try {
  const first = new ApprovalLedger(file);
  const request = await first.request({ taskId: "expired-task", founderId: "founder-1", capability: "workspace.publish", args: {}, now: 1_000_000, ttlMs: 30_000 });
  await assert.rejects(() => first.decide({ approvalId: request.id, founderId: "founder-1", approved: true, now: 1_031_000 }), /expired/i);
  assert.equal((await new ApprovalLedger(file).listForFounder("founder-1"))[0].status, "expired");
  fs.writeFileSync(file, "{broken");
  assert.throws(() => new ApprovalLedger(file), /corrupt/i);
  assert.equal(fs.readFileSync(file, "utf8"), "{broken");
 } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
