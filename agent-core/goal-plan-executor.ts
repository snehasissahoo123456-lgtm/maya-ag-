import { createHash } from "node:crypto";
import type { GoalPlanRepository } from "./goal-plan-repository.ts";
import type { StoredGoalPlan } from "./goal-plan-store.ts";
import { createTask, transitionTask } from "./task-lifecycle.ts";
import type { TaskEnvelope, TaskRepository } from "./task-orchestrator.ts";

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
  constructor(
    private readonly store: GoalPlanRepository,
    private readonly executeTool: PlannedToolExecutor,
    private readonly taskRepository?: TaskRepository,
  ) {}

  async start(founderId: string, planId: string): Promise<StoredGoalPlan> {
    const plan = await this.requirePlan(founderId, planId);
    if (plan.status === "completed" || plan.status === "failed") throw new Error("Terminal plans cannot be started again.");
    plan.status = "running";
    await this.store.save(founderId, plan);
    return await this.requirePlan(founderId, planId);
  }

  async approveStep(founderId: string, planId: string, stepId: string): Promise<StoredGoalPlan> {
    const plan = await this.requirePlan(founderId, planId);
    const step = plan.plan.steps.find(item => item.id === stepId);
    if (!step) throw new Error("Plan step not found.");
    if (!requiresApproval(step)) throw new Error("This step does not require Founder approval.");
    if (plan.status !== "awaiting_approval" || plan.stepStates[stepId]?.status !== "awaiting_approval") throw new Error("Only the exact step currently awaiting Founder approval can be approved.");
    plan.stepStates[stepId].approvedDigest = stepDigest(step);
    if (plan.status === "awaiting_approval") plan.status = "running";
    await this.store.save(founderId, plan);
    const task = await this.getStepTask(founderId, plan, step);
    if (task?.task.status === "awaiting_approval") {
      // The parent plan's exact-step digest is the approval authority. Park the
      // child ledger record outside the generic queued-task worker until the plan
      // worker resumes it.
      task.task = transitionTask(task.task, "paused");
      await this.taskRepository!.put(task);
    }
    return await this.requirePlan(founderId, planId);
  }

  async execute(founderId: string, planId: string, beforeStep?: () => Promise<void>): Promise<StoredGoalPlan> {
    if (this.executing.has(planId)) throw new Error("Plan execution is already in progress.");
    this.executing.add(planId);
    try {
      let plan = await this.requirePlan(founderId, planId);
      if (plan.status === "completed") return plan;
      if (plan.status === "failed") throw new Error("Failed plans require a new reviewed plan; automatic retry is disabled.");
      plan.status = "running";
      await this.store.save(founderId, plan);

      for (const step of plan.plan.steps) {
        await beforeStep?.();
        plan = await this.requirePlan(founderId, planId);
        const state = plan.stepStates[step.id];
        if (state.status === "completed") continue;
        const dependenciesComplete = step.dependsOn.every(id => plan.stepStates[id]?.status === "completed");
        if (!dependenciesComplete) throw new Error("Plan dependency is not completed: " + step.id);
        const stepTask = await this.ensureStepTask(founderId, plan, step);
        if (requiresApproval(step) && state.approvedDigest !== stepDigest(step)) {
          state.status = "awaiting_approval";
          plan.status = "awaiting_approval";
          await this.store.save(founderId, plan);
          if (stepTask && stepTask.task.status !== "awaiting_approval") {
            if (stepTask.task.status === "queued") stepTask.task = transitionTask(stepTask.task, "planning");
            if (stepTask.task.status === "planning") stepTask.task = transitionTask(stepTask.task, "awaiting_approval");
            await this.taskRepository!.put(stepTask);
          }
          return await this.requirePlan(founderId, planId);
        }
        state.status = "running";
        delete state.error;
        await this.store.save(founderId, plan);
        if (stepTask) {
          if (stepTask.task.status === "queued") stepTask.task = transitionTask(stepTask.task, "planning");
          if (stepTask.task.status === "paused" || stepTask.task.status === "planning") stepTask.task = transitionTask(stepTask.task, "running");
          if (stepTask.task.status !== "running") throw new Error("Goal-plan step task is not in a runnable state.");
          stepTask.attempts += 1;
          await this.taskRepository!.put(stepTask);
        }
        let result: unknown;
        try {
          result = await this.executeTool(step.tool, step.args);
        } catch (error) {
          state.status = "failed";
          state.error = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
          plan.status = "failed";
          await this.store.save(founderId, plan);
          if (stepTask) {
            stepTask.task = transitionTask(stepTask.task, "failed", { error: state.error });
            await this.taskRepository!.put(stepTask);
          }
          return this.requirePlan(founderId, planId);
        }
        // Lease checks are deliberately outside the tool-error handler. If a worker
        // loses its claim after the side effect, park the child task for manual recovery.
        try {
          await beforeStep?.();
        } catch (error) {
          if (stepTask && stepTask.task.status === "running") {
            stepTask.task = transitionTask(stepTask.task, "requires_recovery", {
              error: "The plan lease was lost after tool execution; verify the side effect before retrying.",
            });
            await this.taskRepository!.put(stepTask);
          }
          throw error;
        }
        try {
          const serialized = JSON.stringify(result) ?? "null";
          if (serialized.length > 50000) throw new Error("Tool result exceeds the 50 KB plan result limit.");
          state.result = result;
          state.evidence = { sha256: digestResult(result), observedAt: new Date().toISOString() };
          if (stepTask) {
            stepTask.result = { sha256: state.evidence.sha256, observedAt: state.evidence.observedAt };
            stepTask.task = transitionTask(stepTask.task, "verifying", {
              evidence: {
                kind: "goal-plan-step-result-sha256",
                description: "The goal-plan step tool returned successfully and its result digest was recorded.",
                reference: "sha256:" + state.evidence.sha256,
                observedAt: state.evidence.observedAt,
              },
            });
            await this.taskRepository!.put(stepTask);
          }
          state.status = "completed";
          await this.store.save(founderId, plan);
          if (stepTask) {
            stepTask.task = transitionTask(stepTask.task, "completed", {
              evidence: {
                kind: "goal-plan-step-result-sha256",
                description: "The goal-plan step completed and its result digest is linked to the parent plan.",
                reference: "sha256:" + state.evidence.sha256,
                observedAt: state.evidence.observedAt,
              },
            });
            await this.taskRepository!.put(stepTask);
          }
        } catch (error) {
          state.status = "failed";
          state.error = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
          plan.status = "failed";
          await this.store.save(founderId, plan);
          if (stepTask && ["running", "verifying"].includes(stepTask.task.status)) {
            stepTask.task = transitionTask(stepTask.task, "requires_recovery", {
              error: "Tool execution returned but durable result recording failed; verify the side effect before retrying.",
            });
            await this.taskRepository!.put(stepTask);
          }
          return this.requirePlan(founderId, planId);
        }
      }
      await beforeStep?.();
      plan = await this.requirePlan(founderId, planId);
      plan.status = "completed";
      await this.store.save(founderId, plan);
      return await this.requirePlan(founderId, planId);
    } finally {
      this.executing.delete(planId);
    }
  }

  private async ensureStepTask(founderId: string, plan: StoredGoalPlan, step: StoredGoalPlan["plan"]["steps"][number]): Promise<TaskEnvelope | undefined> {
    if (!this.taskRepository) return undefined;
    const existing = await this.getStepTask(founderId, plan, step);
    if (existing) return existing;
    const id = "goal-step-" + createHash("sha256").update(founderId + ":" + plan.id + ":" + step.id).digest("hex").slice(0, 32);
    const envelope: TaskEnvelope = {
      task: createTask({
        id,
        founderId,
        instruction: "Goal plan " + plan.id + ": " + step.title,
        riskLevel: "medium",
        // Approval is governed by the parent plan's exact-step digest. This child
        // ledger item is never independently queued for generic task execution.
        requiresApproval: false,
      }),
      capability: "goal_plan.step",
      args: { planId: plan.id, stepId: step.id, tool: step.tool },
      attempts: 0,
      idempotencyKey: id,
    };
    await this.taskRepository.put(envelope);
    plan.stepStates[step.id].taskId = id;
    await this.store.save(founderId, plan);
    return envelope;
  }

  private async getStepTask(founderId: string, plan: StoredGoalPlan, step: StoredGoalPlan["plan"]["steps"][number]): Promise<TaskEnvelope | undefined> {
    if (!this.taskRepository) return undefined;
    const id = plan.stepStates[step.id]?.taskId;
    if (!id) return undefined;
    const envelope = await this.taskRepository.get(id, founderId);
    if (!envelope || envelope.capability !== "goal_plan.step" ||
        envelope.args.planId !== plan.id || envelope.args.stepId !== step.id) {
      throw new Error("Goal-plan child task linkage is missing or does not match its parent step.");
    }
    return envelope;
  }

  private async requirePlan(founderId: string, planId: string): Promise<StoredGoalPlan> {
    const plan = await this.store.get(founderId, planId);
    if (!plan) throw new Error("Plan not found for this Founder.");
    return plan;
  }
}
