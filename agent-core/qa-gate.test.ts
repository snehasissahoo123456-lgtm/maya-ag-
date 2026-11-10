import assert from "node:assert/strict";
import test from "node:test";
import { evaluateQAGate, type QACheckEvidence } from "./qa-gate.ts";

const now = new Date("2026-11-10T12:00:00.000Z");
const pass = (checkId: string): QACheckEvidence => ({
  checkId, status: "passed", executedAt: "2026-11-10T11:30:00.000Z",
  command: "bun run test", summary: "All selected tests passed.", evidenceRef: "ci://run/123",
});

test("accepts only complete, fresh evidence for every required check", () => {
  const result = evaluateQAGate({ requiredChecks: ["typecheck", "unit_tests"], evidence: [pass("typecheck"), pass("unit_tests")], now });
  assert.equal(result.passed, true);
  assert.deepEqual(result.findings.map(item => item.status), ["passed", "passed"]);
});

test("blocks missing checks rather than assuming success", () => {
  const result = evaluateQAGate({ requiredChecks: ["typecheck"], evidence: [], now });
  assert.equal(result.passed, false);
  assert.equal(result.findings[0].status, "missing");
});

test("blocks failed, blocked and not-run checks", () => {
  for (const status of ["failed", "blocked", "not_run"] as const) {
    const evidence = { ...pass("unit_tests"), status };
    const result = evaluateQAGate({ requiredChecks: ["unit_tests"], evidence: [evidence], now });
    assert.equal(result.passed, false);
    assert.equal(result.findings[0].status, status);
  }
});

test("rejects passing claims without an evidence reference", () => {
  const evidence = { ...pass("security"), evidenceRef: "" };
  const result = evaluateQAGate({ requiredChecks: ["security"], evidence: [evidence], now });
  assert.equal(result.passed, false);
  assert.equal(result.findings[0].status, "invalid");
});

test("rejects duplicate evidence for the same check", () => {
  const result = evaluateQAGate({ requiredChecks: ["build"], evidence: [pass("build"), pass("build")], now });
  assert.equal(result.passed, false);
  assert.equal(result.findings[0].status, "duplicate");
});

test("rejects stale and future evidence", () => {
  const stale = { ...pass("stale"), executedAt: "2026-11-08T00:00:00.000Z" };
  const future = { ...pass("future"), executedAt: "2026-11-11T00:00:00.000Z" };
  const result = evaluateQAGate({ requiredChecks: ["stale", "future"], evidence: [stale, future], now });
  assert.equal(result.passed, false);
  assert.deepEqual(result.findings.map(item => item.status), ["stale", "invalid"]);
});

test("validates gate configuration", () => {
  assert.throws(() => evaluateQAGate({ requiredChecks: [], evidence: [], now }), /At least one/);
  assert.throws(() => evaluateQAGate({ requiredChecks: ["bad id"], evidence: [], now }), /valid identifiers/);
});
