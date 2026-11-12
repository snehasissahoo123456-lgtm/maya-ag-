import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileHostIsolationNonceStore } from "./developer-host-isolation-nonce-store.ts";

const nonce = "nonce_abcdefghijklmnopqrstuvwxyz123456";
const expiry = "2026-11-12T12:00:30.000Z";
function temporaryDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "maya-host-nonce-"));
}

test("consumes a nonce once and rejects replay", async () => {
  const directory = temporaryDirectory();
  try {
    const store = new FileHostIsolationNonceStore(directory, { now: () => Date.parse("2026-11-12T12:00:00.000Z") });
    assert.equal(await store.consume(nonce, expiry), true);
    assert.equal(await store.consume(nonce, expiry), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("replay protection survives store reconstruction", async () => {
  const directory = temporaryDirectory();
  try {
    const now = () => Date.parse("2026-11-12T12:00:00.000Z");
    assert.equal(await new FileHostIsolationNonceStore(directory, { now }).consume(nonce, expiry), true);
    assert.equal(await new FileHostIsolationNonceStore(directory, { now }).consume(nonce, expiry), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("allows distinct nonces and rejects malformed or expired values", async () => {
  const directory = temporaryDirectory();
  try {
    const store = new FileHostIsolationNonceStore(directory, { now: () => Date.parse("2026-11-12T12:00:00.000Z") });
    assert.equal(await store.consume(nonce, expiry), true);
    assert.equal(await store.consume("nonce_abcdefghijklmnopqrstuvwxyz654321", expiry), true);
    await assert.rejects(store.consume("short", expiry), /nonce is invalid/);
    await assert.rejects(store.consume("nonce_abcdefghijklmnopqrstuvwxyz111111", "2026-11-12T11:59:00.000Z"), /future timestamp/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("rejects a symlink as the nonce-store directory", () => {
  const parent = temporaryDirectory();
  const target = path.join(parent, "target");
  const link = path.join(parent, "link");
  fs.mkdirSync(target);
  try {
    fs.symlinkSync(target, link, "dir");
    assert.throws(() => new FileHostIsolationNonceStore(link), /non-symlink directory/);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test("uses exclusive file creation under concurrent calls", async () => {
  const directory = temporaryDirectory();
  try {
    const now = () => Date.parse("2026-11-12T12:00:00.000Z");
    const storeA = new FileHostIsolationNonceStore(directory, { now });
    const storeB = new FileHostIsolationNonceStore(directory, { now });
    const results = await Promise.all([storeA.consume(nonce, expiry), storeB.consume(nonce, expiry)]);
    assert.equal(results.filter(Boolean).length, 1);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
