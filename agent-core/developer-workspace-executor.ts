import type { ApprovalRepository } from "./approval-ledger.ts";
import { validateDeveloperPatch, type DeveloperChangeRequest, startDeveloperChangeExecution } from "./developer-change-control.ts";
import { verifyDeveloperPatchPackage, type PreparedDeveloperPatchPackage } from "./developer-patch-package.ts";

export const DEVELOPER_WORKSPACE_APPLY_CAPABILITY = "developer.workspace.apply";

export interface DeveloperWorkspaceState {
  workspaceId: string;
  baselineCommit: string;
  isolated: boolean;
  networkAccess: boolean;
  secretsMounted: boolean;
}

export interface DeveloperWorkspaceApplyResult {
  snapshotId: string;
}

/**
 * A production adapter must target a disposable isolated workspace, reject symlinks
 * and path escapes, and atomically check every expectedSha256 while applying all files.
 * The executor intentionally has no shell/command API.
 */
export interface DeveloperWorkspaceAdapter {
  inspect(): Promise<DeveloperWorkspaceState>;
  applyAtomically(input: {
    files: PreparedDeveloperPatchPackage["files"];
    changeId: string;
    packageSha256: string;
  }): Promise<DeveloperWorkspaceApplyResult>;
  restoreSnapshot(snapshotId: string): Promise<void>;
}

export interface DeveloperExecutionAuditEvent {
  type: "developer.patch.blocked" | "developer.patch.applied" | "developer.patch.apply_failed" | "developer.patch.rollback";
  founderId: string;
  changeId: string;
  workspaceId: string;
  packageSha256: string;
  occurredAt: string;
  details?: string;
}

export interface DeveloperExecutionResult {
  status: "applied";
  change: DeveloperChangeRequest;
  snapshotId: string;
  packageSha256: string;
  appliedFiles: string[];
}

export async function executeDeveloperPatchPackage(input: {
  change: DeveloperChangeRequest;
  pkg: PreparedDeveloperPatchPackage;
  founderId: string;
  taskId: string;
  approvalId: string;
  approvals: ApprovalRepository;
  workspace: DeveloperWorkspaceAdapter;
  audit?: (event: DeveloperExecutionAuditEvent) => Promise<void>;
  now?: Date;
}): Promise<DeveloperExecutionResult> {
  const now = input.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("A valid execution timestamp is required.");
  const { change, pkg } = input;
  const emit = async (type: DeveloperExecutionAuditEvent["type"], details?: string) => {
    await input.audit?.({
      type, founderId: input.founderId, changeId: change.id, workspaceId: change.workspaceId,
      packageSha256: pkg?.packageSha256 ?? "", occurredAt: now.toISOString(), details,
    });
  };
  const block = async (message: string): Promise<never> => {
    try { await emit("developer.patch.blocked", message.slice(0, 240)); } catch {}
    throw new Error(message);
  };

  if (!change || change.status !== "approved" || change.review?.decision !== "approved" ||
      !change.founderApproval || change.founderApproval.founderId !== input.founderId ||
      change.founderId !== input.founderId) {
    return block("Independent review and owning Founder approval are required.");
  }
  if (!input.taskId.trim() || !input.approvalId.trim()) return block("A task ID and exact Founder approval ID are required.");
  if (!verifyDeveloperPatchPackage(pkg)) return block("Developer patch package integrity verification failed.");
  if (pkg.changeId !== change.id || pkg.founderId !== input.founderId ||
      pkg.workspaceId !== change.workspaceId || pkg.diffSha256 !== change.diffSha256) {
    return block("Patch package identity does not match the approved Developer change.");
  }
  let safe: { files: string[]; patch: string };
  try {
    safe = validateDeveloperPatch({ files: pkg.files.map(file => file.path), patch: change.patch });
  } catch {
    return block("Patch package contains an unsafe path or patch payload.");
  }
  const expectedPaths = [...change.files].sort();
  if (safe.files.length !== expectedPaths.length || safe.files.some((file, index) => file !== expectedPaths[index])) {
    return block("Patch package paths do not exactly match the approved change file list.");
  }

  const state = await input.workspace.inspect();
  if (state.workspaceId !== change.workspaceId || state.baselineCommit.toLowerCase() !== pkg.baselineCommit.toLowerCase()) {
    return block("Workspace identity or baseline commit no longer matches the prepared package.");
  }
  if (!state.isolated || state.networkAccess || state.secretsMounted) {
    return block("Workspace must be isolated, network-disabled and free of mounted secrets.");
  }

  const approvalArgs = {
    changeId: change.id,
    packageSha256: pkg.packageSha256,
    workspaceId: change.workspaceId,
    baselineCommit: pkg.baselineCommit,
    filePaths: [...pkg.files].map(file => file.path).sort(),
  };
  // Single-use ledger consumption binds approval to this Founder, task, capability and exact package.
  await input.approvals.consume({
    approvalId: input.approvalId,
    founderId: input.founderId,
    taskId: input.taskId,
    capability: DEVELOPER_WORKSPACE_APPLY_CAPABILITY,
    args: approvalArgs,
    now: now.getTime(),
  });

  const executing = startDeveloperChangeExecution(change, now);
  let applied: DeveloperWorkspaceApplyResult;
  try {
    // Adapter contract: re-check file preconditions and apply atomically; no partial writes.
    applied = await input.workspace.applyAtomically({
      files: pkg.files,
      changeId: change.id,
      packageSha256: pkg.packageSha256,
    });
    if (!applied || typeof applied.snapshotId !== "string" || !applied.snapshotId.trim()) {
      throw new Error("Workspace adapter did not return a rollback snapshot.");
    }
  } catch (error) {
    try { await emit("developer.patch.apply_failed", error instanceof Error ? error.message : "Workspace apply failed."); } catch {}
    throw error;
  }

  await emit("developer.patch.applied", "Applied " + pkg.files.length + " file(s); snapshot " + applied.snapshotId);
  return {
    status: "applied",
    change: executing,
    snapshotId: applied.snapshotId,
    packageSha256: pkg.packageSha256,
    appliedFiles: pkg.files.map(file => file.path),
  };
}

/** Rollback requires the exact snapshot returned by the workspace adapter. */
export async function rollbackDeveloperWorkspaceChange(input: {
  result: DeveloperExecutionResult;
  workspace: DeveloperWorkspaceAdapter;
  audit?: (event: DeveloperExecutionAuditEvent) => Promise<void>;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  if (!input.result.snapshotId.trim()) throw new Error("A rollback snapshot is required.");
  await input.workspace.restoreSnapshot(input.result.snapshotId);
  await input.audit?.({
    type: "developer.patch.rollback",
    founderId: input.result.change.founderId,
    changeId: input.result.change.id,
    workspaceId: input.result.change.workspaceId,
    packageSha256: input.result.packageSha256,
    occurredAt: now.toISOString(),
    details: "Restored snapshot " + input.result.snapshotId,
  });
}
