import { listRunnableSpecialists, type SpecialistResult } from "./specialist-runtime.ts";

export interface SpecialistAssignment { agentId: string; task: string; }
export interface CEODispatchPlan { summary: string; assignments: SpecialistAssignment[]; }
export interface CEOPlannerAdapter {
  plan(input: { objective: string; availableSpecialists: Array<{ id: string; displayName: string; purpose: string }>; context: string }): Promise<string>;
  synthesize(input: { objective: string; findings: SpecialistResult[]; context: string }): Promise<string>;
}
export interface SpecialistRunner {
  run(input: { agentId: string; task: string; context?: string }): Promise<SpecialistResult>;
}
export interface CEOOrchestrationResult {
  objective: string;
  summary: string;
  assignments: SpecialistAssignment[];
  findings: SpecialistResult[];
  executionMode: "multi_specialist_reasoning_only";
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
  constructor(private readonly adapter: CEOPlannerAdapter, private readonly specialists: SpecialistRunner) {}

  async run(input: { objective: string; context?: string }): Promise<CEOOrchestrationResult> {
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
    const findings: SpecialistResult[] = [];
    for (const assignment of dispatch.assignments) {
      findings.push(await this.specialists.run({ ...assignment, context }));
    }
    const summary = await this.adapter.synthesize({ objective, findings, context });
    if (!summary.trim() || summary.length > 16000) throw new Error("CEO synthesis is empty or exceeds the response limit.");
    return {
      objective,
      summary: summary.trim(),
      assignments: dispatch.assignments,
      findings,
      executionMode: "multi_specialist_reasoning_only",
      completedAt: new Date().toISOString(),
    };
  }
}
