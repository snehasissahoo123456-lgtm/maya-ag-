import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileDeviceRegistry } from "./file-device-registry.ts";

const metadata = { name: "Founder PC", platform: "win32", architecture: "x64", runtimeVersion: "v26" };

test("device pairing is one-time, expiring and stores only a token hash", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-device-registry-"));
  try {
    const registry = new FileDeviceRegistry(directory);
    const pairing = await registry.createPairing("founder-a", 1_000_000);
    const paired = await registry.pair(pairing.code, metadata, 1_000_001);
    assert.equal(paired.device.founderId, "founder-a");
    assert.equal((await registry.authenticate(paired.device.id, "founder-a", paired.token))?.id, paired.device.id);
    await assert.rejects(() => registry.pair(pairing.code, metadata, 1_000_002), /invalid, expired or already used/i);
    const persisted = fs.readFileSync(path.join(directory, "devices.json"), "utf8");
    assert.ok(!persisted.includes(paired.token), "raw device token must never be persisted");
    assert.ok(persisted.includes("tokenHash"));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("pairing expires and device records are Founder-scoped and revocable", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-device-owner-"));
  try {
    const registry = new FileDeviceRegistry(directory);
    const pairing = await registry.createPairing("founder-a", 1_000_000);
    await assert.rejects(() => registry.pair(pairing.code, metadata, 1_000_000 + 5 * 60_000), /invalid, expired/i);
    const next = await registry.createPairing("founder-a", 2_000_000);
    const paired = await registry.pair(next.code, metadata, 2_000_001);
    assert.equal((await registry.list("founder-b")).length, 0);
    assert.equal(await registry.revoke(paired.device.id, "founder-b"), false);
    assert.equal(await registry.revoke(paired.device.id, "founder-a"), true);
    assert.equal(await registry.authenticate(paired.device.id, "founder-a", paired.token), undefined);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
