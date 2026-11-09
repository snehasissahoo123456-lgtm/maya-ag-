import test from "node:test";
import assert from "node:assert/strict";
import { SupabaseConversationStore } from "./supabase-conversation-store.ts";
import type { ConversationRecord } from "./conversation-store.ts";

const sample: ConversationRecord = {
  id: "conversation-1",
  founderId: "founder-primary",
  title: "Test conversation",
  messages: [{ id: "message-1", role: "user", content: "Hello", createdAt: "2026-11-09T00:00:00.000Z" }],
  createdAt: "2026-11-09T00:00:00.000Z",
  updatedAt: "2026-11-09T00:01:00.000Z",
};

function row(record: ConversationRecord) {
  return {
    id: record.id,
    founder_id: record.founderId,
    title: record.title,
    messages: record.messages,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

test("requires HTTPS for remote Supabase endpoints", () => {
  assert.throws(() => new SupabaseConversationStore("http://db.example.com", "service-key"), /HTTPS/);
  assert.doesNotThrow(() => new SupabaseConversationStore("http://127.0.0.1:54321", "local-key"));
});

test("lists only the requested Founder's conversations and uses server credentials", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const store = new SupabaseConversationStore("https://project.supabase.co", "server-only-key", async (input, init) => {
    requestedUrl = String(input);
    requestedInit = init;
    return new Response(JSON.stringify([row(sample)]), { status: 200 });
  });
  const result = await store.list("founder-primary");
  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get("founder_id"), "eq.founder-primary");
  assert.equal(result[0].founderId, "founder-primary");
  const headers = new Headers(requestedInit?.headers);
  assert.equal(headers.get("Authorization"), "Bearer server-only-key");
  assert.equal(headers.get("apikey"), "server-only-key");
});

test("upserts a conversation and maps the returned database row", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const store = new SupabaseConversationStore("https://project.supabase.co", "server-only-key", async (input, init) => {
    requestedUrl = String(input);
    requestedInit = init;
    return new Response(JSON.stringify([row(sample)]), { status: 201 });
  });
  const result = await store.upsert(sample);
  assert.equal(new URL(requestedUrl).searchParams.get("on_conflict"), "id");
  assert.equal(requestedInit?.method, "POST");
  assert.equal(result.id, sample.id);
  assert.equal(result.founderId, sample.founderId);
});

test("scopes get and delete by both conversation id and Founder id", async () => {
  const requested: string[] = [];
  const store = new SupabaseConversationStore("https://project.supabase.co", "server-only-key", async input => {
    requested.push(String(input));
    return new Response(JSON.stringify([]), { status: 200 });
  });
  assert.equal(await store.get("conversation-1", "founder-primary"), null);
  assert.equal(await store.delete("conversation-1", "founder-primary"), false);
  for (const value of requested) {
    const url = new URL(value);
    assert.equal(url.searchParams.get("id"), "eq.conversation-1");
    assert.equal(url.searchParams.get("founder_id"), "eq.founder-primary");
  }
});

test("surfaces Supabase errors without silently treating them as success", async () => {
  const store = new SupabaseConversationStore("https://project.supabase.co", "server-only-key", async () =>
    new Response("schema missing", { status: 404 }));
  await assert.rejects(() => store.list("founder-primary"), /failed \(404\): schema missing/);
});
