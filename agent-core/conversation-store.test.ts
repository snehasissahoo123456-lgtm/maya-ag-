import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConversationStore } from "./conversation-store.ts";

test("persists messages and restores a Founder conversation across instances", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-conversations-"));
  try {
    const first = new ConversationStore(directory);
    first.getOrCreate("founder-a", "conversation-1", "Build Maya");
    first.append("founder-a", "conversation-1", "user", "Build Maya");
    first.append("founder-a", "conversation-1", "model", "I will plan the next module.");
    const restored = new ConversationStore(directory).get("founder-a", "conversation-1");
    assert.equal(restored?.messages.length, 2);
    assert.equal(restored?.messages[0].role, "user");
    assert.equal(restored?.title, "Build Maya");
    if (process.platform !== "win32") assert.equal(fs.statSync(path.join(directory, "conversations.json")).mode & 0o777, 0o600);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("does not expose or mutate another Founder's conversation", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-conversation-scope-"));
  try {
    const store = new ConversationStore(directory);
    store.getOrCreate("founder-a", "private-chat");
    assert.equal(store.get("founder-b", "private-chat"), undefined);
    assert.throws(() => store.append("founder-b", "private-chat", "user", "intrusion"), /not found/i);
    assert.equal(store.delete("founder-b", "private-chat"), false);
    assert.equal(store.list("founder-b").length, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("rejects oversized messages and bounds retained history", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-conversation-bounds-"));
  try {
    const store = new ConversationStore(directory);
    store.getOrCreate("founder-a", "bounded");
    assert.throws(() => store.append("founder-a", "bounded", "user", "x".repeat(20001)), /1–20,000/);
    for (let i = 0; i < 1002; i++) store.append("founder-a", "bounded", "user", `message-${i}`);
    assert.equal(store.get("founder-a", "bounded")?.messages.length, 1000);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
