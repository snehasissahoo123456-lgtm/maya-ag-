import test from "node:test";
import assert from "node:assert/strict";
import { normalizeIncomingGeminiHistory, restoreGeminiHistory, storeGeminiHistory } from "./conversation-history.ts";
import type { ConversationMessage } from "./conversation-store.ts";

test("stores Gemini user/model turns and restores SDK role names and function parts", () => {
  const previous: ConversationMessage[] = [{
    id: "stable-user-id",
    role: "user",
    text: "hello",
    createdAt: "2026-11-08T10:00:00.000Z",
  }];
  const history = [
    { role: "user", parts: [{ text: "hello" }] },
    { role: "model", parts: [{ functionCall: { name: "list_dir", args: { path: "." } } }] },
    { role: "model", parts: [{ functionResponse: { name: "list_dir", response: { files: [] } } }] },
  ];
  const stored = storeGeminiHistory(history, previous, "conversation-1", "2026-11-09T00:00:00.000Z");
  assert.equal(stored[0].id, "stable-user-id");
  assert.equal(stored[1].role, "model");
  assert.equal(stored[1].text, "");
  assert.deepEqual(restoreGeminiHistory(stored), [
    { role: "user", parts: [{ text: "hello" }] },
    { role: "model", parts: [{ functionCall: { name: "list_dir", args: { path: "." } } }] },
    { role: "model", parts: [{ functionResponse: { name: "list_dir", response: { files: [] } } }] },
  ]);
});

test("rejects invalid roles and oversized message parts", () => {
  assert.throws(() => storeGeminiHistory([{ role: "system", parts: [] }], [], "conversation-1"), /unsupported message role/);
  assert.throws(() => storeGeminiHistory([{ role: "user", parts: [{ text: "x".repeat(1_000_001) }] }], [], "conversation-1"), /storage limit/);
});

test("normalizes only valid user/model history supplied by the browser", () => {
  assert.deepEqual(normalizeIncomingGeminiHistory([
    { role: "user", parts: [{ text: "hi" }] },
    { role: "assistant", parts: [{ text: "hello" }] },
  ]), [
    { role: "user", parts: [{ text: "hi" }] },
    { role: "model", parts: [{ text: "hello" }] },
  ]);
  assert.throws(() => normalizeIncomingGeminiHistory([{ role: "system", parts: [] }]), /unsupported role/);
  assert.throws(() => normalizeIncomingGeminiHistory([{ role: "user", parts: "bad" }]), /invalid or oversized/);
});
