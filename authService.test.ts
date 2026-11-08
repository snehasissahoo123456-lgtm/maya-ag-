import test from "node:test";
import assert from "node:assert/strict";
import { AuthService } from "./authService.ts";

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
