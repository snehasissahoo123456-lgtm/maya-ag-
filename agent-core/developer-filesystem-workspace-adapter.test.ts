import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { provisionDeveloperWorkspace } from "./developer-workspace-provisioner.ts";
import { DeveloperFilesystemWorkspaceAdapter } from "./developer-filesystem-workspace-adapter.ts";

const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const baseline = "a".repeat(40);
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "maya-fs-adapter-"));
  const workspaceRoot = path.join(root, "workspaces");
  const queueRoot = path.join(root, "queue");
  const original = "export const value = 1;\n";
  await provisionDeveloperWorkspace({ workspaceRoot, queueRoot }, {
    workspaceId: "workspace-001", baselineCommit: baseline,
    files: [{ path: "src/value.ts", content: original, contentSha256: hash(original) }],
  });
  const adapter = await DeveloperFilesystemWorkspaceAdapter.create({
    workspaceRoot, queueRoot,
    isolation: { verify: async () => ({ isolated: true, networkAccess: false, secretsMounted: false }) },
  });
  const pkgFile = (content: string, expectedSha256: string | null) => ({
    path: "src/value.ts", content, expectedSha256, contentSha256: hash(content),
  });
  return { root, workspacePath: path.join(workspaceRoot, "workspace-001"), adapter, pkgFile, original };
}
test("filesystem adapter applies with expected hash and restores exact snapshot", async () => {
  const f = await fixture();
  const updated = "export const value = 2;\n";
  const result = await f.adapter.applyAtomically({
    changeId: "change-001", packageSha256: "b".repeat(64),
    files: [f.pkgFile(updated, hash(f.original))],
  });
  assert.equal(await fs.readFile(path.join(f.workspacePath, "src/value.ts"), "utf8"), updated);
  await f.adapter.restoreSnapshot(result.snapshotId);
  assert.equal(await fs.readFile(path.join(f.workspacePath, "src/value.ts"), "utf8"), f.original);
  await fs.rm(f.root, { recursive: true, force: true });
});
test("rejects stale file preconditions without modifying the workspace", async () => {
  const f = await fixture();
  await assert.rejects(() => f.adapter.applyAtomically({
    changeId: "change-002", packageSha256: "c".repeat(64),
    files: [f.pkgFile("changed", "d".repeat(64))],
  }), /precondition mismatch/i);
  assert.equal(await fs.readFile(path.join(f.workspacePath, "src/value.ts"), "utf8"), f.original);
  await fs.rm(f.root, { recursive: true, force: true });
});
test("creates new files only when expectedSha256 is null", async () => {
  const f = await fixture();
  const content = "export const added = true;\n";
  await f.adapter.applyAtomically({
    changeId: "change-003", packageSha256: "e".repeat(64),
    files: [{ path: "src/new.ts", content, expectedSha256: null, contentSha256: hash(content) }],
  });
  assert.equal(await fs.readFile(path.join(f.workspacePath, "src/new.ts"), "utf8"), content);
  await fs.rm(f.root, { recursive: true, force: true });
});
test("rejects symlink path components and traversal", async () => {
  const f = await fixture();
  const outside = path.join(f.root, "outside");
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(f.workspacePath, "linked"));
  const content = "blocked";
  const file = { path: "linked/pwned.ts", content, expectedSha256: null, contentSha256: hash(content) };
  await assert.rejects(() => f.adapter.applyAtomically({
    changeId: "change-004", packageSha256: "f".repeat(64), files: [file],
  }), /symlink|directory/i);
  await assert.rejects(() => f.adapter.applyAtomically({
    changeId: "change-005", packageSha256: "f".repeat(64),
    files: [{ ...file, path: "../outside/pwned.ts" }],
  }));
  await assert.rejects(() => fs.access(path.join(outside, "pwned.ts")));
  await fs.rm(f.root, { recursive: true, force: true });
});
test("reports isolation only from the injected host verifier", async () => {
  const f = await fixture();
  const unsafe = await DeveloperFilesystemWorkspaceAdapter.create({
    workspaceRoot: path.join(f.root, "workspaces"), queueRoot: path.join(f.root, "queue"),
    isolation: { verify: async () => ({ isolated: false, networkAccess: true, secretsMounted: false }) },
  });
  const state = await unsafe.inspect();
  assert.equal(state.isolated, false);
  assert.equal(state.networkAccess, true);
  await fs.rm(f.root, { recursive: true, force: true });
});
