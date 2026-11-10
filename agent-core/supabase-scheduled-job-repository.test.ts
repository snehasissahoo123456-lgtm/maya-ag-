import test from "node:test";
import assert from "node:assert/strict";
import { SupabaseScheduledJobRepository } from "./supabase-scheduled-job-repository.ts";
import type { ScheduledReadJob } from "./scheduled-job-repository.ts";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "schedule-1", founder_id: "founder-a", title: "Daily README", path: "README.md", status: "active",
    next_run_at: "2026-11-09T00:00:00.000Z", interval_ms: 86400000, created_at: "2026-11-08T00:00:00.000Z",
    updated_at: "2026-11-08T00:00:00.000Z", last_run_at: null, run_count: 0, failure_count: 0, last_error: null,
    ...overrides,
  };
}
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
function job(): ScheduledReadJob {
  return { id: "schedule-1", founderId: "founder-a", title: "Daily README", path: "README.md", status: "active", nextRunAt: "2026-11-09T00:00:00.000Z", intervalMs: 86400000, createdAt: "2026-11-08T00:00:00.000Z", updatedAt: "2026-11-08T00:00:00.000Z", runCount: 0, failureCount: 0 };
}

test("Supabase schedule creation uses server credentials and confirms Founder ownership", async () => {
  const calls: any[] = [];
  const repository = new SupabaseScheduledJobRepository("https://maya.supabase.co", "server-only-key", async (url, init) => {
    calls.push({ url: String(url), init });
    return response([row()]);
  });
  await repository.create(job());
  assert.ok(calls[0].url.includes("/rest/v1/maya_scheduled_jobs"));
  assert.equal(calls[0].init.headers.apikey, "server-only-key");
  assert.equal(calls[0].init.headers.Authorization, "Bearer server-only-key");
  assert.equal(JSON.parse(calls[0].init.body).founder_id, "founder-a");
});

test("Supabase schedule claim is atomic RPC-bound to Founder, worker and bounded lease", async () => {
  const calls: any[] = [];
  const repository = new SupabaseScheduledJobRepository("https://maya.supabase.co", "service-key", async (url, init) => {
    calls.push({ url: String(url), init });
    return response([row()]);
  });
  const claimed = await repository.claimDue("founder-a", "worker-a", 999_999, 500);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].intervalMs, 86400000);
  assert.ok(calls[0].url.endsWith("/rpc/maya_claim_due_scheduled_jobs"));
  assert.deepEqual(JSON.parse(calls[0].init.body), { p_founder_id: "founder-a", p_worker_id: "worker-a", p_lease_ms: 300000, p_limit: 100 });
});

test("Supabase schedule completion and failure release only the matching worker lease", async () => {
  const calls: any[] = [];
  const repository = new SupabaseScheduledJobRepository("https://maya.supabase.co", "service-key", async (url, init) => {
    calls.push({ url: String(url), init });
    return response([row()]);
  });
  await repository.markEnqueued("founder-a", "schedule-1", "2026-11-09T00:00:00.000Z", null, "worker-a");
  await repository.recordFailure("founder-a", "schedule-1", "read failed", "worker-a");
  assert.ok(calls[0].url.endsWith("/rpc/maya_complete_scheduled_job"));
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    p_founder_id: "founder-a", p_job_id: "schedule-1", p_worker_id: "worker-a",
    p_scheduled_at: "2026-11-09T00:00:00.000Z", p_next_run_at: null,
  });
  assert.ok(calls[1].url.endsWith("/rpc/maya_fail_scheduled_job"));
  assert.equal(JSON.parse(calls[1].init.body).p_error, "read failed");
});

test("Supabase schedule reads and pause are Founder-scoped", async () => {
  const calls: any[] = [];
  const repository = new SupabaseScheduledJobRepository("https://maya.supabase.co", "service-key", async (url, init) => {
    calls.push({ url: String(url), init });
    return response([row()]);
  });
  assert.equal((await repository.get("founder-a", "schedule-1"))?.founderId, "founder-a");
  assert.equal((await repository.list("founder-a")).length, 1);
  assert.equal((await repository.listDue("founder-a", "2026-11-09T00:00:00.000Z", 500)).length, 1);
  assert.equal(await repository.pause("founder-a", "schedule-1"), true);
  assert.ok(calls[0].url.includes("founder_id=eq.founder-a"));
  assert.ok(calls[3].url.endsWith("/rpc/maya_pause_scheduled_job"));
});

test("Supabase schedule repository rejects insecure URLs and mismatched claim owners", async () => {
  assert.throws(() => new SupabaseScheduledJobRepository("http://remote.example", "key"), /HTTPS/i);
  const repository = new SupabaseScheduledJobRepository("https://maya.supabase.co", "key", async () => response([row({ founder_id: "founder-b" })]));
  await assert.rejects(() => repository.claimDue("founder-a", "worker-a", 60000, 5), /another Founder/i);
});
