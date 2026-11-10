import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createDeveloperChangeRequest } from "./developer-change-control.ts";
import { prepareDeveloperPatchPackage, verifyDeveloperPatchPackage } from "./developer-patch-package.ts";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const now = new Date("2026-11-10T12:00:00.000Z");
const makeChange = (files = ["src/example.ts"]) => {
  const patch = "diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+new";
  return createDeveloperChangeRequest({
    id: "change-001", founderId: "founder-1", title: "Update example", objective: "Prepare a safe patch package",
    workspaceId: "workspace-1", files, patch, diffSha256: digest(patch), now,
  });
};

test("creates a deterministic content-addressed package with file preconditions", () => {
  const change = makeChange();
  const input = { change, baselineCommit: "a".repeat(40), files: [{ path: "src/example.ts", content: "export const value = 2;\n", expectedSha256: digest("export const value = 1;\n") }], now };
  const first = prepareDeveloperPatchPackage(input);
  const second = prepareDeveloperPatchPackage(input);
  assert.equal(first.packageSha256, second.packageSha256);
  assert.equal(first.files[0].contentSha256, digest("export const value = 2;\n"));
  assert.equal(verifyDeveloperPatchPackage(first), true);
});

test("rejects mismatched file sets, bad baseline and diff digest", () => {
  const change = makeChange();
  assert.throws(() => prepareDeveloperPatchPackage({ change, baselineCommit: "main", files: [{ path: "src/example.ts", content: "x", expectedSha256: null }], now }));
  assert.throws(() => prepareDeveloperPatchPackage({ change, baselineCommit: "a".repeat(40), files: [{ path: "src/other.ts", content: "x", expectedSha256: null }], now }));
  const corrupted = { ...change, diffSha256: "b".repeat(64) };
  assert.throws(() => prepareDeveloperPatchPackage({ change: corrupted, baselineCommit: "a".repeat(40), files: [{ path: "src/example.ts", content: "x", expectedSha256: null }], now }));
});

test("rejects credential content, unsafe paths and invalid preconditions", () => {
  const change = makeChange();
  assert.throws(() => prepareDeveloperPatchPackage({ change, baselineCommit: "a".repeat(40), files: [{ path: "../secret.ts", content: "x", expectedSha256: null }], now }));
  assert.throws(() => prepareDeveloperPatchPackage({ change, baselineCommit: "a".repeat(40), files: [{ path: "src/example.ts", content: "-----BEGIN PRIVATE KEY-----", expectedSha256: null }], now }));
  assert.throws(() => prepareDeveloperPatchPackage({ change, baselineCommit: "a".repeat(40), files: [{ path: "src/example.ts", content: "x", expectedSha256: "wrong" }], now }));
});

test("enforces file and total content limits", () => {
  const change = makeChange();
  assert.throws(() => prepareDeveloperPatchPackage({
    change, baselineCommit: "a".repeat(40), files: [{ path: "src/example.ts", content: "12345", expectedSha256: null }],
    policy: { maxFileBytes: 4, maxTotalBytes: 4 }, now,
  }));
});

test("detects tampered content or manifest after preparation", () => {
  const pkg = prepareDeveloperPatchPackage({
    change: makeChange(), baselineCommit: "a".repeat(40),
    files: [{ path: "src/example.ts", content: "export const value = 2;", expectedSha256: null }], now,
  });
  assert.equal(verifyDeveloperPatchPackage(pkg), true);
  const tampered = { ...pkg, files: [{ ...pkg.files[0], content: "tampered" }] };
  assert.equal(verifyDeveloperPatchPackage(tampered), false);
});
