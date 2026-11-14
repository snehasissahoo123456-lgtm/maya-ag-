import { createHash } from "node:crypto";
import { createTask, transitionTask } from "./task-lifecycle.ts";
import type { TaskEnvelope, TaskRepository } from "./task-orchestrator.ts";

export interface DeveloperTaskExecutionInput {
  taskId: string;
  founderId: string;
  changeId: string;
  packageSha256: string;
}

/** Create a non-queueable record for the Founder-approved Developer execution. */
export async function startDeveloperExecutionTask(
  repository: TaskRepository,
  input: DeveloperTaskExecutionInput,
): Promise<TaskEnvelope> {
  const existing = await repository.get(input.taskId, input.founderId);
  if (existing) throw new Error("Developer task ID is already present in the task ledger; refusing to reuse it.");
  let task = createTask({
    id: input.taskId,
    founderId: input.founderId,
    instruction: "Apply Founder-approved Developer change " + input.changeId,
    riskLevel: "medium",
    requiresApproval: false,
  });
  task = transitionTask(task, "planning");
  task = transitionTask(task, "running");
  const envelope: TaskEnvelope = {
    task,
    capability: "developer.change.apply",
    args: { changeId: input.changeId, packageSha256: input.packageSha256 },
    attempts: 1,
    idempotencyKey: input.taskId,
  };
  await repository.put(envelope);
  return envelope;
}

export async function markDeveloperExecutionVerifying(
  repository: TaskRepository,
  envelope: TaskEnvelope,
  input: { snapshotId: string; appliedFiles: string[] },
): Promise<TaskEnvelope> {
  envelope.task = transitionTask(envelope.task, "verifying");
  envelope.result = {
    snapshotId: input.snapshotId,
    appliedFiles: [...input.appliedFiles],
    packageSha256: String(envelope.args.packageSha256),
  };
  await repository.put(envelope);
  return envelope;
}

export async function finishDeveloperExecutionTask(
  repository: TaskRepository,
  envelope: TaskEnvelope,
  input: { passed: boolean; summary: string; evidenceDigest: string },
): Promise<TaskEnvelope> {
  if (input.passed) {
    envelope.task = transitionTask(envelope.task, "completed", {
      evidence: {
        kind: "developer-independent-qa-sha256",
        description: input.summary,
        reference: "sha256:" + input.evidenceDigest,
        observedAt: new Date().toISOString(),
      },
    });
  } else {
    envelope.task = transitionTask(envelope.task, "failed", {
      error: ("Independent Developer QA failed and the workspace was rolled back: " + input.summary).slice(0, 1000),
    });
  }
  envelope.result = { ...(typeof envelope.result === "object" && envelope.result ? envelope.result as object : {}), qaPassed: input.passed, qaSummary: input.summary };
  await repository.put(envelope);
  return envelope;
}

export async function markDeveloperExecutionRecovery(
  repository: TaskRepository,
  envelope: TaskEnvelope,
  reason: string,
): Promise<void> {
  if (envelope.task.status !== "running" && envelope.task.status !== "verifying" && envelope.task.status !== "paused") return;
  envelope.task = transitionTask(envelope.task, "requires_recovery", {
    error: reason.slice(0, 1000),
  });
  await repository.put(envelope);
}

export function developerQAEvidenceDigest(input: {
  passed: boolean;
  summary: string;
  results: Array<{ command: string; status: string; exitCode: number; timedOut: boolean }>;
}): string {
  return createHash("sha256").update(JSON.stringify({
    passed: input.passed,
    summary: input.summary,
    results: input.results.map(result => ({
      command: result.command,
      status: result.status,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
    })),
  })).digest("hex");
}
