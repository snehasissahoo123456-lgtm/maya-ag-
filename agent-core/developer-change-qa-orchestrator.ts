import {
  markDeveloperChangeRolledBack,
  recordDeveloperVerification,
  type DeveloperChangeRequest,
} from "./developer-change-control.ts";
import type { DeveloperChangeRepository } from "./developer-change-store.ts";
import {
  collectDeveloperSandboxResult,
  enqueueDeveloperSandboxJob,
  evaluateDeveloperSandboxQA,
  type EnqueuedDeveloperSandboxJob,
  type DeveloperSandboxQueueOptions,
} from "./developer-sandbox-queue.ts";
import type { SandboxCommand, SandboxResult } from "./developer-sandbox-worker.ts";
import {
  rollbackDeveloperWorkspaceChange,
  type DeveloperExecutionAuditEvent,
  type DeveloperExecutionResult,
  type DeveloperWorkspaceAdapter,
} from "./developer-workspace-executor.ts";

const COMMANDS: readonly SandboxCommand[] = ["typecheck", "test", "build"];

export interface DeveloperChangeQAOptions {
  changes: DeveloperChangeRepository;
  workspace: DeveloperWorkspaceAdapter;
  queueRoot: string;
  now?: () => Date;
  wait?: (milliseconds: number) => Promise<void>;
  audit?: (event: DeveloperExecutionAuditEvent) => Promise<void>;
}

export interface DeveloperChangeQAResult {
  status: "completed" | "rolled_back";
  change: DeveloperChangeRequest;
  passed: boolean;
  jobs: EnqueuedDeveloperSandboxJob[];
  results: SandboxResult[];
  summary: string;
}

/**
 * Publishes only the fixed Developer QA command set, waits for the separately
 * operated sandbox worker, and persists QA evidence. Any failed, missing,
 * malformed, stale or timed-out result causes exact-snapshot rollback.
 * This orchestrator never starts a worker or enables the Compose profile.
 */
export async function verifyDeveloperWorkspaceChange(
  options: DeveloperChangeQAOptions,
  input: {
    changeId: string;
    founderId: string;
    execution: DeveloperExecutionResult;
    timeoutMs?: number;
    pollIntervalMs?: number;
  },
): Promise<DeveloperChangeQAResult> {
  const timestamp = () => {
    const value = options.now?.() ?? new Date();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new Error("A valid Developer QA timestamp is required.");
    }
    return value;
  };
  const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const timeoutMs = input.timeoutMs ?? 10 * 60_000;
  const pollIntervalMs = input.pollIntervalMs ?? 1_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30 * 60_000 ||
      !Number.isInteger(pollIntervalMs) || pollIntervalMs < 50 || pollIntervalMs > 30_000) {
    throw new Error("Developer QA timeout or polling interval is outside its safe bounds.");
  }

  let change = await options.changes.get({ changeId: input.changeId, founderId: input.founderId });
  if (!change || change.status !== "executing" || change.founderId !== input.founderId ||
      change.id !== input.execution.change.id || change.workspaceId !== input.execution.change.workspaceId ||
      change.rollbackSnapshotId !== input.execution.snapshotId ||
      input.execution.status !== "applied" || !input.execution.snapshotId.trim()) {
    throw new Error("A persisted Founder-owned execution and its exact rollback snapshot are required for QA.");
  }

  change = { ...change, status: "verifying", updatedAt: timestamp().toISOString() };
  await options.changes.update(change);

  const queueOptions: DeveloperSandboxQueueOptions = { queueRoot: options.queueRoot, now: timestamp };
  const jobs: EnqueuedDeveloperSandboxJob[] = [];
  const results: SandboxResult[] = [];
  const byCommand = new Map<SandboxCommand, SandboxResult>();
  let failure: string | undefined;
  try {
    const workspaceState = await options.workspace.inspect();
    if (workspaceState.workspaceId !== change.workspaceId || !workspaceState.isolated ||
        workspaceState.networkAccess || workspaceState.secretsMounted) {
      throw new Error("Workspace isolation or identity check failed before QA.");
    }
    for (const command of COMMANDS) {
      jobs.push(await enqueueDeveloperSandboxJob(queueOptions, {
        workspaceId: change.workspaceId,
        baselineCommit: workspaceState.baselineCommit,
        command,
      }));
    }
    const deadline = Date.now() + timeoutMs;
    while (byCommand.size < COMMANDS.length && Date.now() < deadline) {
      for (const job of jobs) {
        if (byCommand.has(job.command)) continue;
        const result = await collectDeveloperSandboxResult(queueOptions, job);
        if (result) {
          byCommand.set(job.command, result);
          results.push(result);
        }
      }
      if (byCommand.size < COMMANDS.length) {
        await wait(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
      }
    }
    if (byCommand.size !== COMMANDS.length) {
      failure = "Sandbox worker did not return every required QA result before timeout.";
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : "Sandbox QA orchestration failed.";
  }

  const report = evaluateDeveloperSandboxQA(results, timestamp());
  const passed = !failure && report.passed;
  const summary = passed
    ? "All required isolated Developer checks passed: typecheck, tests and production build."
    : (failure ?? report.gate.findings.map(finding => `${finding.checkId}: ${finding.message}`).join("\n") ?? "One or more required Developer QA checks did not pass.").slice(0, 4000);
  const verified = recordDeveloperVerification(change, {
    passed, evidenceRef: "maya-sandbox://verification/" + change.id,
    summary, now: timestamp(),
  });
  await options.changes.update(verified);
  if (passed) {
    return { status: "completed", change: verified, passed: true, jobs, results, summary };
  }

  await rollbackDeveloperWorkspaceChange({
    result: { ...input.execution, change: verified },
    workspace: options.workspace,
    audit: options.audit,
    now: timestamp(),
  });
  const rolledBack = markDeveloperChangeRolledBack(verified, input.execution.snapshotId, timestamp());
  const saved = await options.changes.update(rolledBack);
  return { status: "rolled_back", change: saved, passed: false, jobs, results, summary };
}
