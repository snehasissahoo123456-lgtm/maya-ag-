import test from "node:test";
import assert from "node:assert/strict";
import { SupabaseAuditRepository } from "./supabase-audit-repository.ts";
import type { MayaAuditEvent } from "./audit-repository.ts";

const event: MayaAuditEvent = {
  id: "11111111-1111-4111-8111-111111111111", founderId: "founder-a", actorId: "founder-a",
  actorRole: "founder", type: "task.enqueued", taskId: "task-1", capability: "workspace.read_file",
  actionDigest: "a".repeat(64), occurredAt: "2026-11-08T00:00:00.000Z", metadata: { riskLevel: "low" },
};
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }); }

test("Supabase audit append uses server-only credentials and confirms insertion", async () => {
  let url = ""; let init: RequestInit | undefined;
  const repository = new SupabaseAuditRepository("https://maya.supabase.co", "service-secret", async (input, options) => {
    url = String(input); init = options;
    return response([{ id: event.id }]);
  });
  await repository.append(event);
  assert.match(url, /maya_audit_events$/);
  const headers = init?.headers as Record<string,string>;
  assert.equal(headers.apikey, "service-secret");
  assert.equal(headers.Authorization, "Bearer service-secret");
  const body = JSON.parse(String(init?.body));
  assert.equal(body.founder_id, "founder-a");
  assert.equal(body.event_type, "task.enqueued");
  assert.equal(body.action_digest, "a".repeat(64));
});

test("Supabase audit reads are Founder-scoped and bounded", async () => {
  let url = "";
  const repository = new SupabaseAuditRepository("https://maya.supabase.co", "service-secret", async input => {
    url = String(input);
    return response([{ id: event.id, founder_id: "founder-a", actor_id: "founder-a", actor_role: "founder", event_type: "task.enqueued", task_id: "task-1", capability: "workspace.read_file", action_digest: "a".repeat(64), occurred_at: event.occurredAt, metadata: {} }]);
  });
  const rows = await repository.list("founder-a", 9999);
  assert.equal(rows.length, 1);
  assert.ok(url.includes("founder_id=eq.founder-a"));
  assert.ok(url.includes("limit=500"));
  assert.equal(rows[0].founderId, "founder-a");
});
