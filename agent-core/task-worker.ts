import { randomUUID } from "node:crypto";
import { transitionTask } from "./task-lifecycle.ts";
import type { CapabilityRegistry, AgentIdentity } from "./capability-registry.ts";
import { digestAction, type ApprovalRepository } from "./approval-ledger.ts";
import type { TaskEnvelope, TaskOrchestrator, TaskRepository } from "./task-orchestrator.ts";

export interface TaskWorkerStatus {
  enabled: boolean;
  running: boolean;
  lastCycleAt?: string;
  lastError?: string;
  executed: number;
  skipped: number;
  failed: number;
}

export interface TaskWorkerOptions {
  founderId: string;
  pollIntervalMs?: number;
  workerId?: string;
  leaseMs?: number;
  maxTasksPerCycle?: number;
}

/**
 * Opt-in worker for safe workspace reads plus exact-Founder-approved server and local-device file replacements.
 * Unknown, unapproved, failed and interrupted work is never broadened or auto-replayed.
 */
export class TaskWorker {
  private readonly founderId: string;
  private readonly pollIntervalMs: number;
  private readonly workerId: string;
  private readonly leaseMs: number;
  private readonly maxTasksPerCycle: number;
  private timer?: ReturnType<typeof setTimeout>;
  private cyclePromise?: Promise<{ scanned: number; executed: number; skipped: number; failed: number; busy?: boolean }>;
  private stopped = true;
  private cycleActive = false;
  private readonly blockedTaskIds = new Set<string>();
  private startupRecoveryDone = false;
  private status: TaskWorkerStatus = { enabled: false, running: false, executed: 0, skipped: 0, failed: 0 };

  constructor(
    private readonly repository: TaskRepository,
    private readonly orchestrator: TaskOrchestrator,
    private readonly capabilities: CapabilityRegistry,
    options: TaskWorkerOptions,
    private readonly approvals?: ApprovalRepository,
  ) {
    if (!options.founderId.trim()) throw new Error("Worker Founder scope is required.");
    this.founderId = options.founderId;
    this.workerId = (options.workerId || randomUUID()).slice(0, 128);
    const requestedLease = Number.isFinite(options.leaseMs) ? options.leaseMs! : 60_000;
    const requestedMaxTasks = Number.isFinite(options.maxTasksPerCycle) ? Math.floor(options.maxTasksPerCycle!) : 20;
    this.leaseMs = Math.min(300_000, Math.max(5_000, requestedLease));
    this.maxTasksPerCycle = Math.min(100, Math.max(1, requestedMaxTasks));
    const requestedInterval = Number.isFinite(options.pollIntervalMs) ? options.pollIntervalMs! : 3000;
    this.pollIntervalMs = Math.min(60_000, Math.max(1_000, requestedInterval));
  }

