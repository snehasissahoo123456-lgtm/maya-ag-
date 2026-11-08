import test from "node:test";
import assert from "node:assert/strict";
import { createTask } from "./task-lifecycle.ts";
import type { TaskEnvelope } from "./task-orchestrator.ts";
import { SupabaseTaskRepository } from "./supabase-task-repository.ts";

function envelope(id = "task-1", founderId = "founder-a"): TaskEnvelope {
  return { task: createTask({ id, founderId, instruction: "Inspect workspace" }), capability: "workspace.read_file", args: { path: "README.md" }, attempts: 0, idempotencyKey: id };
}
function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("Supabase task repository writes through the owner-bound RPC with server-only credentials", async () => {
  const task = envelope();
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const repository = new SupabaseTaskRepository("https://maya-test.supabase.co", "service-secret", async (url, init) => {
    requestUrl = String(url); requestInit = init;
    return jsonResponse({ id: task.task.id, founder_id: task.task.founderId, envelope: task, created_at: "", updated_at: "" });
  });
  await repository.put(task);
  assert.match(requestUrl, /rpc\/maya_save_task$/);
  assert.equal(requestInit?.method, "POST");
  const headers = requestInit?.headers as Record<string, string>;
  assert.equal(headers.apikey, "service-secret");
  assert.equal(headers.Authorization, "Bearer service-secret");
  const body = JSON.parse(String(requestInit?.body));
  assert.equal(body.p_task_id, "task-1");
  assert.equal(body.p_founder_id, "founder-a");
  assert.equal(body.p_envelope.task.id, "task-1");
});

test("Supabase task reads and lists are Founder-scoped", async () => {
  const task = envelope();
  const urls: string[] = [];
  const repository = new SupabaseTaskRepository("https://maya-test.supabase.co", "service-secret", async url => {
    urls.push(String(url));
    const owner = new URL(String(url)).searchParams.get("founder_id");
    return jsonResponse(owner === "eq.founder-a" ? [{ id: task.task.id, founder_id: task.task.founderId, envelope: task }] : []);
  });
  assert.equal((await repository.get("task-1", "founder-a"))?.task.id, "task-1");
  assert.equal((await repository.get("task-1", "founder-b")), undefined);
  assert.equal((await repository.list("founder-a")).length, 1);
  assert.ok(urls[0].includes("founder_id=eq.founder-a"));
  assert.ok(urls[1].includes("founder_id=eq.founder-b"));
  assert.ok(urls[2].includes("founder_id=eq.founder-a"));
  await assert.rejects(() => repository.get("task-1"), /Founder scope is required/);
});

test("Supabase task writes fail closed when the server does not confirm ownership", async () => {
  const task = envelope();
  const repository = new SupabaseTaskRepository("https://maya-test.supabase.co", "service-secret", async () => jsonResponse({ id: task.task.id, founder_id: "founder-b" }));
  await assert.rejects(() => repository.put(task), /did not confirm/);
});

test("Supabase URL requires HTTPS outside localhost", () => {
  assert.throws(() => new SupabaseTaskRepository("http://maya-test.supabase.co", "service-secret"), /HTTPS/);
  assert.throws(() => new SupabaseTaskRepository("https://maya-test.supabase.co", " "), /service-role key/);
});
