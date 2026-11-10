import test from "node:test";
import assert from "node:assert/strict";
import { SupabaseApprovalLedger } from "./supabase-approval-ledger.ts";

function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }); }
function row(body: any, status = body.status) {
  return { id: body.id, task_id: body.task_id, founder_id: body.founder_id, capability: body.capability, action_digest: body.action_digest, requested_at: body.requested_at, expires_at: body.expires_at, status, decided_at: status === "pending" || status === "expired" ? null : new Date().toISOString() };
}

test("Supabase approval request is persisted with exact action digest and server-only credentials", async () => {
  let url = ""; let init: RequestInit | undefined;
  const ledger = new SupabaseApprovalLedger("https://maya.supabase.co", "service-secret", async (input, options) => {
    url = String(input); init = options;
    const body = JSON.parse(String(options?.body));
    return response([row(body)]);
  });
  const requested = await ledger.request({ taskId: "task-1", founderId: "founder-a", capability: "release.publish", args: { version: "1.0" }, now: 1000, ttlMs: 60000 });
  assert.match(url, /maya_approvals$/);
  assert.equal(requested.status, "pending");
  assert.equal(requested.actionDigest.length, 64);
  const headers = init?.headers as Record<string,string>;
  assert.equal(headers.apikey, "service-secret");
  assert.equal(headers.Authorization, "Bearer service-secret");
});

test("Supabase approval decision and consumption use atomic RPCs", async () => {
  let calls = 0;
  const ledger = new SupabaseApprovalLedger("https://maya.supabase.co", "service-secret", async (input, options) => {
    calls++;
    const body = JSON.parse(String(options?.body));
    if (String(input).endsWith("maya_decide_approval")) return response([row({
      id: body.p_approval_id, task_id: "task-1", founder_id: body.p_founder_id, capability: "release.publish",
      action_digest: "a".repeat(64), requested_at: new Date(0).toISOString(), expires_at: new Date(Date.now()+60000).toISOString()
    }, "approved")]);
    if (String(input).endsWith("maya_consume_approval")) return response([row({
      id: body.p_approval_id, task_id: body.p_task_id, founder_id: body.p_founder_id, capability: body.p_capability,
      action_digest: body.p_action_digest, requested_at: new Date(0).toISOString(), expires_at: new Date(Date.now()+60000).toISOString()
    }, "consumed")]);
    throw new Error("Unexpected endpoint");
  });
  const decision = await ledger.decide({ approvalId: "approval-1", founderId: "founder-a", approved: true });
  assert.equal(decision.status, "approved");
  const consumed = await ledger.consume({ approvalId: "approval-1", founderId: "founder-a", taskId: "task-1", capability: "release.publish", args: { version: "1.0" } });
  assert.equal(consumed.status, "consumed");
  assert.equal(calls, 2);
});

test("Supabase approval list is Founder-scoped and maps expiry/decision state", async () => {
  let url = "";
  const ledger = new SupabaseApprovalLedger("https://maya.supabase.co", "service-secret", async input => {
    url = String(input);
    return response([{ id: "a1", task_id: "t1", founder_id: "founder-a", capability: "x.y", action_digest: "a".repeat(64), requested_at: new Date(0).toISOString(), expires_at: new Date(Date.now()+60000).toISOString(), status: "approved", decided_at: new Date().toISOString() }]);
  });
  const records = await ledger.listForFounder("founder-a");
  assert.equal(records.length, 1);
  assert.equal(records[0].status, "approved");
  assert.ok(url.includes("founder_id=eq.founder-a"));
});

test("Supabase approval adapter validates HTTPS and fails closed on RPC errors", async () => {
  assert.throws(() => new SupabaseApprovalLedger("http://maya.supabase.co", "service-secret"), /HTTPS/);
  const ledger = new SupabaseApprovalLedger("https://maya.supabase.co", "service-secret", async () => response({ message: "permission denied" }, 403));
  await assert.rejects(() => ledger.decide({ approvalId: "a1", founderId: "f1", approved: true }), /403/);
});
