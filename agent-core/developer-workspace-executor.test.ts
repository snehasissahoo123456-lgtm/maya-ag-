import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { ApprovalLedger } from "./approval-ledger.ts";
import {
  approveDeveloperChange, createDeveloperChangeRequest, recordDeveloperReview, submitDeveloperChange,
} from "./developer-change-control.ts";
import { prepareDeveloperPatchPackage } from "./developer-patch-package.ts";
import {
  DEVELOPER_WORKSPACE_APPLY_CAPABILITY, executeDeveloperPatchPackage, rollbackDeveloperWorkspaceChange,
  type DeveloperWorkspaceAdapter,
} from "./developer-workspace-executor.ts";

const now = new Date("2026-11-11T10:00:00.000Z");
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const founderId = "founder-1";
const taskId = "task-001";
const content = "export const featureEnabled = true;\n";
const patch = "diff --git a/src/feature.ts b/src/feature.ts\n--- a/src/feature.ts\n+++ b/src/feature.ts\n@@ -0,0 +1 @@\n+export const featureEnabled = true;";

function makeChange() {
  const draft = createDeveloperChangeRequest({
    id: "change-001", founderId, title: "Add feature", objective: "Apply a reviewed feature patch",
    workspaceId: "workspace-1", files: ["src/feature.ts"], patch, diffSha256: digest(patch), now,
  });
  const reviewed = recordDeveloperReview(submitDeveloperChange(draft, now), {
    reviewerId: "independent-qa", decision: "approved", notes: "Reviewed", now,
  });
  return approveDeveloperChange(reviewed, founderId, now);
}
function makePackage() {
  return prepareDeveloperPatchPackage({
    change: makeChange(), baselineCommit: "a".repeat(40),
    files: [{ path: "src/feature.ts", content, expectedSha256: null }], now,
  });
}
function makeWorkspace(overrides: Partial<DeveloperWorkspaceAdapter> = {}) {
  const calls: string[] = [];
  const workspace: DeveloperWorkspaceAdapter = {
    async inspect() {
      return { workspaceId: "workspace-1", baselineCommit: "a".repeat(40), isolated: true, networkAccess: false, secretsMounted: false };
    },
    async applyAtomically(input) {
      calls.push("apply:" + input.packageSha256);
      return { snapshotId: "snapshot-001" };
    },
    async restoreSnapshot(id) { calls.push("restore:" + id); },
    ...overrides,
  };
  return { workspace, calls };
}
async function grant(pkg: ReturnType<typeof makePackage>, ledger = new ApprovalLedger()) {
  const args = {
    changeId: pkg.changeId, packageSha256: pkg.packageSha256, workspaceId: pkg.workspaceId,
    baselineCommit: pkg.baselineCommit, filePaths: pkg.files.map(file => file.path).sort(),
  };
  const request = await ledger.request({
    taskId, founderId, capability: DEVELOPER_WORKSPACE_APPLY_CAPABILITY, args, now: now.getTime(),
  });
  await ledger.decide({ approvalId: request.id, founderId, approved: true, now: now.getTime() + 1 });
  return { ledger, approvalId: request.id };
}

test("applies only an exact Founder-approved package to an isolated workspace", async () => {
  const change = makeChange();
  const pkg = makePackage();
  const { ledger, approvalId } = await grant(pkg);
  const { workspace, calls } = makeWorkspace();
  const events: string[] = [];
  const result = await executeDeveloperPatchPackage({
    change, pkg, founderId, taskId, approvalId, approvals: ledger, workspace,
    audit: async event => { events.push(event.type); }, now,
  });
  assert.equal(result.status, "applied");
  assert.equal(result.snapshotId, "snapshot-001");
  assert.deepEqual(calls, ["apply:" + pkg.packageSha256]);
  assert.deepEqual(events, ["developer.patch.applied"]);
  assert.equal(result.change.status, "executing");
});

