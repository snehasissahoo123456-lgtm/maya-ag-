import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MayaPersistentStore } from "./persistent-store.ts";

test("persists Founder tasks, memories, and preferences across store instances", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-store-test-"));
  try {
    const store = new MayaPersistentStore<{ id: string }, { id: string }, { mode: string }>(directory);
    const expected = { tasks: [{ id: "task-1" }], memories: [{ id: "memory-1" }], persona: { mode: "focus" } };
    store.save(expected);
    const restored = new MayaPersistentStore<{ id: string }, { id: string }, { mode: string }>(directory).load({
      tasks: [], memories: [], persona: { mode: "default" },
    });
    assert.deepEqual(restored, expected);
    const file = path.join(directory, "state.json");
    assert.ok(fs.existsSync(file));
    if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("uses defaults when the state file is missing or corrupt", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-store-empty-"));
  try {
    const defaults = { tasks: [{ id: "seed" }], memories: [], persona: { mode: "default" } };
    const store = new MayaPersistentStore<{ id: string }, { id: string }, { mode: string }>(directory);
    assert.deepEqual(store.load(defaults), defaults);
    fs.writeFileSync(path.join(directory, "state.json"), "{broken");
    assert.deepEqual(store.load(defaults), defaults);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
