import test from "node:test";
import assert from "node:assert/strict";
import { AuthService } from "./authService.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("does not create a seeded Founder session", () => assert.equal(new AuthService().validateSession("sess-syb-founder-token"), null));
test("does not accept browser-supplied Google identity claims", () => assert.throws(() => new AuthService().loginWithGoogle("founder@example.com", "Founder"), /verified OAuth ID-token validation is not configured/));
test("does not simulate SMS OTP delivery", () => {
  const auth = new AuthService();
  assert.throws(() => auth.sendOtp("+911234567890"), /no trusted SMS delivery provider/);
  assert.throws(() => auth.verifyOtp("+911234567890", "123456"), /no trusted OTP delivery/);
});
test("rejects unknown session tokens", () => assert.equal(new AuthService().validateSession("made-up-token"), null));
test("requires a configured strong Founder password", () => {
  const old = process.env.MAYA_FOUNDER_PASSWORD; delete process.env.MAYA_FOUNDER_PASSWORD;
  try { assert.throws(() => new AuthService().loginWithFounderPassword("snehasissahoo123456@gmail.com", "not-a-password"), /not configured/); }
  finally { if (old === undefined) delete process.env.MAYA_FOUNDER_PASSWORD; else process.env.MAYA_FOUNDER_PASSWORD = old; }
});
test("authenticates only the configured Founder and revokes the issued session", () => {
  const oldP = process.env.MAYA_FOUNDER_PASSWORD, oldE = process.env.MAYA_FOUNDER_EMAIL;
  process.env.MAYA_FOUNDER_PASSWORD = "test-only-founder-password-123";
  process.env.MAYA_FOUNDER_EMAIL = "founder@example.com";
  try {
    const auth = new AuthService();
    assert.throws(() => auth.loginWithFounderPassword("attacker@example.com", "test-only-founder-password-123"), /Invalid Founder credentials/);
    assert.throws(() => auth.loginWithFounderPassword("founder@example.com", "wrong-password"), /Invalid Founder credentials/);
    const session = auth.loginWithFounderPassword("FOUNDER@example.com", "test-only-founder-password-123");
    assert.equal(session.user.role, "Founder");
    assert.equal(auth.validateSession(session.token)?.user.email, "founder@example.com");
    assert.equal(auth.logout(session.token), true);
    assert.equal(auth.validateSession(session.token), null);
  } finally {
    if (oldP === undefined) delete process.env.MAYA_FOUNDER_PASSWORD; else process.env.MAYA_FOUNDER_PASSWORD = oldP;
    if (oldE === undefined) delete process.env.MAYA_FOUNDER_EMAIL; else process.env.MAYA_FOUNDER_EMAIL = oldE;
  }
});

test("persists only token hashes and restores valid Founder sessions after restart", () => {
  const oldP = process.env.MAYA_FOUNDER_PASSWORD, oldE = process.env.MAYA_FOUNDER_EMAIL;
  process.env.MAYA_FOUNDER_PASSWORD = "test-only-founder-password-123";
  process.env.MAYA_FOUNDER_EMAIL = "founder@example.com";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maya-session-store-"));
  const store = path.join(dir, "sessions.json");
  try {
    const first = new AuthService(store);
    const issued = first.loginWithFounderPassword("founder@example.com", "test-only-founder-password-123");
    const disk = fs.readFileSync(store, "utf8");
    assert.equal(disk.includes(issued.token), false, "raw session bearer tokens must never be persisted");
    assert.match(disk, /"tokenHash": "[a-f0-9]{64}"/);
    const restarted = new AuthService(store);
    assert.equal(restarted.validateSession(issued.token)?.user.email, "founder@example.com");
    assert.equal(restarted.validateSession("not-the-token"), null);
    assert.equal(restarted.logout(issued.token), true);
    assert.equal(new AuthService(store).validateSession(issued.token), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    if (oldP === undefined) delete process.env.MAYA_FOUNDER_PASSWORD; else process.env.MAYA_FOUNDER_PASSWORD = oldP;
    if (oldE === undefined) delete process.env.MAYA_FOUNDER_EMAIL; else process.env.MAYA_FOUNDER_EMAIL = oldE;
  }
});

test("fails closed when the persistent session store is corrupt", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maya-session-corrupt-"));
  const store = path.join(dir, "sessions.json");
  try {
    fs.writeFileSync(store, "{broken", "utf8");
    assert.throws(() => new AuthService(store), /Session store is corrupt/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
