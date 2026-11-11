import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { ApprovalLedger } from "./approval-ledger.ts";
import { createDeveloperChangeRequest } from "./developer-change-control.ts";
import { prepareDeveloperPatchPackage } from "./developer-patch-package.ts";
import { DeveloperChangeStore } from "./developer-change-store.ts";
import { DeveloperChangeExecutionCoordinator } from "./developer-change-execution-coordinator.ts";
import type { DeveloperWorkspaceAdapter } from "./developer-workspace-executor.ts";

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const baseline = "a".repeat(40);

function fixture() {
  const patch = "diff --git a/src/example.ts b/src/example.ts";
  const change = createDeveloperChangeRequest({
    id: "change-0001", founderId: "founder-01", title: "Update example",
    objective: "Apply a reviewed change", workspaceId: "workspace-01",
    files: ["src/example.ts"], patch, diffSha256: sha(patch),
  });
  const pkg = prepareDeveloperPatchPackage({
    change, baselineCommit: baseline,
    files: [{ path: "src/example.ts", content: "export const value = 2;\n", expectedSha256: sha("export const value = 1;\n") }],
  });
  const changes = new DeveloperChangeStore();
  const approvals = new ApprovalLedger();
  let restored = "";
  const workspace: DeveloperWorkspaceAdapter = {
    inspect: async () => ({ workspaceId: "workspace-01", baselineCommit: baseline, isolated: true, networkAccess: false, secretsMounted: false }),
    applyAtomically: async () => ({ snapshotId: "snapshot-0001" }),
    restoreSnapshot: async id => { restored = id; },
  };
  const coordinator = new DeveloperChangeExecutionCoordinator({ changes, approvals, workspace });
  return { change, pkg, changes, approvals, workspace, coordinator, restored: () => restored };
}

async function approve(f: ReturnType<typeof fixture>) {
  await f.changes.create(f.change);
  await f.coordinator.submit({ changeId: f.change.id, founderId: f.change.founderId });
  await f.coordinator.review({ changeId: f.change.id, founderId: f.change.founderId, reviewerId: "reviewer-01", decision: "approved", notes: "Reviewed." });
  await f.coordinator.approve({ changeId: f.change.id, founderId: f.change.founderId });
}

test("coordinates independent review, Founder approval, exact grant and persisted isolated execution", async () => {
  const f = fixture();
  await approve(f);
  const grant = await f.coordinator.requestApplyApproval({
    changeId: f.change.id, founderId: f.change.founderId, taskId: "task-0001", pkg: f.pkg,
  });
  assert.equal(grant.status, "pending");
  await f.approvals.decide({ approvalId: grant.id, founderId: f.change.founderId, approved: true });
  const result = await f.coordinator.execute({
    changeId: f.change.id, founderId: f.change.founderId, taskId: "task-0001",
    approvalId: grant.id, pkg: f.pkg,
  });
  assert.equal(result.status, "applied");
  const saved = await f.changes.get({ changeId: f.change.id, founderId: f.change.founderId });
  assert.equal(saved?.status, "executing");
  assert.equal(saved?.rollbackSnapshotId, "snapshot-0001");
  assert.deepEqual(saved?.execution?.commandIds, []);
  assert.equal((await f.approvals.listForFounder(f.change.founderId))[0].status, "consumed");
});

test("does not issue apply approval before independent review and Founder approval", async () => {
  const f = fixture();
  await f.changes.create(f.change);
  await assert.rejects(
    f.coordinator.requestApplyApproval({
      changeId: f.change.id, founderId: f.change.founderId, taskId: "task-0001", pkg: f.pkg,
    }),
    /review and owning Founder approval/,
  );
});

test("restores the exact snapshot if execution lifecycle persistence fails", async () => {
  const f = fixture();
  await approve(f);
  const grant = await f.coordinator.requestApplyApproval({
    changeId: f.change.id, founderId: f.change.founderId, taskId: "task-0001", pkg: f.pkg,
  });
  await f.approvals.decide({ approvalId: grant.id, founderId: f.change.founderId, approved: true });
  const broken = {
    ...f.changes,
    update: async () => { throw new Error("disk unavailable"); },
  };
  const coordinator = new DeveloperChangeExecutionCoordinator({
    changes: broken, approvals: f.approvals, workspace: f.workspace,
  });
  await assert.rejects(
    coordinator.execute({
      changeId: f.change.id, founderId: f.change.founderId, taskId: "task-0001",
      approvalId: grant.id, pkg: f.pkg,
    }),
    /restored because execution state could not be persisted/,
  );
  assert.equal(f.restored(), "snapshot-0001");
});
