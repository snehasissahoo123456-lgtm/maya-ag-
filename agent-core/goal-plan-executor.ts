import { createHash } from "node:crypto";
import { GoalPlanStore, type StoredGoalPlan } from "./goal-plan-store.ts";

export type PlannedToolExecutor = (tool: string, args: Record<string, unknown>) => Promise<unknown>;
function stepDigest(step: StoredGoalPlan["plan"]["steps"][number]): string {
  return createHash("sha256").update(JSON.stringify({ tool: step.tool, args: step.args, dependsOn: step.dependsOn, expectedResult: step.expectedResult })).digest("hex");
}
function digestResult(result: unknown): string {
  let serialized: string;
  try { serialized = JSON.stringify(result) ?? "null"; } catch { serialized = String(result); }
  return createHash("sha256").update(serialized).digest("hex");
}

function requiresApproval(step: StoredGoalPlan["plan"]["steps"][number]): boolean {
  return step.requiresFounderApproval || step.tool === "memory_save" || step.tool === "schedule_task" || step.tool === "run_tests";
}

/**
 * Sequential, resumable plan executor. State-mutating steps pause for a Founder
 * approval bound to the exact step arguments. Tool execution is injected and
 * remains restricted to the server's allowlisted executor.
 */
export class GoalPlanExecutor {
  private readonly executing = new Set<string>();
  constructor(private readonly store: GoalPlanStore, private readonly executeTool: PlannedToolExecutor) {}

  approveStep(founderId: string, planId: string, stepId: string): StoredGoalPlan {
    const plan = this.requirePlan(founderId, planId);
    const step = plan.plan.steps.find(item => item.id === stepId);
    if (!step) throw new Error("Plan step not found.");
    if (!requiresApproval(step)) throw new Error("This step does not require Founder approval.");
    if (plan.stepStates[stepId].status === "completed") throw new Error("Completed steps cannot be re-approved.");
    plan.stepStates[stepId].approvedDigest = stepDigest(step);
    if (plan.status === "proposed" || plan.status === "awaiting_approval") plan.status = "proposed";
    this.store.save(founderId, plan);
    return this.requirePlan(founderId, planId);
  }

  async execute(founderId: string, planId: string): Promise<StoredGoalPlan> {
    if (this.executing.has(planId)) throw new Error("Plan execution is already in progress.");
    this.executing.add(planId);
    try {
      let plan = this.requirePlan(founderId, planId);
      if (plan.status === "completed") return plan;
      if (plan.status === "failed") throw new Error("Failed plans require a new reviewed plan; automatic retry is disabled.");
      plan.status = "running";
      this.store.save(founderId, plan);

      for (const step of plan.plan.steps) {
        plan = this.requirePlan(founderId, planId);
        const state = plan.stepStates[step.id];
        if (state.status === "completed") continue;
        const dependenciesComplete = step.dependsOn.every(id => plan.stepStates[id]?.status === "completed");
        if (!dependenciesComplete) throw new Error("Plan dependency is not completed: " + step.id);
        if (requiresApproval(step) && state.approvedDigest !== stepDigest(step)) {
          state.status = "awaiting_approval";
          plan.status = "awaiting_approval";
          this.store.save(founderId, plan);
          return this.requirePlan(founderId, planId);
        }
        state.status = "running";
        delete state.error;
        this.store.save(founderId, plan);
        try {
          const result = await this.executeTool(step.tool, step.args);
          const serialized = JSON.stringify(result) ?? "null";
          if (serialized.length > 50000) throw new Error("Tool result exceeds the 50 KB plan result limit.");
          state.result = result;
          state.evidence = { sha256: digestResult(result), observedAt: new Date().toISOString() };
          state.status = "completed";
          this.store.save(founderId, plan);
        } catch (error) {
          state.status = "failed";
          state.error = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
          plan.status = "failed";
          this.store.save(founderId, plan);
          return this.requirePlan(founderId, planId);
        }
      }
      plan = this.requirePlan(founderId, planId);
      plan.status = "completed";
      this.store.save(founderId, plan);
      return this.requirePlan(founderId, planId);
    } finally {
      this.executing.delete(planId);
    }
  }

  private requirePlan(founderId: string, planId: string): StoredGoalPlan {
    const plan = this.store.get(founderId, planId);
    if (!plan) throw new Error("Plan not found for this Founder.");
    return plan;
  }
}
