import test from "node:test";
import assert from "node:assert/strict";
import { SupabaseMemoryRepository } from "./supabase-memory-repository.ts";
import type { MemoryEntry } from "../actionEngineCore.ts";

const memory: MemoryEntry = { id: "m1", category: "lesson", title: "Founder preference", content: "Use English by default.", createdAt: "2026-11-08T00:00:00.000Z", updatedAt: "2026-11-08T00:00:00.000Z" };
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }); }

test("Supabase memory repository performs one-time legacy import and Founder-scoped listing", async () => {
  const urls: string[] = [];
  const bodies: any[] = [];
  const repository = new SupabaseMemoryRepository("https://maya.supabase.co", "service-secret", [memory], undefined, async (input, init) => {
    urls.push(String(input));
    if (String(input).endsWith("maya_import_legacy_memories")) {
      bodies.push(JSON.parse(String(init?.body)));
      return response([{ imported: true }]);
    }
    return response([{ id: "m1", founder_id: "founder-a", category: "lesson", title: memory.title, content: memory.content, created_at: memory.createdAt, updated_at: memory.updatedAt }]);
  });
  const first = await repository.list("founder-a");
  const second = await repository.list("founder-a");
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.ok(urls[0].endsWith("maya_import_legacy_memories"));
  assert.equal(urls.filter(url => url.endsWith("maya_import_legacy_memories")).length, 1);
  assert.ok(urls.some(url => url.includes("founder_id=eq.founder-a")));
  assert.equal(bodies[0].p_founder_id, "founder-a");
  assert.equal(bodies[0].p_memories[0].id, "m1");
});

test("Supabase memory save/delete use server credentials and Founder scope", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const repository = new SupabaseMemoryRepository("https://maya.supabase.co", "service-secret", [], undefined, async (input, init) => {
    const url = String(input); calls.push({ url, init });
    if (url.endsWith("maya_import_legacy_memories")) return response([{ imported: true }]);
    if (init?.method === "POST") return response([{ id: "m1", founder_id: "founder-a" }]);
    if (init?.method === "DELETE") return response([{ id: "m1" }]);
    throw new Error("Unexpected request");
  });
  await repository.save("founder-a", memory);
  assert.equal(await repository.delete("founder-a", "m1"), true);
  const saveCall = calls.find(call => call.init?.method === "POST")!;
  const headers = saveCall.init?.headers as Record<string,string>;
  assert.equal(headers.apikey, "service-secret");
  assert.equal(headers.Authorization, "Bearer service-secret");
  assert.ok(calls.some(call => call.url.includes("founder_id=eq.founder-a")));
});

test("Supabase memory adapter rejects insecure URLs and invalid memory categories", async () => {
  assert.throws(() => new SupabaseMemoryRepository("http://maya.supabase.co", "service-secret"), /HTTPS/);
  const repository = new SupabaseMemoryRepository("https://maya.supabase.co", "service-secret", [], undefined, async () => response([{ imported: true }]));
  await assert.rejects(() => repository.save("founder-a", { ...memory, category: "unknown" as any }), /category/i);
});

test("Supabase memory repository stores document embeddings and uses vector similarity search", async () => {
  const embedding = Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0);
  const calls: Array<{ url: string; body: any }> = [];
  const embedCalls: string[] = [];
  const repository = new SupabaseMemoryRepository(
    "https://maya.supabase.co", "service-secret", [],
    async (text, purpose) => { embedCalls.push(purpose + ":" + text); return embedding; },
    async (input, init) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ url, body });
      if (url.endsWith("maya_import_legacy_memories")) return response([{ imported: true }]);
      if (url.endsWith("maya_memories")) return response([{ id: "m1", founder_id: "founder-a" }]);
      if (url.endsWith("maya_search_memories")) return response([{ id: "m1", founder_id: "founder-a", category: "lesson", title: memory.title, content: memory.content, created_at: memory.createdAt, updated_at: memory.updatedAt, similarity: 0.91 }]);
      throw new Error("Unexpected request");
    },
  );
  await repository.save("founder-a", memory);
  const results = await repository.search("founder-a", "preferred language");
  assert.equal(results[0].id, "m1");
  assert.deepEqual(embedCalls.map(call => call.split(":")[0]), ["document", "query"]);
  const saveCall = calls.find(call => call.url.endsWith("maya_memories"))!;
  assert.equal(saveCall.body.embedding.length, 768);
  const searchCall = calls.find(call => call.url.endsWith("maya_search_memories"))!;
  assert.equal(searchCall.body.p_founder_id, "founder-a");
  assert.equal(searchCall.body.p_query_embedding.length, 768);
});
