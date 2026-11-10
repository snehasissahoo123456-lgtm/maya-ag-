import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConversationStore } from "./conversation-store.ts";
import type { ConversationRecord } from "./conversation-store.ts";

function record(founderId: string): ConversationRecord {
  const now = "2026-11-09T00:00:00.000Z";
  return {
    id: "conversation-1",
    founderId,
    title: "Founder conversation",
    messages: [{
      id: "message-1",
      role: "user",
      content: "hello",
      parts: [{ text: "hello" }],
      createdAt: now,
    }],
    createdAt: now,
    updatedAt: now,
  };
}

test("persists conversations across restarts and isolates records by Founder", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maya-conversations-"));
  const file = path.join(dir, "conversations.json");
  try {
    const store = new ConversationStore(file);
    await store.upsert(record("founder-a"));
    assert.equal(await store.get("conversation-1", "founder-b"), null);
    const restarted = new ConversationStore(file);
    assert.equal((await restarted.get("conversation-1", "founder-a"))?.messages[0].content, "hello");
    assert.equal(await restarted.delete("conversation-1", "founder-b"), false);
    assert.equal(await restarted.delete("conversation-1", "founder-a"), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("prevents conversation ownership changes and rejects corrupt stores", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maya-conversations-owner-"));
  const file = path.join(dir, "conversations.json");
  try {
    const store = new ConversationStore(file);
    await store.upsert(record("founder-a"));
    await assert.rejects(() => store.upsert(record("founder-b")), /ownership cannot be changed/);
    fs.writeFileSync(file, "{broken", "utf8");
    assert.throws(() => new ConversationStore(file), /Conversation store is corrupt/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("serializes concurrent conversation writes without dropping records", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maya-conversations-concurrent-"));
  const file = path.join(dir, "conversations.json");
  try {
    const store = new ConversationStore(file);
    await Promise.all([
      store.upsert({ ...record("founder-a"), id: "conversation-a" }),
      store.upsert({ ...record("founder-a"), id: "conversation-b" }),
      store.upsert({ ...record("founder-a"), id: "conversation-c" }),
    ]);
    const restarted = new ConversationStore(file);
    assert.deepEqual((await restarted.list("founder-a")).map(item => item.id).sort(), [
      "conversation-a", "conversation-b", "conversation-c",
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
