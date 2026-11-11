import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { evaluateQAGate, type QACheckEvidence, type QAGateResult } from "./qa-gate.ts";
import type { SandboxCommand, SandboxResult } from "./developer-sandbox-worker.ts";

export const DEVELOPER_SANDBOX_COMMANDS: readonly SandboxCommand[] = ["typecheck", "test", "build"];
export const DEVELOPER_SANDBOX_REQUIRED_CHECKS = [
  "developer.typecheck", "developer.tests", "developer.build",
] as const;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$/;
const SHA = /^[a-f0-9]{40}$/i;
const MAX_RESULT_BYTES = 80_000;
const COMMAND_CHECK: Record<SandboxCommand, string> = {
  typecheck: "developer.typecheck", test: "developer.tests", build: "developer.build",
};

export interface EnqueuedDeveloperSandboxJob {
  id: string;
  workspaceId: string;
  baselineCommit: string;
  command: SandboxCommand;
  createdAt: string;
}
export interface DeveloperSandboxQueueOptions {
  queueRoot: string;
  now?: () => Date;
}
export interface DeveloperSandboxQAReport {
  passed: boolean;
  results: SandboxResult[];
  evidence: QACheckEvidence[];
  gate: QAGateResult;
}

async function directory(input: string): Promise<string> {
  await fs.mkdir(input, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(input);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Sandbox queue paths must be regular non-symlink directories.");
  const real = await fs.realpath(input);
  if (real !== path.resolve(input)) throw new Error("Sandbox queue paths cannot resolve through symlinks.");
  return real;
}
async function regularFile(input: string, maxBytes: number): Promise<Buffer> {
  const stat = await fs.lstat(input);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes) {
    throw new Error("Sandbox queue record is not a bounded regular file.");
  }
  return fs.readFile(input);
}

/** Publish one fixed allowlisted job only for a provisioned workspace with a matching baseline marker. */
export async function enqueueDeveloperSandboxJob(
  options: DeveloperSandboxQueueOptions,
  input: { workspaceId: string; baselineCommit: string; command: SandboxCommand },
): Promise<EnqueuedDeveloperSandboxJob> {
  if (!input || !ID.test(input.workspaceId) || !SHA.test(input.baselineCommit) ||
      !DEVELOPER_SANDBOX_COMMANDS.includes(input.command)) {
    throw new Error("Sandbox job identity, baseline or fixed command is invalid.");
  }
  const root = await directory(path.resolve(options.queueRoot));
  const pending = await directory(path.join(root, "pending"));
  const baselines = await directory(path.join(root, "baselines"));
  const marker = await regularFile(path.join(baselines, input.workspaceId + ".sha"), 64);
  if (marker.toString("utf8").trim().toLowerCase() !== input.baselineCommit.toLowerCase()) {
    throw new Error("Sandbox job baseline does not match the provisioned workspace marker.");
  }
  const now = options.now?.() ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("A valid sandbox job timestamp is required.");
  const job: EnqueuedDeveloperSandboxJob = {
    id: "maya-" + randomUUID(), workspaceId: input.workspaceId,
    baselineCommit: input.baselineCommit.toLowerCase(), command: input.command, createdAt: now.toISOString(),
  };
  const temporary = path.join(pending, "." + job.id + ".tmp");
  const destination = path.join(pending, job.id + ".json");
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(job), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
  return job;
}

/** Collects a completed worker result once its atomic result file is visible. */
export async function collectDeveloperSandboxResult(
  options: DeveloperSandboxQueueOptions,
  expected: Pick<EnqueuedDeveloperSandboxJob, "id" | "workspaceId" | "command">,
): Promise<SandboxResult | null> {
  if (!ID.test(expected.id) || !ID.test(expected.workspaceId) || !DEVELOPER_SANDBOX_COMMANDS.includes(expected.command)) {
    throw new Error("Expected sandbox result identity is invalid.");
  }
  const root = await directory(path.resolve(options.queueRoot));
  const results = await directory(path.join(root, "results"));
  const file = path.join(results, expected.id + ".json");
  let raw: Buffer;
  try { raw = await regularFile(file, MAX_RESULT_BYTES); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let value: unknown;
  try { value = JSON.parse(raw.toString("utf8")); }
  catch { throw new Error("Sandbox worker result is malformed JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Sandbox worker result has an invalid shape.");
  const result = value as SandboxResult;
  if (result.id !== expected.id || result.workspaceId !== expected.workspaceId ||
      result.command !== expected.command ||
      !["passed", "failed", "rejected", "interrupted"].includes(result.status) ||
      !Number.isInteger(result.durationMs) || result.durationMs < 0 ||
      typeof result.finishedAt !== "string" || !Number.isFinite(Date.parse(result.finishedAt)) ||
      typeof result.output !== "string" || result.output.length > 64_000 ||
      (result.exitCode !== null && !Number.isInteger(result.exitCode)) ||
      typeof result.timedOut !== "boolean" ||
      (result.status === "passed" && (result.exitCode !== 0 || result.timedOut)) ||
      (result.status === "failed" && !result.timedOut && (result.exitCode === 0 || result.exitCode === null))) {
    throw new Error("Sandbox worker result does not match the enqueued job or its schema.");
  }
  return result;
}

/** Converts only worker-produced results into evidence; absent results remain missing at the QA gate. */
export function evaluateDeveloperSandboxQA(
  results: readonly SandboxResult[],
  now = new Date(),
): DeveloperSandboxQAReport {
  if (!Array.isArray(results) || results.some(result => !result ||
      !ID.test(result.id) || !ID.test(result.workspaceId) ||
      !DEVELOPER_SANDBOX_COMMANDS.includes(result.command as SandboxCommand) ||
      !["passed", "failed", "rejected", "interrupted"].includes(result.status) ||
      !Number.isInteger(result.durationMs) || result.durationMs < 0 ||
      typeof result.finishedAt !== "string" || !Number.isFinite(Date.parse(result.finishedAt)) ||
      typeof result.output !== "string" || result.output.length > 64_000 ||
      typeof result.timedOut !== "boolean" ||
      (result.status === "passed" && (result.exitCode !== 0 || result.timedOut)) ||
      (result.status === "failed" && !result.timedOut && (result.exitCode === 0 || result.exitCode === null)))) {
    throw new Error("QA evaluation requires valid fixed-command sandbox results.");
  }
  const commands = new Set<SandboxCommand>();
  const evidence: QACheckEvidence[] = [];
  for (const result of results) {
    const command = result.command as SandboxCommand;
    if (commands.has(command)) throw new Error("Duplicate sandbox command results cannot satisfy independent QA.");
    commands.add(command);
    const status = result.status === "passed" ? "passed" :
      result.status === "failed" ? "failed" : result.status === "rejected" ? "blocked" : "not_run";
    evidence.push({
      checkId: COMMAND_CHECK[command], status, executedAt: result.finishedAt,
      command: "npm run " + (command === "typecheck" ? "lint" : command),
      summary: result.output.trim().slice(-2000) || (status === "passed" ? "Command completed successfully." : "Sandbox command did not pass."),
      ...(status === "passed" ? { evidenceRef: "maya-sandbox://jobs/" + result.id } : {}),
    });
  }
  const gate = evaluateQAGate({ requiredChecks: DEVELOPER_SANDBOX_REQUIRED_CHECKS, evidence, now });
  return { passed: gate.passed, results: [...results], evidence, gate };
}
