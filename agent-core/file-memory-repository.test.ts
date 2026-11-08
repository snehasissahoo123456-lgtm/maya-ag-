import test from "node:test";
import assert from "node:assert/strict";
import { FileMemoryRepository } from "./file-memory-repository.ts";
import type { MemoryEntry } from "../actionEngineCore.ts";

const memory: MemoryEntry = { id: "m1", category: "lesson", title: "Founder preference", content: "Use English by default.", createdAt: "2026-11-08T00:00:00.000Z", updatedAt: "2026-11-08T00:00:00.000Z" };

test("file memory repository persists save/delete through the existing state adapter", async () => {
  let persisted: MemoryEntry[] = [];
  const repository = new FileMemoryRepository([], value => { persisted = structuredClone(value); });
  await repository.save("founder-primary", memory);
  assert.equal((await repository.list("founder-primary")).length, 1);
  assert.equal(persisted[0].id, "m1");
  assert.equal((await repository.search("founder-primary", "english"))[0].id, "m1");
  assert.equal(await repository.delete("founder-primary", "m1"), true);
  assert.equal((await repository.list("founder-primary")).length, 0);
  assert.equal(persisted.length, 0);
});

test("file memory repository imports legacy state and validates content", async () => {
  let persisted: MemoryEntry[] = [];
  const repository = new FileMemoryRepository([memory], value => { persisted = value; });
  assert.equal((await repository.list("founder-primary"))[0].id, "m1");
  await assert.rejects(() => repository.save("founder-primary", { ...memory, content: "" }), /content/i);
  assert.equal(persisted.length, 0);
});
