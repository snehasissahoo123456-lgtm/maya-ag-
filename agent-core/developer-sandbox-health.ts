import fs from "node:fs/promises";
import path from "node:path";

export type DeveloperSandboxWorkerHealthStatus =
  | "healthy" | "missing" | "stale" | "stopping" | "stopped" | "invalid" | "unconfigured";

export interface DeveloperSandboxWorkerHealth {
  configured: boolean;
  healthy: boolean;
  status: DeveloperSandboxWorkerHealthStatus;
  pid?: number;
  startedAt?: string;
  heartbeatAt?: string;
  ageMs?: number;
  reason?: string;
}

interface WorkerStatusRecord {
  status: "running" | "stopping" | "stopped";
  pid: number;
  startedAt: string;
  heartbeatAt: string;
}

/**
 * Read the sandbox worker's atomic heartbeat from the shared queue volume.
 * This is an observation only: it never starts the worker or grants execution.
 */
export async function readDeveloperSandboxWorkerHealth(
  queueRootInput: string | undefined,
  options: { now?: number; maxAgeMs?: number; futureSkewMs?: number } = {},
): Promise<DeveloperSandboxWorkerHealth> {
  if (typeof queueRootInput !== "string" || !queueRootInput.trim()) {
    return {
      configured: false,
      healthy: false,
      status: "unconfigured",
      reason: "Developer sandbox queue root is not configured for heartbeat monitoring.",
    };
  }
  const maxAgeMs = options.maxAgeMs ?? 30_000;
  const futureSkewMs = options.futureSkewMs ?? 5_000;
  if (!Number.isInteger(maxAgeMs) || maxAgeMs < 1_000 || maxAgeMs > 5 * 60_000 ||
      !Number.isInteger(futureSkewMs) || futureSkewMs < 0 || futureSkewMs > 30_000) {
    throw new Error("Developer sandbox heartbeat bounds are invalid.");
  }
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now)) throw new Error("Developer sandbox heartbeat clock is invalid.");

  const root = path.resolve(queueRootInput);
  try {
    const rootStat = await fs.lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || await fs.realpath(root) !== root) {
      return { configured: true, healthy: false, status: "invalid", reason: "Developer sandbox queue root is not a regular directory." };
    }
    const file = path.join(root, "worker-status.json");
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4_096) {
      return { configured: true, healthy: false, status: "invalid", reason: "Developer sandbox heartbeat is not a bounded regular file." };
    }
    const raw = await fs.readFile(file, "utf8");
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch { return { configured: true, healthy: false, status: "invalid", reason: "Developer sandbox heartbeat contains invalid JSON." }; }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { configured: true, healthy: false, status: "invalid", reason: "Developer sandbox heartbeat has an invalid shape." };
    }
    const record = value as Partial<WorkerStatusRecord>;
    const startedAt = typeof record.startedAt === "string" ? Date.parse(record.startedAt) : NaN;
    const heartbeatAt = typeof record.heartbeatAt === "string" ? Date.parse(record.heartbeatAt) : NaN;
    if (!["running", "stopping", "stopped"].includes(String(record.status)) ||
        !Number.isSafeInteger(record.pid) || (record.pid ?? 0) <= 0 ||
        !Number.isFinite(startedAt) || !Number.isFinite(heartbeatAt) ||
        startedAt > heartbeatAt || heartbeatAt > now + futureSkewMs) {
      return { configured: true, healthy: false, status: "invalid", reason: "Developer sandbox heartbeat fields failed validation." };
    }
    const ageMs = Math.max(0, now - heartbeatAt);
    if (record.status === "stopping" || record.status === "stopped") {
      return {
        configured: true, healthy: false, status: record.status, pid: record.pid,
        startedAt: record.startedAt, heartbeatAt: record.heartbeatAt, ageMs,
        reason: "Developer sandbox worker is " + record.status + ".",
      };
    }
    if (ageMs > maxAgeMs) {
      return {
        configured: true, healthy: false, status: "stale", pid: record.pid,
        startedAt: record.startedAt, heartbeatAt: record.heartbeatAt, ageMs,
        reason: "Developer sandbox worker heartbeat is stale.",
      };
    }
    return {
      configured: true, healthy: true, status: "healthy", pid: record.pid,
      startedAt: record.startedAt, heartbeatAt: record.heartbeatAt, ageMs,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { configured: true, healthy: false, status: "missing", reason: "Developer sandbox worker heartbeat is missing; start the isolated developer-sandbox service." };
    }
    return {
      configured: true,
      healthy: false,
      status: "invalid",
      reason: error instanceof Error ? "Developer sandbox heartbeat could not be read: " + error.message : "Developer sandbox heartbeat could not be read.",
    };
  }
}
