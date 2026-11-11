import {
  collectDeveloperSandboxResult,
  enqueueDeveloperSandboxJob,
  evaluateDeveloperSandboxQA,
  DEVELOPER_SANDBOX_COMMANDS,
  type EnqueuedDeveloperSandboxJob,
  type DeveloperSandboxQAReport,
} from "./developer-sandbox-queue.ts";
import {
  markDeveloperChangeRolledBack,
  recordDeveloperVerification,
  type DeveloperChangeRequest,
} from "./developer-change-control.ts";
import {
  rollbackDeveloperWorkspaceChange,
  type DeveloperExecutionAuditEvent,
  type DeveloperExecutionResult,
  type DeveloperWorkspaceAdapter,
} from "./developer-workspace-executor.ts";
import type { SandboxResult } from "./developer-sandbox-worker.ts";

export interface DeveloperSandboxVerificationOptions {
  execution: DeveloperExecutionResult;
  baselineCommit: string;
  queueRoot: string;
  workspace: DeveloperWorkspaceAdapter;
  audit?: (event: DeveloperExecutionAuditEvent) => Promise<void>;
  maxWaitMs?: number;
  pollIntervalMs?: number;
  now?: () => Date;
  monotonicNow?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}
export interface DeveloperSandboxVerificationOutcome {
  jobs: EnqueuedDeveloperSandboxJob[];
  results: SandboxResult[];
  qa: DeveloperSandboxQAReport;
  change: DeveloperChangeRequest;
  rolledBack: boolean;
  timedOut: boolean;
  failure?: string;
}
const REQUIRED_WAIT = 600_000;
const DEFAULT_POLL = 500;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function summary(report: DeveloperSandboxQAReport, failure?: string): string {
  const findings = report.gate.findings.map(item => item.checkId + "=" + item.status + ": " + item.message).join("; ");
  return (report.passed ? "All isolated Developer checks passed. " : "Isolated Developer QA did not pass. ") +
    findings.slice(0, 3000) + (failure ? " Failure: " + failure.slice(0, 800) : "");
}

/**
 * Runs fixed sandbox checks after an approved patch has been applied. Any failed,
 * missing, rejected or stale QA evidence triggers restoration of the executor snapshot.
 * The worker must already be running in its separately configured isolated container.
 */
export async function verifyDeveloperWorkspaceExecution(
  input: DeveloperSandboxVerificationOptions,
): Promise<DeveloperSandboxVerificationOutcome> {
  const { execution } = input;
  if (!execution || execution.status !== "applied" || execution.change.status !== "executing" ||
      !(/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$/.test(execution.change.workspaceId)) ||
      !(/^[a-f0-9]{40}$/i.test(input.baselineCommit)) || !execution.snapshotId.trim()) {
    throw new Error("A successfully applied Developer execution with a rollback snapshot is required.");
  }
  const maxWaitMs = input.maxWaitMs ?? REQUIRED_WAIT;
  const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_POLL;
  if (!Number.isInteger(maxWaitMs) || maxWaitMs < 1_000 || maxWaitMs > 1_800_000 ||
      !Number.isInteger(pollIntervalMs) || pollIntervalMs < 100 || pollIntervalMs > 10_000) {
    throw new Error("Developer sandbox verification timing limits are invalid.");
  }
  const now = input.now ?? (() => new Date());
  const monotonicNow = input.monotonicNow ?? (() => Date.now());
  const pause = input.sleep ?? sleep;
  const jobs: EnqueuedDeveloperSandboxJob[] = [];
  const results: SandboxResult[] = [];
  let failure: string | undefined;
  let timedOut = false;

  try {
    const state = await input.workspace.inspect();
    if (state.workspaceId !== execution.change.workspaceId ||
        state.baselineCommit.toLowerCase() !== input.baselineCommit.toLowerCase() ||
        !state.isolated || state.networkAccess || state.secretsMounted) {
      throw new Error("Workspace isolation, identity or baseline changed before verification.");
    }
    for (const command of DEVELOPER_SANDBOX_COMMANDS) {
      jobs.push(await enqueueDeveloperSandboxJob({ queueRoot: input.queueRoot, now }, {
        workspaceId: execution.change.workspaceId,
        baselineCommit: input.baselineCommit,
        command,
      }));
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : "Unable to enqueue isolated Developer checks.";
  }

  if (!failure) {
    const started = monotonicNow();
    while (results.length < jobs.length && monotonicNow() - started < maxWaitMs) {
      for (const job of jobs) {
        if (results.some(result => result.id === job.id)) continue;
        try {
          const result = await collectDeveloperSandboxResult({ queueRoot: input.queueRoot, now }, job);
          if (result) results.push(result);
        } catch (error) {
          failure = error instanceof Error ? error.message : "Unable to collect a sandbox result.";
          break;
        }
      }
      if (failure || results.length === jobs.length) break;
      await pause(Math.min(pollIntervalMs, Math.max(1, maxWaitMs - (monotonicNow() - started))));
    }
    timedOut = !failure && results.length < jobs.length;
    if (timedOut) failure = "Timed out waiting for all three isolated Developer checks.";
  }

  const evaluatedAt = now();
  const qa = evaluateDeveloperSandboxQA(results, evaluatedAt);
  if (qa.passed && !failure) {
    const change = recordDeveloperVerification(execution.change, {
      passed: true,
      evidenceRef: "maya-sandbox://qa/" + execution.change.id,
      summary: summary(qa),
      now: evaluatedAt,
    });
    return { jobs, results, qa, change, rolledBack: false, timedOut: false };
  }

  const failedChange = recordDeveloperVerification(execution.change, {
    passed: false,
    evidenceRef: "maya-sandbox://qa/" + execution.change.id,
    summary: summary(qa, failure),
    now: evaluatedAt,
  });
  try {
    await rollbackDeveloperWorkspaceChange({
      result: execution,
      workspace: input.workspace,
      audit: input.audit,
      now: evaluatedAt,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown rollback error.";
    throw new Error("Developer QA failed and automatic rollback could not be verified: " + detail);
  }
  const change = markDeveloperChangeRolledBack(failedChange, execution.snapshotId, evaluatedAt);
  return { jobs, results, qa, change, rolledBack: true, timedOut, failure };
}
