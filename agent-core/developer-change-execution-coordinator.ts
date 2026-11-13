import type { ApprovalRepository, ApprovalRequest } from "./approval-ledger.ts";
import {
  approveDeveloperChange,
  recordDeveloperReview,
  submitDeveloperChange,
  type DeveloperChangeRequest,
} from "./developer-change-control.ts";
import {
  DEVELOPER_WORKSPACE_APPLY_CAPABILITY,
  executeDeveloperPatchPackage,
  rollbackDeveloperWorkspaceChange,
  type DeveloperExecutionAuditEvent,
  type DeveloperWorkspaceAdapter,
  type DeveloperExecutionResult,
} from "./developer-workspace-executor.ts";
import { verifyDeveloperPatchPackage, type PreparedDeveloperPatchPackage } from "./developer-patch-package.ts";
import type { DeveloperChangeRepository } from "./developer-change-store.ts";

export interface DeveloperChangeCoordinatorOptions {
  changes: DeveloperChangeRepository;
  approvals: ApprovalRepository;
  workspace: DeveloperWorkspaceAdapter;
  audit?: (event: DeveloperExecutionAuditEvent) => Promise<void>;
  now?: () => Date;
}

function exactApprovalArgs(change: DeveloperChangeRequest, pkg: PreparedDeveloperPatchPackage) {
  return {
    changeId: change.id,
    packageSha256: pkg.packageSha256,
    workspaceId: change.workspaceId,
    baselineCommit: pkg.baselineCommit,
    filePaths: pkg.files.map(file => file.path).sort(),
  };
}

/**
 * Coordinates persisted Founder-scoped lifecycle transitions with the existing
 * single-use approval ledger and isolated workspace executor. It does not create
 * a worker, execute shell commands, deploy, merge, or bypass independent review.
 */
export class DeveloperChangeExecutionCoordinator {
  constructor(private readonly options: DeveloperChangeCoordinatorOptions) {}

  private timestamp(): Date {
    const value = this.options.now?.() ?? new Date();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new Error("A valid Developer change timestamp is required.");
    }
    return value;
  }

  private async owned(changeId: string, founderId: string): Promise<DeveloperChangeRequest> {
    const change = await this.options.changes.get({ changeId, founderId });
    if (!change) throw new Error("Developer change not found for this Founder.");
    return change;
  }

  async submit(input: { changeId: string; founderId: string }): Promise<DeveloperChangeRequest> {
    const change = await this.owned(input.changeId, input.founderId);
    const next = submitDeveloperChange(change, this.timestamp());
    return this.options.changes.update(next);
  }

  async review(input: {
    changeId: string; founderId: string; reviewerId: string;
    decision: "approved" | "changes_requested"; notes: string;
  }): Promise<DeveloperChangeRequest> {
    const change = await this.owned(input.changeId, input.founderId);
    const next = recordDeveloperReview(change, {
      reviewerId: input.reviewerId, decision: input.decision, notes: input.notes, now: this.timestamp(),
    });
    return this.options.changes.update(next);
  }

  async approve(input: { changeId: string; founderId: string }): Promise<DeveloperChangeRequest> {
    const change = await this.owned(input.changeId, input.founderId);
    const next = approveDeveloperChange(change, input.founderId, this.timestamp());
    return this.options.changes.update(next);
  }

  async requestApplyApproval(input: {
    changeId: string; founderId: string; taskId: string; pkg: PreparedDeveloperPatchPackage;
  }): Promise<ApprovalRequest> {
    const change = await this.owned(input.changeId, input.founderId);
    const pkg = input.pkg;
    if (change.status !== "approved" || !change.founderApproval ||
        change.founderApproval.founderId !== input.founderId || change.founderId !== input.founderId) {
      throw new Error("Independent review and owning Founder approval are required before requesting apply approval.");
    }
    if (!input.taskId.trim() || !verifyDeveloperPatchPackage(pkg) ||
        pkg.changeId !== change.id || pkg.founderId !== input.founderId ||
        pkg.workspaceId !== change.workspaceId || pkg.diffSha256 !== change.diffSha256) {
      throw new Error("A valid patch package matching the approved change is required.");
    }
    const expected = [...change.files].sort();
    const actual = pkg.files.map(file => file.path).sort();
    if (expected.length !== actual.length || expected.some((file, index) => file !== actual[index])) {
      throw new Error("Patch package paths do not exactly match the approved change.");
    }
    return this.options.approvals.request({
      taskId: input.taskId,
      founderId: input.founderId,
      capability: DEVELOPER_WORKSPACE_APPLY_CAPABILITY,
      args: exactApprovalArgs(change, pkg),
    });
  }

  async execute(input: {
    changeId: string; founderId: string; taskId: string; approvalId: string;
    pkg: PreparedDeveloperPatchPackage;
  }): Promise<DeveloperExecutionResult> {
    const change = await this.owned(input.changeId, input.founderId);
    const result = await executeDeveloperPatchPackage({
      change, pkg: input.pkg, founderId: input.founderId, taskId: input.taskId,
      approvalId: input.approvalId, approvals: this.options.approvals,
      workspace: this.options.workspace, audit: this.options.audit, now: this.timestamp(),
    });
    const persisted: DeveloperChangeRequest = {
      ...result.change,
      execution: { ...result.change.execution!, taskId: input.taskId, packageSha256: result.packageSha256 },
      rollbackSnapshotId: result.snapshotId,
      updatedAt: this.timestamp().toISOString(),
    };
    try {
      await this.options.changes.update(persisted);
    } catch (persistenceError) {
      // Never leave an applied workspace untracked if the durable lifecycle write fails.
      try {
        await rollbackDeveloperWorkspaceChange({
          result, workspace: this.options.workspace, audit: this.options.audit, now: this.timestamp(),
        });
      } catch (rollbackError) {
        throw new Error(
          "Developer patch was applied but lifecycle persistence failed, and automatic restore also failed: " +
          (rollbackError instanceof Error ? rollbackError.message : "unknown rollback error"),
          { cause: persistenceError },
        );
      }
      throw new Error("Developer patch was restored because execution state could not be persisted.", {
        cause: persistenceError,
      });
    }
    return result;
  }
}
