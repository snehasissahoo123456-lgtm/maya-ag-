import test from "node:test";
import assert from "node:assert/strict";
import { SupabaseConversationStore } from "./supabase-conversation-store.ts";

function response(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("uses HTTPS and server-only service role authentication", async () => {
  let captured: any;
  const store = new SupabaseConversationStore("https://project.supabase.co", "service-secret", async (url, init) => {
    captured = { url: String(url), headers: init?.headers };
    return response([]);
  });
  await store.list("founder-1");
  assert.match(captured.url, /founder_id=eq.founder-1/);
  assert.equal(captured.headers.apikey, "service-secret");
  assert.equal(captured.headers.Authorization, "Bearer service-secret");
  assert.throws(() => new SupabaseConversationStore("http://remote.example", "secret"), /HTTPS/);
});

test("loads messages only for the matching Founder and conversation", async () => {
  const calls: string[] = [];
  const store = new SupabaseConversationStore("https://project.supabase.co", "service-secret", async (url) => {
    calls.push(String(url));
    if (String(url).includes("maya_conversations?")) return response([{ id: "chat-1", founder_id: "founder-1", title: "Test", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }]);
    return response([{ id: "m1", role: "user", content: "hello", created_at: "2026-01-01T00:01:00Z" }]);
  });
  const result = await store.get("founder-1", "chat-1");
  assert.equal(result?.messages[0].text, "hello");
  assert.match(calls[0], /founder_id=eq.founder-1/);
  assert.match(calls[1], /conversation_id=eq.chat-1/);
  assert.match(calls[1], /founder_id=eq.founder-1/);
});

test("uses atomic RPC for message append and returns updated conversation", async () => {
  const calls: string[] = [];
  const store = new SupabaseConversationStore("https://project.supabase.co", "service-secret", async (url, init) => {
    calls.push(String(url));
    if (String(url).includes("rpc/maya_append_conversation_message")) {
      assert.equal(init?.method, "POST");
      return response({ inserted: true });
    }
    if (String(url).includes("maya_conversations?")) return response([{ id: "chat-1", founder_id: "founder-1", title: "Test", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }]);
    return response([]);
  });
  await store.append("founder-1", "chat-1", "user", "hello");
  assert.ok(calls.some(url => url.includes("rpc/maya_append_conversation_message")));
});

test("Founder-scoped delete reports only rows actually deleted", async () => {
  const store = new SupabaseConversationStore("https://project.supabase.co", "service-secret", async (url, init) => {
    assert.equal(init?.method, "DELETE");
    assert.match(String(url), /founder_id=eq.founder-1/);
    return response([{ id: "chat-1" }]);
  });
  assert.equal(await store.delete("founder-1", "chat-1"), true);
});
