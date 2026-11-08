import type { GoalPlanRepository } from "./goal-plan-repository.ts";
import type { GoalPlanExecutor } from "./goal-plan-executor.ts";

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
 * Do not enable alongside multiple server instances until distributed plan leases exist.
 */
export class GoalPlanWorker {
  private timer?: ReturnType<typeof setTimeout>;
  private cyclePromise?: Promise<{ scanned: number; resumed: number; completed: number; awaitingApproval: number; recovered: number; failed: number; busy?: boolean }>;
  private stopped = true;
  private cycleActive = false;
  private readonly pollIntervalMs: number;
  private readonly maxPlansPerCycle: number;
  private status: GoalPlanWorkerStatus = { enabled: false, running: false, resumed: 0, completed: 0, awaitingApproval: 0, recovered: 0, failed: 0 };

  constructor(
    private readonly repository: GoalPlanRepository,
    private readonly executor: GoalPlanExecutor,
    private readonly founderId: string,
    pollIntervalMs = 3000,
    maxPlansPerCycle = 10,
  ) {
    if (!founderId.trim()) throw new Error("Plan worker Founder scope is required.");
    this.pollIntervalMs = Math.min(60_000, Math.max(1_000, Number.isFinite(pollIntervalMs) ? pollIntervalMs : 3_000));
    this.maxPlansPerCycle = Math.min(50, Math.max(1, Number.isFinite(maxPlansPerCycle) ? Math.floor(maxPlansPerCycle) : 10));
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
      const plans = await this.repository.list(this.founderId);
      // Recover a step that was marked running when the previous process stopped.
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
