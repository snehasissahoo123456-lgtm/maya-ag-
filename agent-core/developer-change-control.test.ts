import assert from "node:assert/strict";
import test from "node:test";
import {
  approveDeveloperChange, createDeveloperChangeRequest, markDeveloperChangeRolledBack,
  recordDeveloperReview, recordDeveloperVerification, startDeveloperChangeExecution,
  submitDeveloperChange, validateDeveloperPatch,
} from "./developer-change-control.ts";

const now = new Date("2026-11-10T12:00:00.000Z");
const make = () => createDeveloperChangeRequest({
  id: "change-1", founderId: "founder-1", title: "Improve worker retry", objective: "Add bounded retry behavior",
  workspaceId: "isolated-ws-1", files: ["agent-core/retry.ts"], patch: "diff --git a/agent-core/retry.ts b/agent-core/retry.ts\n+export const retry = true;",
  diffSha256: "a".repeat(64), now,
});
const approve = () => approveDeveloperChange(
  recordDeveloperReview(submitDeveloperChange(make(), now), { reviewerId: "qa-1", decision: "approved", notes: "Diff reviewed", now }),
  "founder-1", now,
);

test("rejects traversal, absolute, protected and unsupported file paths", () => {
  for (const file of ["../secret.ts", "/etc/passwd.ts", "C:/temp/x.ts", ".env", "secrets.yaml", "bin/program.exe"]) {
    assert.throws(() => validateDeveloperPatch({ files: [file], patch: "small diff" }));
  }
});

test("rejects private keys and credential-like content", () => {
  assert.throws(() => validateDeveloperPatch({ files: ["src/a.ts"], patch: "-----BEGIN PRIVATE KEY-----" }));
});

test("requires unique paths and bounded patch payloads", () => {
  assert.throws(() => validateDeveloperPatch({ files: ["src/a.ts", "src/a.ts"], patch: "diff" }));
  assert.throws(() => validateDeveloperPatch({ files: ["src/a.ts"], patch: "12345", policy: { maxPatchChars: 4 } }));
});

test("requires an independent review and owning Founder approval before execution", () => {
  const draft = make();
  assert.throws(() => approveDeveloperChange(draft, "founder-1", now));
  const submitted = submitDeveloperChange(draft, now);
  assert.throws(() => recordDeveloperReview(submitted, { reviewerId: "founder-1", decision: "approved", notes: "", now }));
  const reviewed = recordDeveloperReview(submitted, { reviewerId: "qa-1", decision: "approved", notes: "Looks safe", now });
  assert.throws(() => approveDeveloperChange(reviewed, "another-founder", now));
  const approved = approveDeveloperChange(reviewed, "founder-1", now);
  assert.equal(startDeveloperChangeExecution(approved, now).status, "executing");
});

test("requires successful verification before completion", () => {
  const executing = startDeveloperChangeExecution(approve(), now);
  const failed = recordDeveloperVerification(executing, { passed: false, evidenceRef: "ci://failed", summary: "Tests failed", now });
  assert.equal(failed.status, "verifying");
  const completed = recordDeveloperVerification(failed, { passed: true, evidenceRef: "ci://passed", summary: "All checks passed", now });
  assert.equal(completed.status, "completed");
});

test("requires rollback snapshot evidence", () => {
  const executing = startDeveloperChangeExecution(approve(), now);
  assert.throws(() => markDeveloperChangeRolledBack(executing, "", now));
  assert.equal(markDeveloperChangeRolledBack(executing, "snapshot-1", now).status, "rolled_back");
});

test("rejects malformed diff digest", () => {
  assert.throws(() => createDeveloperChangeRequest({
    id: "x", founderId: "f", title: "x", objective: "x", workspaceId: "w",
    files: ["a.ts"], patch: "diff", diffSha256: "not-a-sha", now,
  }));
});
