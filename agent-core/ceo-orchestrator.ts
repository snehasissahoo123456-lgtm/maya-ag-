import { createHash, randomUUID } from "node:crypto";
import { createTask, transitionTask } from "./task-lifecycle.ts";
import type { TaskEnvelope, TaskRepository } from "./task-orchestrator.ts";
import { listRunnableSpecialists, type SpecialistResult } from "./specialist-runtime.ts";

export interface SpecialistAssignment { agentId: string; task: string; taskId?: string; }
export interface CEODispatchPlan { summary: string; assignments: SpecialistAssignment[]; }
export interface CEOPlannerAdapter {
  plan(input: { objective: string; availableSpecialists: Array<{ id: string; displayName: string; purpose: string }>; context: string }): Promise<string>;
  synthesize(input: { objective: string; findings: SpecialistResult[]; context: string }): Promise<string>;
}
export interface SpecialistRunner {
  run(input: { agentId: string; task: string; context?: string; founderId?: string }): Promise<SpecialistResult>;
}
export interface CEOOrchestrationResult {
  objective: string;
  summary: string;
  assignments: SpecialistAssignment[];
  findings: SpecialistResult[];
  executionMode: "multi_specialist_reasoning_only" | "multi_specialist_bounded_read_only";
  completedAt: string;
}
export class CEOPlanValidationError extends Error {
  constructor(message: string) { super(message); this.name = "CEOPlanValidationError"; }
}

export function validateCEODispatchPlan(input: unknown, objective: string): CEODispatchPlan {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new CEOPlanValidationError("CEO dispatch must be a JSON object.");
  const draft = input as Record<string, unknown>;
  if (typeof draft.summary !== "string" || !draft.summary.trim() || draft.summary.length > 1000) throw new CEOPlanValidationError("CEO dispatch summary is missing or too long.");
  if (!Array.isArray(draft.assignments) || draft.assignments.length < 1 || draft.assignments.length > 4) throw new CEOPlanValidationError("CEO must assign between 1 and 4 specialists.");
  const available = new Set(listRunnableSpecialists().filter(agent => agent.id !== "ceo").map(agent => agent.id));
  const seen = new Set<string>();
  const assignments = draft.assignments.map((raw): SpecialistAssignment => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CEOPlanValidationError("Each assignment must be an object.");
    const item = raw as Record<string, unknown>;
    const agentId = typeof item.agentId === "string" ? item.agentId : "";
    const task = typeof item.task === "string" ? item.task.trim() : "";
    if (!available.has(agentId)) throw new CEOPlanValidationError("CEO selected an unavailable or non-delegable specialist.");
    if (seen.has(agentId)) throw new CEOPlanValidationError("A specialist can only be assigned once per orchestration.");
    if (!task || task.length > 2000) throw new CEOPlanValidationError("Each specialist task must contain 1–2,000 characters.");
    seen.add(agentId);
    return { agentId, task };
  });
  if (typeof objective !== "string" || !objective.trim() || objective.length > 2000) throw new CEOPlanValidationError("Objective must contain 1–2,000 characters.");
  return { summary: draft.summary.trim(), assignments };
}

/** Bounded sequential orchestration. Specialists are reasoning-only and cannot spawn agents or execute tools. */
export class CEOOrchestrator {
  constructor(
    private readonly adapter: CEOPlannerAdapter,
    private readonly specialists: SpecialistRunner,
    private readonly taskRepository?: TaskRepository,
  ) {}

