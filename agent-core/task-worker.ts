import { randomUUID } from "node:crypto";
import type { CapabilityRegistry, AgentIdentity } from "./capability-registry.ts";
import type { TaskOrchestrator, TaskRepository } from "./task-orchestrator.ts";

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
 * Single-process, opt-in worker for the one currently safe capability.
 * Failed work is not retried, and interrupted tasks remain parked for review.
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
  private status: TaskWorkerStatus = { enabled: false, running: false, executed: 0, skipped: 0, failed: 0 };

  constructor(
    private readonly repository: TaskRepository,
    private readonly orchestrator: TaskOrchestrator,
    private readonly capabilities: CapabilityRegistry,
    options: TaskWorkerOptions,
  ) {
    if (!options.founderId.trim()) throw new Error("Worker Founder scope is required.");
    this.founderId = options.founderId;
    this.workerId = (options.workerId || randomUUID()).slice(0, 128);
    this.leaseMs = Math.min(300_000, Math.max(5_000, options.leaseMs ?? 60_000));
    this.maxTasksPerCycle = Math.min(100, Math.max(1, Math.floor(options.maxTasksPerCycle ?? 20)));
    const requestedInterval = options.pollIntervalMs ?? 3000;
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
            if (envelope.task.founderId !== this.founderId || envelope.task.status !== "queued" ||
                this.blockedTaskIds.has(envelope.task.id) || envelope.capability !== "workspace.read_file" ||
                envelope.task.requiresApproval) {
              result.skipped++;
              continue;
            }
            const actor: AgentIdentity = {
              id: "maya-internal-task-worker:" + this.workerId,
              founderId: this.founderId,
              role: "worker",
              scopes: ["workspace:read"],
            };
            const { definition } = this.capabilities.validate(envelope.capability, actor, envelope.args);
            if (definition.risk !== "low" || definition.requiresApproval || !definition.allowedRoles.includes("worker")) {
              result.skipped++;
              continue;
            }
            await this.orchestrator.execute(envelope.task.id, actor);
            result.executed++;
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
        for (const envelope of envelopes) {
          if (envelope.task.founderId !== this.founderId || envelope.task.status !== "queued") continue;
          if (this.blockedTaskIds.has(envelope.task.id)) { result.skipped++; continue; }
          if (envelope.capability !== "workspace.read_file" || envelope.task.requiresApproval) {
            result.skipped++;
            continue;
          }
          const actor: AgentIdentity = {
            id: "maya-internal-task-worker",
            founderId: this.founderId,
            role: "worker",
            scopes: ["workspace:read"],
          };
          try {
            const { definition } = this.capabilities.validate(envelope.capability, actor, envelope.args);
            if (definition.risk !== "low" || definition.requiresApproval || !definition.allowedRoles.includes("worker")) {
              result.skipped++;
              continue;
            }
            await this.orchestrator.execute(envelope.task.id, actor);
            result.executed++;
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