test("blocks a workspace that is not isolated, has network access or mounted secrets", async () => {
  for (const unsafe of [
    { isolated: false }, { networkAccess: true }, { secretsMounted: true },
  ]) {
    const change = makeChange(); const pkg = makePackage(); const { ledger, approvalId } = await grant(pkg);
    let applied = false;
    const { workspace } = makeWorkspace({
      async inspect() {
        return { workspaceId: "workspace-1", baselineCommit: "a".repeat(40), isolated: true, networkAccess: false, secretsMounted: false, ...unsafe };
      },
      async applyAtomically() { applied = true; return { snapshotId: "s" }; },
    });
    await assert.rejects(() => executeDeveloperPatchPackage({ change, pkg, founderId, taskId, approvalId, approvals: ledger, workspace, now }), /isolated|network-disabled/i);
    assert.equal(applied, false);
  }
});

test("blocks changed workspace baseline before consuming approval", async () => {
  const change = makeChange(); const pkg = makePackage(); const { ledger, approvalId } = await grant(pkg);
  const { workspace } = makeWorkspace({
    async inspect() { return { workspaceId: "workspace-1", baselineCommit: "b".repeat(40), isolated: true, networkAccess: false, secretsMounted: false }; },
  });
  await assert.rejects(() => executeDeveloperPatchPackage({ change, pkg, founderId, taskId, approvalId, approvals: ledger, workspace, now }), /baseline/i);
  assert.equal((await ledger.listForFounder(founderId))[0].status, "approved");
});

test("rejects package tampering and cross-Founder approval", async () => {
  const change = makeChange(); const pkg = makePackage(); const { ledger, approvalId } = await grant(pkg);
  const { workspace } = makeWorkspace();
  const tampered = { ...pkg, files: [{ ...pkg.files[0], content: "malicious" }] };
  await assert.rejects(() => executeDeveloperPatchPackage({ change, pkg: tampered, founderId, taskId, approvalId, approvals: ledger, workspace, now }), /integrity/i);
  await assert.rejects(() => executeDeveloperPatchPackage({ change, pkg, founderId: "other-founder", taskId, approvalId, approvals: ledger, workspace, now }), /Founder approval/i);
  assert.equal((await ledger.listForFounder(founderId))[0].status, "approved");
});

test("requires the exact single-use task, package digest and capability grant", async () => {
  const change = makeChange(); const pkg = makePackage(); const { ledger, approvalId } = await grant(pkg);
  const { workspace } = makeWorkspace();
  await assert.rejects(() => executeDeveloperPatchPackage({
    change, pkg, founderId, taskId: "different-task", approvalId, approvals: ledger, workspace, now,
  }), /exact Founder|approval/i);
});

test("records failure and leaves no false applied result when atomic apply fails", async () => {
  const change = makeChange(); const pkg = makePackage(); const { ledger, approvalId } = await grant(pkg);
  const { workspace, calls } = makeWorkspace({
    async applyAtomically() { calls.push("failed-apply"); throw new Error("precondition mismatch"); },
  });
  const events: string[] = [];
  await assert.rejects(() => executeDeveloperPatchPackage({
    change, pkg, founderId, taskId, approvalId, approvals: ledger, workspace,
    audit: async event => { events.push(event.type); }, now,
  }), /precondition mismatch/);
  assert.deepEqual(events, ["developer.patch.apply_failed"]);
});

test("rollback restores the exact snapshot and records an audit event", async () => {
  const change = makeChange(); const pkg = makePackage(); const { ledger, approvalId } = await grant(pkg);
  const { workspace, calls } = makeWorkspace();
  const result = await executeDeveloperPatchPackage({ change, pkg, founderId, taskId, approvalId, approvals: ledger, workspace, now });
  const events: string[] = [];
  await rollbackDeveloperWorkspaceChange({
    result, workspace, audit: async event => { events.push(event.type); }, now,
  });
  assert.deepEqual(calls, ["apply:" + pkg.packageSha256, "restore:snapshot-001"]);
  assert.deepEqual(events, ["developer.patch.rollback"]);
});
