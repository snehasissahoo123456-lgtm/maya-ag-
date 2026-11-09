import test from "node:test";
import assert from "node:assert/strict";
import { restoreGeminiHistory, storeGeminiHistory } from "./conversation-history.ts";
import type { ConversationMessage } from "./conversation-store.ts";

test("stores Gemini user/model turns and restores SDK role names and function parts", () => {
  const previous: ConversationMessage[] = [{
    id: "stable-user-id",
    role: "user",
    content: "hello",
    parts: [{ text: "hello" }],
    createdAt: "2026-11-08T10:00:00.000Z",
  }];
  const history = [
    { role: "user", parts: [{ text: "hello" }] },
    { role: "model", parts: [{ functionCall: { name: "list_dir", args: { path: "." } } }] },
    { role: "model", parts: [{ functionResponse: { name: "list_dir", response: { files: [] } } }] },
  ];
  const stored = storeGeminiHistory(history, previous, "conversation-1", "2026-11-09T00:00:00.000Z");
  assert.equal(stored[0].id, "stable-user-id");
  assert.equal(stored[1].role, "assistant");
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
