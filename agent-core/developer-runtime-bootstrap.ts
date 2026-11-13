import fs from "node:fs/promises";
import path from "node:path";
import type { ApprovalRepository } from "./approval-ledger.ts";
import type { DeveloperChangeRepository } from "./developer-change-store.ts";
import { DeveloperExecutionRuntime } from "./developer-execution-runtime.ts";
import type { DeveloperChangeCoordinatorOptions } from "./developer-change-execution-coordinator.ts";
import { createSignedHostIsolationVerifier } from "./developer-host-isolation-attestation.ts";
import { createHostSupervisorClient } from "./developer-host-supervisor-client.ts";

const WORKSPACE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$/;
const GIT_SHA = /^[a-f0-9]{40}$/i;

export interface DeveloperWorkspaceBinding {
  workspaceId: string;
  baselineCommit: string;
}

export interface DeveloperRuntimeBootstrapResult {
  configured: boolean;
  runtime?: DeveloperExecutionRuntime;
  blockers: string[];
}

export interface DeveloperRuntimeBootstrapOptions {
  env?: NodeJS.ProcessEnv;
  changes: DeveloperChangeRepository;
  approvals: ApprovalRepository;
  audit?: DeveloperChangeCoordinatorOptions["audit"];
  now?: () => Date;
}

/** Read the single enrolled workspace identity without following symlinks. */
export async function readDeveloperWorkspaceBinding(
  workspaceRootInput: string,
  queueRootInput: string,
): Promise<DeveloperWorkspaceBinding> {
  if (!workspaceRootInput.trim() || !queueRootInput.trim()) {
    throw new Error("Developer workspace and queue roots are required.");
  }
  const workspaceRoot = path.resolve(workspaceRootInput);
  const queueRoot = path.resolve(queueRootInput);
  const [workspaceRootStat, queueRootStat] = await Promise.all([
    fs.lstat(workspaceRoot),
    fs.lstat(queueRoot),
  ]);
  if (!workspaceRootStat.isDirectory() || workspaceRootStat.isSymbolicLink() ||
      !queueRootStat.isDirectory() || queueRootStat.isSymbolicLink()) {
    throw new Error("Developer workspace and queue roots must be regular directories, not symlinks.");
  }
  if (await fs.realpath(workspaceRoot) !== workspaceRoot ||
      await fs.realpath(queueRoot) !== queueRoot) {
    throw new Error("Developer runtime roots cannot resolve through symlinks.");
  }

  const entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
  const candidates = entries.filter(entry => entry.isDirectory() && WORKSPACE_ID.test(entry.name));
  if (candidates.length !== 1) {
    throw new Error("Developer runtime requires exactly one enrolled workspace directory.");
  }
  const workspaceId = candidates[0].name;
  const workspacePath = path.join(workspaceRoot, workspaceId);
  const workspaceStat = await fs.lstat(workspacePath);
  if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink() ||
      await fs.realpath(workspacePath) !== workspacePath) {
    throw new Error("Enrolled Developer workspace must be a regular non-symlink directory.");
  }

  const baselineDirectory = path.join(queueRoot, "baselines");
  const baselineDirectoryStat = await fs.lstat(baselineDirectory);
  if (!baselineDirectoryStat.isDirectory() || baselineDirectoryStat.isSymbolicLink() ||
      await fs.realpath(baselineDirectory) !== baselineDirectory) {
    throw new Error("Developer baseline directory must be a regular non-symlink directory.");
  }
  const baselinePath = path.join(baselineDirectory, workspaceId + ".sha");
  const baselineStat = await fs.lstat(baselinePath);
  if (!baselineStat.isFile() || baselineStat.isSymbolicLink() || baselineStat.size > 64) {
    throw new Error("Developer workspace baseline record is invalid.");
  }
  const baselineCommit = (await fs.readFile(baselinePath, "utf8")).trim().toLowerCase();
  if (!GIT_SHA.test(baselineCommit)) throw new Error("Developer workspace baseline commit is invalid.");
  return { workspaceId, baselineCommit };
}

/**
 * Compose the app-side runtime only when all host-supervisor trust material is
 * configured. Missing or invalid configuration fails closed and never infers
 * isolation from Docker settings or environment flags.
 */
export async function bootstrapDeveloperExecutionRuntime(
  options: DeveloperRuntimeBootstrapOptions,
): Promise<DeveloperRuntimeBootstrapResult> {
  const env = options.env ?? process.env;
  const required = [
    "MAYA_DEVELOPER_WORKSPACE_ROOT",
    "MAYA_DEVELOPER_QUEUE_ROOT",
    "MAYA_HOST_SUPERVISOR_SOCKET",
    "MAYA_HOST_SUPERVISOR_TOKEN",
    "MAYA_HOST_ISOLATION_PUBLIC_KEY_PEM",
    "MAYA_HOST_ISOLATION_ISSUER",
  ] as const;
  const missing = required.filter(name => typeof env[name] !== "string" || !env[name]!.trim());
  if (missing.length) {
    return {
      configured: false,
      blockers: missing.map(name => "Missing required runtime setting: " + name),
    };
  }

  try {
    const workspaceRoot = env.MAYA_DEVELOPER_WORKSPACE_ROOT!;
    const queueRoot = env.MAYA_DEVELOPER_QUEUE_ROOT!;
    const supervisor = createHostSupervisorClient({
      socketPath: env.MAYA_HOST_SUPERVISOR_SOCKET!,
      authToken: env.MAYA_HOST_SUPERVISOR_TOKEN!,
    });
    const binding = () => readDeveloperWorkspaceBinding(workspaceRoot, queueRoot);
    const isolation = createSignedHostIsolationVerifier({
      publicKeyPem: env.MAYA_HOST_ISOLATION_PUBLIC_KEY_PEM!.replace(/\\n/g, "\n"),
      expectedIssuer: env.MAYA_HOST_ISOLATION_ISSUER!,
      getBinding: binding,
      getAttestation: async () => supervisor.getAttestation(await binding()),
      consumeNonce: (nonce, expiresAt) => supervisor.consumeNonce(nonce, expiresAt),
      now: options.now,
    });
    const runtime = await DeveloperExecutionRuntime.create({
      workspaceRoot,
      queueRoot,
      changes: options.changes,
      approvals: options.approvals,
      isolation,
      audit: options.audit,
      now: options.now,
    });
    return { configured: true, runtime, blockers: [] };
  } catch (error) {
    return {
      configured: false,
      blockers: [error instanceof Error ? error.message : "Developer runtime bootstrap failed."],
    };
  }
}
