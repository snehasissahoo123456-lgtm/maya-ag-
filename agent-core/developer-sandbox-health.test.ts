import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readDeveloperSandboxWorkerHealth } from "./developer-sandbox-health.ts";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "maya-sandbox-health-"));
  return { root, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}
async function writeStatus(root: string, overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-11-15T07:00:00.000Z");
  await fs.writeFile(path.join(root, "worker-status.json"), JSON.stringify({
    status: "running", pid: 1234, startedAt: "2026-11-15T06:00:00.000Z",
    heartbeatAt: now.toISOString(), ...overrides,
  }), { mode: 0o600 });
  return now.getTime();
}

test("reports an unconfigured queue without claiming worker health", async () => {
  const result = await readDeveloperSandboxWorkerHealth(undefined);
  assert.equal(result.configured, false);
  assert.equal(result.healthy, false);
  assert.equal(result.status, "unconfigured");
});

test("accepts a fresh, well-formed running worker heartbeat", async () => {
  const f = await fixture();
  try {
    const now = await writeStatus(f.root);
    const result = await readDeveloperSandboxWorkerHealth(f.root, { now });
    assert.equal(result.healthy, true);
    assert.equal(result.status, "healthy");
    assert.equal(result.pid, 1234);
    assert.equal(result.ageMs, 0);
  } finally { await f.cleanup(); }
});

test("marks a stale heartbeat unhealthy", async () => {
  const f = await fixture();
  try {
    const now = await writeStatus(f.root, { heartbeatAt: "2026-11-15T06:59:00.000Z" });
    const result = await readDeveloperSandboxWorkerHealth(f.root, { now, maxAgeMs: 30_000 });
    assert.equal(result.healthy, false);
    assert.equal(result.status, "stale");
  } finally { await f.cleanup(); }
});

test("does not report stopping or stopped workers as healthy", async () => {
  const f = await fixture();
  try {
    const now = await writeStatus(f.root, { status: "stopping" });
    const result = await readDeveloperSandboxWorkerHealth(f.root, { now });
    assert.equal(result.healthy, false);
    assert.equal(result.status, "stopping");
  } finally { await f.cleanup(); }
});

test("rejects malformed heartbeat data and symlinked status files", async () => {
  const f = await fixture();
  try {
    await fs.writeFile(path.join(f.root, "worker-status.json"), JSON.stringify({ status: "running", pid: -1 }));
    let result = await readDeveloperSandboxWorkerHealth(f.root);
    assert.equal(result.status, "invalid");
    await fs.rm(path.join(f.root, "worker-status.json"));
    const target = path.join(f.root, "real-status.json");
    await fs.writeFile(target, JSON.stringify({ status: "running", pid: 1234, startedAt: "2026-11-15T06:00:00.000Z", heartbeatAt: "2026-11-15T07:00:00.000Z" }));
    await fs.symlink(target, path.join(f.root, "worker-status.json"));
    result = await readDeveloperSandboxWorkerHealth(f.root, { now: Date.parse("2026-11-15T07:00:00.000Z") });
    assert.equal(result.status, "invalid");
    assert.equal(result.healthy, false);
  } finally { await f.cleanup(); }
});

test("reports a missing heartbeat without throwing", async () => {
  const f = await fixture();
  try {
    const result = await readDeveloperSandboxWorkerHealth(f.root);
    assert.equal(result.status, "missing");
    assert.equal(result.healthy, false);
  } finally { await f.cleanup(); }
});
