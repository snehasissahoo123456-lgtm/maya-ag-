import type { ApprovalRepository } from "./approval-ledger.ts";
import type { TaskEnvelope, TaskRepository } from "./task-orchestrator.ts";
import {
  developerQAEvidenceDigest,
  finishDeveloperExecutionTask,
  markDeveloperExecutionRecovery,
  markDeveloperExecutionVerifying,
  startDeveloperExecutionTask,
} from "./developer-task-ledger.ts";
import type { DeveloperChangeRepository } from "./developer-change-store.ts";
import {
  DeveloperChangeExecutionCoordinator,
  type DeveloperChangeCoordinatorOptions,
} from "./developer-change-execution-coordinator.ts";
import {
  DeveloperChangeQAOptions,
  DeveloperChangeQAResult,
  verifyDeveloperWorkspaceChange,
} from "./developer-change-qa-orchestrator.ts";
import {
  DeveloperFilesystemWorkspaceAdapter,
  type DeveloperFilesystemIsolation,
} from "./developer-filesystem-workspace-adapter.ts";
import type {
  DeveloperExecutionAuditEvent,
  DeveloperExecutionResult,
} from "./developer-workspace-executor.ts";
import type { PreparedDeveloperPatchPackage } from "./developer-patch-package.ts";

export interface DeveloperRuntimeOptions {
  workspaceRoot: string;
  queueRoot: string;
  changes: DeveloperChangeRepository;
  approvals: ApprovalRepository;
  taskRepository?: TaskRepository;
  isolation: DeveloperFilesystemIsolation;
  audit?: DeveloperChangeCoordinatorOptions["audit"];
  now?: () => Date;
}

export interface DeveloperRuntimeReadiness {
  configured: boolean;
  readyToApply: boolean;
  workspaceId?: string;
  baselineCommit?: string;
  isolated?: boolean;
  networkAccess?: boolean;
  secretsMounted?: boolean;
  blockers: string[];
}

/**
 * Explicit composition root for the Developer change lifecycle.
 *
 * It requires the caller to inject a real host/container isolation verifier.
 * It never invents isolation from Docker configuration, starts a worker, grants
 * shell access, or performs execution as a side effect of construction.
 */
export class DeveloperExecutionRuntime {
  readonly workspace: DeveloperFilesystemWorkspaceAdapter;
  readonly coordinator: DeveloperChangeExecutionCoordinator;
  private readonly qaOptions: DeveloperChangeQAOptions;
  private readonly taskRepository?: TaskRepository;

  private constructor(
    workspace: DeveloperFilesystemWorkspaceAdapter,
    options: DeveloperRuntimeOptions,
  ) {
    this.workspace = workspace;
    this.taskRepository = options.taskRepository;
    this.coordinator = new DeveloperChangeExecutionCoordinator({
      changes: options.changes,
      approvals: options.approvals,
      workspace,
      audit: options.audit,
      now: options.now,
    });
    this.qaOptions = {
      changes: options.changes,
      workspace,
      queueRoot: options.queueRoot,
      audit: options.audit,
      now: options.now,
    };
  }

  static async create(options: DeveloperRuntimeOptions): Promise<DeveloperExecutionRuntime> {
    if (!options?.changes || !options?.approvals || !options?.isolation ||
        typeof options.isolation.verify !== "function") {
      throw new Error("Developer runtime requires change storage, approval storage and a host isolation verifier.");
    }
    const workspace = await DeveloperFilesystemWorkspaceAdapter.create({
      workspaceRoot: options.workspaceRoot,
      queueRoot: options.queueRoot,
      isolation: options.isolation,
    });
    return new DeveloperExecutionRuntime(workspace, options);
  }

  async readiness(): Promise<DeveloperRuntimeReadiness> {
    try {
      const state = await this.workspace.inspect();
      const blockers: string[] = [];
      if (!state.isolated) blockers.push("Host supervisor has not attested that the workspace is isolated.");
      if (state.networkAccess) blockers.push("Workspace network access must be disabled.");
      if (state.secretsMounted) blockers.push("Application secrets must not be mounted in the workspace.");
      return {
        configured: true,
        readyToApply: blockers.length === 0,
        workspaceId: state.workspaceId,
        baselineCommit: state.baselineCommit,
        isolated: state.isolated,
        networkAccess: state.networkAccess,
        secretsMounted: state.secretsMounted,
        blockers,
      };
    } catch (error) {
      return {
        configured: true,
        readyToApply: false,
        blockers: [error instanceof Error ? error.message : "Developer workspace readiness could not be verified."],
      };
    }
  }

  requestApplyApproval(input: {
    changeId: string;
    founderId: string;
    taskId: string;
    pkg: PreparedDeveloperPatchPackage;
  }) {
    return this.coordinator.requestApplyApproval(input);
  }

  async execute(input: {
    changeId: string;
    founderId: string;
    taskId: string;
    approvalId: string;
    pkg: PreparedDeveloperPatchPackage;
  }): Promise<DeveloperExecutionResult> {
    let task: TaskEnvelope | undefined;
    if (this.taskRepository) {
      task = await startDeveloperExecutionTask(this.taskRepository, {
        taskId: input.taskId,
        founderId: input.founderId,
        changeId: input.changeId,
        packageSha256: input.pkg.packageSha256,
      });
    }
    try {
      const result = await this.coordinator.execute(input);
      if (task && this.taskRepository) {
        await markDeveloperExecutionVerifying(this.taskRepository, task, {
          snapshotId: result.snapshotId,
          appliedFiles: result.appliedFiles,
        });
      }
      return result;
    } catch (error) {
      if (task && this.taskRepository) {
        try {
          await markDeveloperExecutionRecovery(this.taskRepository, task,
            "Developer apply did not reach a durably verified task state. Inspect the change record and workspace snapshot before retrying: " +
            (error instanceof Error ? error.message : String(error)));
        } catch {
          // The task remains running and will be parked by interrupted-task recovery.
        }
      }
      throw error;
    }
  }

  async verify(input: {
    changeId: string;
    founderId: string;
    execution: DeveloperExecutionResult;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<DeveloperChangeQAResult> {
    const taskId = input.execution.change.execution?.taskId;
    const task = this.taskRepository && taskId
      ? await this.taskRepository.get(taskId, input.founderId)
      : undefined;
    try {
      const result = await verifyDeveloperWorkspaceChange(this.qaOptions, input);
      if (task && this.taskRepository) {
        const evidenceDigest = developerQAEvidenceDigest({
          passed: result.passed,
          summary: result.summary,
          results: result.results.map(item => ({
            command: item.command, status: item.status, exitCode: item.exitCode, timedOut: item.timedOut,
          })),
        });
        await finishDeveloperExecutionTask(this.taskRepository, task, {
          passed: result.passed, summary: result.summary, evidenceDigest,
        });
      }
      return result;
    } catch (error) {
      if (task && this.taskRepository) {
        try {
          await markDeveloperExecutionRecovery(this.taskRepository, task,
            "Developer QA or rollback could not be durably confirmed. Manual inspection is required before retrying: " +
            (error instanceof Error ? error.message : String(error)));
        } catch {
          // The task remains verifying and will be visible for recovery after restart.
        }
      }
      throw error;
    }
  }
}

export type { DeveloperExecutionAuditEvent };
