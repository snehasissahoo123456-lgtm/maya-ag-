import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileCEORunRepository } from "./file-ceo-run-repository.ts";
import type { CEORunRecord } from "./ceo-run-repository.ts";

function record(id: string, founderId = "founder-a", status: CEORunRecord["status"] = "running"): CEORunRecord {
  return { id, founderId, objective: "Research the market", status, assignments: [{ agentId: "research", task: "Find market evidence" }], findings: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

test("CEO run history persists results across repository instances and isolates Founders", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-ceo-runs-"));
  try {
    const first = new FileCEORunRepository(directory);
    const running = record("run-1");
    await first.create(running);
    const completed = { ...running, status: "completed" as const, summary: "Evidence-backed report", findings: [{ agentId: "research", displayName: "Researcher", role: "Research", output: "Found three relevant sources." }], completedAt: new Date().toISOString(), durationMs: 1200 };
    await first.update("founder-a", completed);
    const restored = new FileCEORunRepository(directory);
    assert.equal((await restored.get("founder-a", "run-1"))?.summary, "Evidence-backed report");
    assert.equal(await restored.get("founder-b", "run-1"), undefined);
    assert.equal((await restored.list("founder-a")).length, 1);
    assert.equal((await restored.list("founder-b")).length, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("CEO run repository refuses cross-Founder updates and duplicate IDs", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-ceo-owner-"));
  try {
    const repository = new FileCEORunRepository(directory);
    const run = record("run-1");
    await repository.create(run);
    await assert.rejects(() => repository.update("founder-b", { ...run, status: "completed" }), /not found for this Founder/i);
    await assert.rejects(() => repository.create(run), /already exists/i);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("CEO repository marks interrupted runs failed without replaying them", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-ceo-recovery-"));
  try {
    const repository = new FileCEORunRepository(directory);
    await repository.create(record("run-1"));
    await repository.create(record("run-2", "founder-b", "completed"));
    assert.equal(await repository.recoverInterrupted(), 1);
    const recovered = await repository.get("founder-a", "run-1");
    assert.equal(recovered?.status, "failed");
    assert.match(recovered?.error || "", /was not replayed/i);
    assert.equal((await repository.get("founder-b", "run-2"))?.status, "completed");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("CEO run repository fails closed on corrupt data and bounds listing", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-ceo-bounds-"));
  try {
    const repository = new FileCEORunRepository(directory);
    for (let i = 0; i < 5; i++) await repository.create(record("run-" + i));
    assert.equal((await repository.list("founder-a", 2)).length, 2);
    fs.writeFileSync(path.join(directory, "ceo-runs.json"), "{broken");
    await assert.rejects(() => repository.list("founder-a"), /corrupt/i);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