  async run(input: { objective: string; context?: string; founderId?: string; runId?: string }): Promise<CEOOrchestrationResult> {
    const objective = input.objective?.trim() || "";
    if (!objective || objective.length > 2000) throw new Error("Objective must contain 1–2,000 characters.");
    const context = typeof input.context === "string" ? input.context.slice(0, 8000) : "";
    const availableSpecialists = listRunnableSpecialists()
      .filter(agent => agent.id !== "ceo")
      .map(({ id, displayName, purpose }) => ({ id, displayName, purpose }));
    const rawPlan = await this.adapter.plan({ objective, availableSpecialists, context });
    let parsed: unknown;
    try { parsed = JSON.parse(rawPlan); }
    catch { throw new CEOPlanValidationError("CEO returned invalid dispatch JSON; no specialist was started."); }
    const dispatch = validateCEODispatchPlan(parsed, objective);
    const runId = input.runId?.trim() || randomUUID();
    // Every dispatched specialist receives a durable task-ledger record before
    // it starts. "planning" is intentional: generic queued-task workers cannot
    // claim CEO-owned work, and only this bounded orchestrator can advance it.
    const tracked = input.founderId && this.taskRepository;
    const assignments = tracked
      ? dispatch.assignments.map(assignment => ({
          ...assignment,
          taskId: "ceo-step-" + createHash("sha256").update(input.founderId + ":" + runId + ":" + assignment.agentId).digest("hex").slice(0, 32),
        }))
      : dispatch.assignments;
    // Dispatch the bounded (maximum four) specialist set concurrently. Persist
    // each lifecycle transition so Founder task history reflects actual work.
    const findings = await Promise.all(assignments.map(async assignment => {
      let envelope: TaskEnvelope | undefined;
      if (tracked) {
        const task = transitionTask(createTask({
          id: assignment.taskId!,
          founderId: input.founderId!,
          instruction: "CEO specialist assignment (" + assignment.agentId + "): " + assignment.task,
          riskLevel: "medium",
          requiresApproval: false,
        }), "planning");
        envelope = {
          task,
          capability: "ceo.specialist.run",
          args: { runId, agentId: assignment.agentId, task: assignment.task },
          attempts: 0,
          idempotencyKey: assignment.taskId!,
        };
        await this.taskRepository!.put(envelope);
        envelope.task = transitionTask(envelope.task, "running");
        envelope.attempts += 1;
        await this.taskRepository!.put(envelope);
      }
      try {
        const finding = await this.specialists.run({ agentId: assignment.agentId, task: assignment.task, context, founderId: input.founderId });
        if (envelope) {
          const observedAt = finding.completedAt || new Date().toISOString();
          const digest = createHash("sha256").update(finding.output).digest("hex");
          envelope.result = { sha256: digest, observedAt };
          envelope.task = transitionTask(envelope.task, "verifying");
          await this.taskRepository!.put(envelope);
          envelope.task = transitionTask(envelope.task, "completed", {
            evidence: {
              kind: "ceo-specialist-output-sha256",
              description: "The specialist returned a non-empty result; its output digest is recorded in the task ledger.",
              reference: "sha256:" + digest,
              observedAt,
            },
          });
          await this.taskRepository!.put(envelope);
        }
        return finding;
      } catch (error) {
        if (envelope && ["planning", "running"].includes(envelope.task.status)) {
          envelope.task = transitionTask(envelope.task, "failed", {
            error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
          });
          await this.taskRepository!.put(envelope);
        } else if (envelope?.task.status === "verifying") {
          envelope.task = transitionTask(envelope.task, "requires_recovery", {
            error: "Specialist output was returned but its completion record could not be durably confirmed. Review the CEO run before retrying.",
          });
          await this.taskRepository!.put(envelope);
        }
        throw error;
      }
    }));
    const summary = await this.adapter.synthesize({ objective, findings, context });
    if (!summary.trim() || summary.length > 16000) throw new Error("CEO synthesis is empty or exceeds the response limit.");
    return {
      objective,
      summary: summary.trim(),
      assignments,
      findings,
      executionMode: findings.some(item => item.executionMode === "bounded_read_only_tools") ? "multi_specialist_bounded_read_only" : "multi_specialist_reasoning_only",
      completedAt: new Date().toISOString(),
    };
  }
}
