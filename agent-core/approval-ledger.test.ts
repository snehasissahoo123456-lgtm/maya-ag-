import test from "node:test";
import assert from "node:assert/strict";
import { ApprovalLedger, digestAction } from "./approval-ledger.ts";
test("approval is bound to exact Founder task capability and arguments", () => {
 const ledger = new ApprovalLedger();
 const record = ledger.request({ taskId: "t1", founderId: "f1", capability: "publish.release", args: { version: "1.0" }, now: 1000 });
 ledger.decide({ approvalId: record.id, founderId: "f1", approved: true, now: 2000 });
 assert.throws(() => ledger.consume({ approvalId: record.id, founderId: "f1", taskId: "t1", capability: "publish.release", args: { version: "2.0" }, now: 3000 }));
 const used = ledger.consume({ approvalId: record.id, founderId: "f1", taskId: "t1", capability: "publish.release", args: { version: "1.0" }, now: 3000 });
 assert.equal(used.status, "consumed");
 assert.throws(() => ledger.consume({ approvalId: record.id, founderId: "f1", taskId: "t1", capability: "publish.release", args: { version: "1.0" }, now: 3001 }));
});
test("rejects approval decisions by a different Founder and expires old requests", () => {
 const ledger = new ApprovalLedger();
 const record = ledger.request({ taskId: "t1", founderId: "f1", capability: "x.y", args: {}, ttlMs: 30000, now: 1000 });
 assert.throws(() => ledger.decide({ approvalId: record.id, founderId: "f2", approved: true, now: 2000 }));
 assert.throws(() => ledger.decide({ approvalId: record.id, founderId: "f1", approved: true, now: 40000 }));
});
test("canonical digest is independent of object key order", () => {
 assert.equal(digestAction("x.y", { a: 1, b: 2 }), digestAction("x.y", { b: 2, a: 1 }));
});