  getStatus(): TaskWorkerStatus {
    return { ...this.status, enabled: !this.stopped, running: this.cycleActive };
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.status = { ...this.status, enabled: true, lastError: undefined };
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.status = { ...this.status, enabled: false };
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.cyclePromise) {
      try { await this.cyclePromise; } catch { /* surfaced through status */ }
    }
  }

  private async executeAllowed(envelope: TaskEnvelope): Promise<"executed" | "skipped"> {
    if (envelope.task.founderId !== this.founderId) return "skipped";
    const isRead = envelope.capability === "workspace.read_file";
    const isWorkspaceWrite = envelope.capability === "workspace.write_file";
    const isDeviceWrite = envelope.capability === "device.workspace.write_file";
    const isApprovedWrite = isWorkspaceWrite || isDeviceWrite;
    if (!isRead && !isApprovedWrite) return "skipped";
    if (isRead && envelope.task.requiresApproval) return "skipped";
    if (isApprovedWrite && (!envelope.task.requiresApproval || !this.approvals)) return "skipped";

    const actor: AgentIdentity = {
      id: "maya-internal-task-worker:" + this.workerId,
      founderId: this.founderId,
      role: "worker",
      scopes: isWorkspaceWrite ? ["workspace:read", "workspace:write"] : isDeviceWrite ? ["device:write"] : ["workspace:read"],
    };
    const { definition } = this.capabilities.validate(envelope.capability, actor, envelope.args);
    if (!definition.allowedRoles.includes("worker")) return "skipped";
    let approvalId: string | undefined;
    if (isApprovedWrite) {
      if (definition.risk !== "high" || !definition.requiresApproval) return "skipped";
      const expectedDigest = digestAction(envelope.capability, envelope.args);
      const grant = (await this.approvals!.listForFounder(this.founderId)).find(item =>
        item.status === "approved" && item.taskId === envelope.task.id &&
        item.capability === envelope.capability && item.actionDigest === expectedDigest &&
        Date.parse(item.expiresAt) > Date.now());
      if (!grant) return "skipped";
      approvalId = grant.id;
    } else if (definition.risk !== "low" || definition.requiresApproval) {
      return "skipped";
    }
    await this.orchestrator.execute(envelope.task.id, actor, approvalId);
    return "executed";
  }

  async runOnce(): Promise<{ scanned: number; executed: number; skipped: number; failed: number; busy?: boolean }> {
    if (this.cycleActive) return { scanned: 0, executed: 0, skipped: 0, failed: 0, busy: true };
    this.cycleActive = true;
    const result = { scanned: 0, executed: 0, skipped: 0, failed: 0 };
    this.status = { ...this.status, lastCycleAt: new Date().toISOString(), lastError: undefined };
    try {
      if (this.repository.claimNext && this.repository.releaseClaim) {
        await this.repository.recoverExpiredClaims?.(this.founderId);
        for (let index = 0; index < this.maxTasksPerCycle; index++) {
          const envelope = await this.repository.claimNext(this.founderId, this.workerId, this.leaseMs);
          if (!envelope) break;
          result.scanned++;
          try {
            if (envelope.task.founderId !== this.founderId || envelope.task.status !== "queued" || this.blockedTaskIds.has(envelope.task.id)) {
              result.skipped++;
              continue;
            }
            const outcome = await this.executeAllowed(envelope);
            if (outcome === "executed") result.executed++;
            else result.skipped++;
          } catch (error) {
            this.blockedTaskIds.add(envelope.task.id);
            result.failed++;
            this.status = { ...this.status, lastError: error instanceof Error ? error.message : String(error) };
          } finally {
            try {
              await this.repository.releaseClaim(envelope.task.id, this.founderId, this.workerId);
            } catch (error) {
              this.status = { ...this.status, lastError: "Task lease release failed: " + (error instanceof Error ? error.message : String(error)) };
            }
          }
        }
      } else {
        const envelopes = await this.repository.list(this.founderId);
        result.scanned = envelopes.length;
        if (!this.startupRecoveryDone) {
          for (const envelope of envelopes) {
            if (envelope.task.founderId !== this.founderId || !["running", "verifying"].includes(envelope.task.status)) continue;
            if (this.orchestrator.isExecuting(envelope.task.id)) continue;
            envelope.task = transitionTask(envelope.task, "requires_recovery", {
              error: "Task was interrupted by a previous worker process. Verify any side effects before creating a replacement task.",
            });
            await this.repository.put(envelope);
            result.skipped++;
          }
          this.startupRecoveryDone = true;
        }
        for (const envelope of envelopes) {
          if (envelope.task.founderId !== this.founderId || envelope.task.status !== "queued") continue;
          if (this.blockedTaskIds.has(envelope.task.id)) { result.skipped++; continue; }
          try {
            const outcome = await this.executeAllowed(envelope);
            if (outcome === "executed") result.executed++;
            else result.skipped++;
          } catch (error) {
            this.blockedTaskIds.add(envelope.task.id);
            result.failed++;
            this.status = { ...this.status, lastError: error instanceof Error ? error.message : String(error) };
          }
        }
      }
      this.status = {
        ...this.status,
        executed: this.status.executed + result.executed,
        skipped: this.status.skipped + result.skipped,
        failed: this.status.failed + result.failed,
      };
      return result;
    } catch (error) {
      this.status = { ...this.status, lastError: error instanceof Error ? error.message : String(error) };
      throw error;
    } finally {
      this.cycleActive = false;
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.cyclePromise = this.runOnce();
      void this.cyclePromise
        .catch((error) => {
          this.status = { ...this.status, lastError: error instanceof Error ? error.message : String(error) };
        })
        .finally(() => {
          this.cyclePromise = undefined;
          if (!this.stopped) this.schedule(this.pollIntervalMs);
        });
    }, delayMs);
    this.timer.unref?.();
  }
}
