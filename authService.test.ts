import test from "node:test";
import assert from "node:assert/strict";
import { AuthService } from "./authService.ts";

test("does not create a seeded Founder session", () => {
  const auth = new AuthService();
  assert.equal(auth.validateSession("sess-syb-founder-token"), null);
});

test("does not accept browser-supplied Google identity claims", () => {
  const auth = new AuthService();
  assert.throws(() => auth.loginWithGoogle("founder@example.com", "Founder"), /verified OAuth ID-token validation is not configured/);
});

test("does not expose or simulate an OTP without a delivery provider", () => {
  const auth = new AuthService();
  assert.throws(() => auth.sendOtp("+911234567890"), /no trusted SMS delivery provider/);
  assert.throws(() => auth.verifyOtp("+911234567890", "123456"), /no trusted OTP delivery/);
});

test("rejects unknown session tokens", () => {
  const auth = new AuthService();
  assert.equal(auth.validateSession("made-up-token"), null);
});
