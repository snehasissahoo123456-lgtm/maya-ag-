import { randomUUID } from "node:crypto";
import type { GoalPlanRepository } from "./goal-plan-repository.ts";
import type { GoalPlanExecutor } from "./goal-plan-executor.ts";

/** Validate the storage guarantees required before enabling the background plan worker. */
export function assertGoalPlanWorkerStorage(repository: GoalPlanRepository, storageDriver = "file"): void {
  const driver = storageDriver.trim().toLowerCase();
  if (driver === "file") return; // File storage is supported only as a single server process.
  if (driver === "supabase" && typeof repository.claimNext === "function" &&
      typeof repository.renewClaim === "function" && typeof repository.releaseClaim === "function") return;
  throw new Error("Background goal-plan worker requires file storage in a single server process, or Supabase storage with atomic claim, lease renewal and release support.");
}

export interface GoalPlanWorkerStatus {
  enabled: boolean;
  running: boolean;
  lastCycleAt?: string;
  lastError?: string;
  resumed: number;
  completed: number;
  awaitingApproval: number;
  recovered: number;
  failed: number;
}

/**
 * Single-process background runner for explicitly started Founder plans.
 * Interrupted in-flight steps are parked as failed for review; they are never replayed.
 * Database-backed workers renew their Founder-scoped lease while a plan executes.
 */
export class GoalPlanWorker {
  private timer?: ReturnType<typeof setTimeout>;
  private cyclePromise?: Promise<{ scanned: number; resumed: number; completed: number; awaitingApproval: number; recovered: number; failed: number; busy?: boolean }>;
  private stopped = true;
  private cycleActive = false;
  private readonly pollIntervalMs: number;
  private readonly maxPlansPerCycle: number;
  private readonly workerId: string;
  private readonly leaseMs: number;
  private status: GoalPlanWorkerStatus = { enabled: false, running: false, resumed: 0, completed: 0, awaitingApproval: 0, recovered: 0, failed: 0 };

  constructor(
    private readonly repository: GoalPlanRepository,
    private readonly executor: GoalPlanExecutor,
    private readonly founderId: string,
    pollIntervalMs = 3000,
    maxPlansPerCycle = 10,
    workerId: string = randomUUID(),
    leaseMs = 60_000,
  ) {
    if (!founderId.trim()) throw new Error("Plan worker Founder scope is required.");
    this.pollIntervalMs = Math.min(60_000, Math.max(1_000, Number.isFinite(pollIntervalMs) ? pollIntervalMs : 3_000));
    this.maxPlansPerCycle = Math.min(50, Math.max(1, Number.isFinite(maxPlansPerCycle) ? Math.floor(maxPlansPerCycle) : 10));
    this.workerId = workerId.slice(0, 128);
    this.leaseMs = Math.min(300_000, Math.max(5_000, Number.isFinite(leaseMs) ? leaseMs : 60_000));
  }

  getStatus(): GoalPlanWorkerStatus { return { ...this.status, enabled: !this.stopped, running: this.cycleActive }; }

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
      try { await this.cyclePromise; } catch { /* visible through status */ }
    }
  }

  async runOnce(): Promise<{ scanned: number; resumed: number; completed: number; awaitingApproval: number; recovered: number; failed: number; busy?: boolean }> {
    if (this.cycleActive) return { scanned: 0, resumed: 0, completed: 0, awaitingApproval: 0, recovered: 0, failed: 0, busy: true };
    this.cycleActive = true;
    const result = { scanned: 0, resumed: 0, completed: 0, awaitingApproval: 0, recovered: 0, failed: 0 };
    this.status = { ...this.status, lastCycleAt: new Date().toISOString(), lastError: undefined };
    try {
      if (this.repository.claimNext && this.repository.releaseClaim && this.repository.renewClaim) {
        // Database-backed repositories use atomic row-lock claims so multiple server
        // instances cannot execute the same goal plan concurrently.
        for (let index = 0; index < this.maxPlansPerCycle; index++) {
          const plan = await this.repository.claimNext(this.founderId, this.workerId, this.leaseMs);
          if (!plan) break;
          result.scanned++;
          let leaseLost = false;
          let renewalInFlight = false;
          const renew = async () => {
            if (leaseLost || renewalInFlight) return;
            renewalInFlight = true;
            try {
              const renewed = await this.repository.renewClaim!(this.founderId, plan.id, this.workerId, this.leaseMs);
              if (!renewed) {
                leaseLost = true;
                this.status = { ...this.status, lastError: "Goal-plan lease was lost; no further steps will be started." };
              }
            } catch (error) {
              leaseLost = true;
              this.status = { ...this.status, lastError: "Goal-plan lease renewal failed; execution will stop after the current tool returns: " + (error instanceof Error ? error.message : String(error)) };
            } finally {
              renewalInFlight = false;
            }
          };
          const heartbeat = setInterval(() => { void renew(); }, Math.max(1_000, Math.floor(this.leaseMs / 3)));
          heartbeat.unref?.();
          try {
            const interrupted = plan.plan.steps.find(step => plan.stepStates[step.id]?.status === "running");
            if (interrupted) {
              const state = plan.stepStates[interrupted.id];
              state.status = "failed";
              state.error = "A previous worker lease expired while this step was in flight. Automatic replay is disabled; create a reviewed replacement plan.";
              plan.status = "failed";
              await this.repository.save(this.founderId, plan);
              result.recovered++;
              continue;
            }
            result.resumed++;
            const assertLease = async () => {
              if (leaseLost) throw new Error("Goal-plan lease was lost; execution stopped before the next step.");
            };
            const updated = await this.executor.execute(this.founderId, plan.id, assertLease);
            if (updated.status === "completed") result.completed++;
            else if (updated.status === "awaiting_approval") result.awaitingApproval++;
          } catch (error) {
            result.failed++;
            this.status = { ...this.status, lastError: error instanceof Error ? error.message : String(error) };
          } finally {
            clearInterval(heartbeat);
            if (!leaseLost) await this.repository.releaseClaim(this.founderId, plan.id, this.workerId);
          }
        }
      } else {
        // File-backed mode remains single-instance and uses a local bounded scan.
        const plans = await this.repository.list(this.founderId);
        for (const plan of plans) {
          if (plan.founderId !== this.founderId || plan.status !== "running") continue;
          const interrupted = plan.plan.steps.find(step => plan.stepStates[step.id]?.status === "running");
          if (!interrupted) continue;
          const state = plan.stepStates[interrupted.id];
          state.status = "failed";
          state.error = "Worker stopped while this step was in flight. Automatic replay is disabled; create a reviewed replacement plan.";
          plan.status = "failed";
          await this.repository.save(this.founderId, plan);
          result.recovered++;
        }
        const runnable = plans.filter(plan => plan.founderId === this.founderId && plan.status === "running" && !plan.plan.steps.some(step => plan.stepStates[step.id]?.status === "running")).slice(0, this.maxPlansPerCycle);
        result.scanned = plans.length;
        for (const plan of runnable) {
          result.resumed++;
          try {
            const updated = await this.executor.execute(this.founderId, plan.id);
            if (updated.status === "completed") result.completed++;
            else if (updated.status === "awaiting_approval") result.awaitingApproval++;
          } catch (error) {
            result.failed++;
            this.status = { ...this.status, lastError: error instanceof Error ? error.message : String(error) };
          }
        }
      }
      this.status = {
        ...this.status,
        resumed: this.status.resumed + result.resumed,
        completed: this.status.completed + result.completed,
        awaitingApproval: this.status.awaitingApproval + result.awaitingApproval,
        recovered: this.status.recovered + result.recovered,
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
