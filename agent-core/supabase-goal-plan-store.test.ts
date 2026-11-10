import test from "node:test";
import assert from "node:assert/strict";
import { SupabaseGoalPlanStore } from "./supabase-goal-plan-store.ts";
import type { GoalPlan } from "./goal-planner.ts";

const plan: GoalPlan = { objective: "Inspect a file", summary: "Read and report.", executionMode: "plan_only", steps: [
  { id: "read", title: "Read README", tool: "read_file", args: { path: "README.md" }, dependsOn: [], expectedResult: "Text", requiresFounderApproval: false },
] };
const row = (id = "plan-1") => ({ id, founder_id: "founder-1", plan, status: "proposed", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", step_states: { read: { status: "queued" } } });

test("creates plans with Founder scope and persists step states", async () => {
  let body: any;
  const store = new SupabaseGoalPlanStore("https://project.supabase.co", "service-secret", async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify([{ id: body.id }]), { status: 201 });
  });
  const saved = await store.create("founder-1", plan);
  assert.equal(body.founder_id, "founder-1");
  assert.equal(body.step_states.read.status, "queued");
  assert.equal(saved.status, "proposed");
});

test("lists and gets only Founder-scoped plans", async () => {
  const urls: string[] = [];
  const store = new SupabaseGoalPlanStore("https://project.supabase.co", "service-secret", async url => {
    urls.push(String(url));
    return new Response(JSON.stringify([row()]), { status: 200 });
  });
  assert.equal((await store.list("founder-1"))[0].id, "plan-1");
  assert.equal((await store.get("founder-1", "plan-1"))?.stepStates.read.status, "queued");
  assert.ok(urls.every(url => url.includes("founder_id=eq.founder-1")));
});

test("updates a plan only for the matching Founder and requires a returned row", async () => {
  let url = "";
  const store = new SupabaseGoalPlanStore("https://project.supabase.co", "service-secret", async (input, init) => {
    url = String(input);
    assert.equal(init?.method, "PATCH");
    return new Response(JSON.stringify([{ id: "plan-1" }]), { status: 200 });
  });
  const stored = { id: "plan-1", founderId: "founder-1", plan, status: "completed" as const, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", stepStates: { read: { status: "completed" as const } } };
  await store.save("founder-1", stored);
  assert.match(url, /founder_id=eq.founder-1/);
  const missing = new SupabaseGoalPlanStore("https://project.supabase.co", "service-secret", async () => new Response("[]", { status: 200 }));
  await assert.rejects(missing.save("founder-1", stored), /not found/i);
});

test("claims one running goal plan through the atomic Founder-scoped lease RPC", async () => {
  let url = "";
  let body: any;
  const runningRow = { ...row(), status: "running" };
  const store = new SupabaseGoalPlanStore("https://project.supabase.co", "service-secret", async (input, init) => {
    url = String(input);
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify([runningRow]), { status: 200 });
  });
  const claimed = await store.claimNext("founder-1", "worker-1", 60_000);
  assert.equal(claimed?.id, "plan-1");
  assert.match(url, /rpc\/maya_claim_next_goal_plan$/);
  assert.deepEqual(body, { p_founder_id: "founder-1", p_worker_id: "worker-1", p_lease_ms: 60_000 });
});

test("releases only the exact Founder and worker goal-plan lease", async () => {
  let url = "";
  let body: any;
  const store = new SupabaseGoalPlanStore("https://project.supabase.co", "service-secret", async (input, init) => {
    url = String(input);
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify([{ id: "plan-1", founder_id: "founder-1" }]), { status: 200 });
  });
  await store.releaseClaim("founder-1", "plan-1", "worker-1");
  assert.match(url, /rpc\/maya_release_goal_plan_claim$/);
  assert.deepEqual(body, { p_plan_id: "plan-1", p_founder_id: "founder-1", p_worker_id: "worker-1" });
});
