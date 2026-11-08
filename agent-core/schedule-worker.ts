import { createHash, randomUUID } from "node:crypto";
import type { AgentIdentity } from "./capability-registry.ts";
import type { TaskRepository, TaskOrchestrator } from "./task-orchestrator.ts";
import type { ScheduledJobRepository } from "./scheduled-job-repository.ts";

export interface ScheduleWorkerStatus {
  enabled: boolean; running: boolean; lastCycleAt?: string; lastError?: string;
  enqueued: number; duplicateSkips: number; failed: number;
}
export interface ScheduleWorkerOptions { founderId: string; pollIntervalMs?: number; maxJobsPerCycle?: number; workerId?: string; }
function taskIdFor(scheduleId: string, scheduledAt: string): string {
  return "scheduled-" + createHash("sha256").update(scheduleId + ":" + scheduledAt).digest("hex").slice(0, 24);
}

/**
 * Turns due Founder schedules into idempotently identified, read-only workspace tasks.
 * TaskWorker performs the actual allowlisted execution. This worker never executes files itself.
 */
export class ScheduleWorker {
  private readonly founderId: string;
  private readonly pollIntervalMs: number;
  private readonly maxJobsPerCycle: number;
  private readonly workerId: string;
  private timer?: ReturnType<typeof setTimeout>;
  private cyclePromise?: Promise<{ scanned: number; enqueued: number; duplicateSkips: number; failed: number; busy?: boolean }>;
  private stopped = true;
  private cycleActive = false;
  private status: ScheduleWorkerStatus = { enabled: false, running: false, enqueued: 0, duplicateSkips: 0, failed: 0 };

  constructor(
    private readonly schedules: ScheduledJobRepository,
    private readonly tasks: TaskRepository,
    private readonly orchestrator: TaskOrchestrator,
    options: ScheduleWorkerOptions,
  ) {
    if (!options.founderId.trim()) throw new Error("Schedule worker Founder scope is required.");
    this.founderId = options.founderId;
    this.pollIntervalMs = Math.min(60_000, Math.max(1_000, Number.isFinite(options.pollIntervalMs) ? options.pollIntervalMs! : 3_000));
    this.maxJobsPerCycle = Math.min(50, Math.max(1, Number.isFinite(options.maxJobsPerCycle) ? Math.floor(options.maxJobsPerCycle!) : 10));
    this.workerId = (options.workerId || randomUUID()).slice(0, 128);
  }

  getStatus(): ScheduleWorkerStatus { return { ...this.status, enabled: !this.stopped, running: this.cycleActive }; }
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
    if (this.cyclePromise) { try { await this.cyclePromise; } catch { /* surfaced in status */ } }
  }

  async runOnce(): Promise<{ scanned: number; enqueued: number; duplicateSkips: number; failed: number; busy?: boolean }> {
    if (this.cycleActive) return { scanned: 0, enqueued: 0, duplicateSkips: 0, failed: 0, busy: true };
    this.cycleActive = true;
    const result = { scanned: 0, enqueued: 0, duplicateSkips: 0, failed: 0 };
    this.status = { ...this.status, lastCycleAt: new Date().toISOString(), lastError: undefined };
    try {
      const now = new Date().toISOString();
      const due = await this.schedules.listDue(this.founderId, now, this.maxJobsPerCycle);
      result.scanned = due.length;
      const actor: AgentIdentity = {
        id: "maya-internal-scheduler:" + this.workerId,
        founderId: this.founderId,
        role: "founder",
        scopes: ["workspace:read"],
      };
      for (const job of due) {
        try {
          if (job.founderId !== this.founderId || job.status !== "active") continue;
          const scheduledAt = job.nextRunAt;
          const taskId = taskIdFor(job.id, scheduledAt);
          const existing = await this.tasks.get(taskId, this.founderId);
          if (existing) {
            result.duplicateSkips++;
          } else {
            await this.orchestrator.enqueue({
              id: taskId,
              founderId: this.founderId,
              instruction: `Scheduled read-only job: ${job.title} (scheduled for ${scheduledAt})`,
              capability: "workspace.read_file",
              args: { path: job.path },
              actor,
            });
            result.enqueued++;
          }
          const nextRunAt = job.intervalMs === null ? null : new Date(Date.now() + job.intervalMs).toISOString();
          await this.schedules.markEnqueued(this.founderId, job.id, scheduledAt, nextRunAt);
        } catch (error) {
          result.failed++;
          const message = error instanceof Error ? error.message : String(error);
          this.status = { ...this.status, lastError: message };
          try { await this.schedules.recordFailure(this.founderId, job.id, message); }
          catch (recordError) { this.status = { ...this.status, lastError: "Schedule failure could not be recorded: " + (recordError instanceof Error ? recordError.message : String(recordError)) }; }
        }
      }
      this.status = {
        ...this.status,
        enqueued: this.status.enqueued + result.enqueued,
        duplicateSkips: this.status.duplicateSkips + result.duplicateSkips,
        failed: this.status.failed + result.failed,
      };
      return result;
    } catch (error) {
      this.status = { ...this.status, lastError: error instanceof Error ? error.message : String(error) };
      throw error;
    } finally { this.cycleActive = false; }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.cyclePromise = this.runOnce();
      void this.cyclePromise.catch(error => {
        this.status = { ...this.status, lastError: error instanceof Error ? error.message : String(error) };
      }).finally(() => {
        this.cyclePromise = undefined;
        if (!this.stopped) this.schedule(this.pollIntervalMs);
      });
    }, delayMs);
    this.timer.unref?.();
  }
}
