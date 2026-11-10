import test from "node:test";
import assert from "node:assert/strict";
import { SupabaseCEORunRepository } from "./supabase-ceo-run-repository.ts";
import type { CEORunRecord } from "./ceo-run-repository.ts";

function record(status: CEORunRecord["status"] = "running"): CEORunRecord {
  return {
    id: "ceo-run-1", founderId: "founder-a", objective: "Research the Puri hotel market", status,
    assignments: [{ agentId: "research", task: "Find market evidence" }],
    findings: [{ agentId: "research", displayName: "Researcher", role: "research", output: "Three sources reviewed." }],
    summary: status === "completed" ? "A short synthesis" : undefined,
    createdAt: "2026-11-09T00:00:00.000Z", updatedAt: "2026-11-09T00:00:00.000Z",
  };
}
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "ceo-run-1", founder_id: "founder-a", objective: "Research the Puri hotel market", status: "running",
    assignments: [{ agentId: "research", task: "Find market evidence" }],
    findings: [{ agentId: "research", displayName: "Researcher", role: "research", output: "Three sources reviewed." }],
    summary: null, error: null, created_at: "2026-11-09T00:00:00.000Z", updated_at: "2026-11-09T00:00:00.000Z",
    completed_at: null, duration_ms: null, lease_until: "2026-11-09T02:00:00.000Z", ...overrides,
  };
}

test("Supabase CEO repository persists runs with Founder identity and a bounded recovery lease", async () => {
  const calls: any[] = [];
  const repository = new SupabaseCEORunRepository("https://maya.supabase.co", "server-only-key", async (url, init) => {
    calls.push({ url: String(url), init });
    return response([row()]);
  });
  await repository.create(record());
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.founder_id, "founder-a");
  assert.equal(body.status, "running");
  assert.ok(Date.parse(body.lease_until) > Date.now());
  assert.equal(calls[0].init.headers.apikey, "server-only-key");
});

test("Supabase CEO repository updates and lists only Founder-owned runs", async () => {
  const calls: any[] = [];
  const repository = new SupabaseCEORunRepository("https://maya.supabase.co", "server-key", async (url, init) => {
    calls.push({ url: String(url), init });
    if (init?.method === "PATCH") return response([{ id: "ceo-run-1", founder_id: "founder-a" }]);
    return response([row({ status: "completed", summary: "A short synthesis", lease_until: null })]);
  });
  const completed = { ...record("completed"), summary: "A short synthesis", completedAt: "2026-11-09T00:10:00.000Z", durationMs: 600000 };
  await repository.update("founder-a", completed);
  assert.equal(JSON.parse(calls[0].init.body).lease_until, null);
  assert.ok(calls[0].url.includes("founder_id=eq.founder-a"));
  const runs = await repository.list("founder-a");
  assert.equal(runs[0].summary, "A short synthesis");
  assert.equal(runs[0].findings[0].output, "Three sources reviewed.");
  assert.ok(calls[1].url.includes("founder_id=eq.founder-a"));
});

test("Supabase CEO repository recovery marks only expired runs through a dedicated RPC", async () => {
  const calls: any[] = [];
  const repository = new SupabaseCEORunRepository("https://maya.supabase.co", "server-key", async (url, init) => {
    calls.push({ url: String(url), init });
    return response([{ recovered: 3 }]);
  });
  assert.equal(await repository.recoverInterrupted(), 3);
  assert.ok(calls[0].url.endsWith("/rpc/maya_recover_interrupted_ceo_runs"));
});

test("Supabase CEO repository rejects Founder mismatches, insecure URLs and storage errors", async () => {
  assert.throws(() => new SupabaseCEORunRepository("http://remote.example", "key"), /HTTPS/i);
  const repository = new SupabaseCEORunRepository("https://maya.supabase.co", "key", async () => response([{ id: "ceo-run-1", founder_id: "founder-b" }]));
  await assert.rejects(() => repository.update("founder-a", { ...record("completed"), founderId: "founder-b" }), /identity mismatch/i);
  const failing = new SupabaseCEORunRepository("https://maya.supabase.co", "key", async () => response({ message: "offline" }, 503));
  await assert.rejects(() => failing.list("founder-a"), /503/i);
});
