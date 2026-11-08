export interface PlannerToolContract {
  name: string;
  description: string;
  parametersJsonSchema: {
    type?: string;
    properties?: Record<string, { type?: string; enum?: string[]; maxLength?: number }>;
    required?: string[];
  };
}
export interface GoalPlanStep {
  id: string;
  title: string;
  tool: string;
  args: Record<string, unknown>;
  dependsOn: string[];
  expectedResult: string;
  requiresFounderApproval: boolean;
}
export interface GoalPlan {
  objective: string;
  summary: string;
  executionMode: "plan_only";
  steps: GoalPlanStep[];
}
export class GoalPlanValidationError extends Error {
  constructor(message: string) { super(message); this.name = "GoalPlanValidationError"; }
}

/**
 * Treats model output as untrusted data. Plans are proposals only: this module never
 * invokes tools, changes files, queues work, or treats model text as executable code.
 */
export function validateGoalPlan(
  input: unknown,
  objective: string,
  tools: readonly PlannerToolContract[],
): GoalPlan {
  if (typeof objective !== "string" || !objective.trim() || objective.length > 2000) {
    throw new GoalPlanValidationError("Objective must contain 1–2,000 characters.");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new GoalPlanValidationError("Planner response must be a JSON object.");
  }
  const draft = input as Record<string, unknown>;
  if (typeof draft.summary !== "string" || !draft.summary.trim() || draft.summary.length > 1000) {
    throw new GoalPlanValidationError("Plan summary must contain 1–1,000 characters.");
  }
  if (!Array.isArray(draft.steps) || draft.steps.length < 1 || draft.steps.length > 12) {
    throw new GoalPlanValidationError("A plan must contain between 1 and 12 steps.");
  }
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  const seen = new Set<string>();
  const steps: GoalPlanStep[] = [];

  for (const raw of draft.steps) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new GoalPlanValidationError("Every plan step must be an object.");
    const step = raw as Record<string, unknown>;
    const id = typeof step.id === "string" ? step.id : "";
    const title = typeof step.title === "string" ? step.title.trim() : "";
    const toolName = typeof step.tool === "string" ? step.tool : "";
    const expectedResult = typeof step.expectedResult === "string" ? step.expectedResult.trim() : "";
    if (!/^[a-z][a-z0-9_-]{1,31}$/.test(id) || seen.has(id)) throw new GoalPlanValidationError("Step IDs must be unique, lowercase identifiers.");
    if (!title || title.length > 160 || !expectedResult || expectedResult.length > 500) {
      throw new GoalPlanValidationError("Step title or expected result is missing or too long.");
    }
    const tool = toolMap.get(toolName);
    if (!tool) throw new GoalPlanValidationError(`Plan references unavailable tool: ${toolName || "(empty)"}.`);
    if (!step.args || typeof step.args !== "object" || Array.isArray(step.args)) throw new GoalPlanValidationError("Tool arguments must be an object.");
    const args = step.args as Record<string, unknown>;
    const schema = tool.parametersJsonSchema || {};
    const properties = schema.properties || {};
    const required = schema.required || [];
    for (const key of Object.keys(args)) if (!(key in properties)) throw new GoalPlanValidationError(`Unexpected argument "${key}" for ${toolName}.`);
    for (const key of required) if (args[key] === undefined || args[key] === null) throw new GoalPlanValidationError(`Missing required argument "${key}" for ${toolName}.`);
    for (const [key, value] of Object.entries(args)) {
      const spec = properties[key];
      if (spec?.type && typeof value !== spec.type) throw new GoalPlanValidationError(`Invalid type for argument "${key}".`);
      if (spec?.maxLength && typeof value === "string" && value.length > spec.maxLength) throw new GoalPlanValidationError(`Argument "${key}" is too long.`);
      if (spec?.enum && !spec.enum.includes(String(value))) throw new GoalPlanValidationError(`Invalid enum value for argument "${key}".`);
    }
    const dependsOn = Array.isArray(step.dependsOn) ? step.dependsOn : [];
    for (const dependency of dependsOn) {
      if (typeof dependency !== "string" || !seen.has(dependency)) {
        throw new GoalPlanValidationError("Dependencies must refer only to earlier steps in this plan.");
      }
    }
    seen.add(id);
    steps.push({
      id, title, tool: toolName, args: { ...args }, dependsOn: [...new Set(dependsOn as string[])],
      expectedResult,
      requiresFounderApproval: toolName === "memory_save" || toolName === "schedule_task",
    });
  }
  return { objective: objective.trim(), summary: draft.summary.trim(), executionMode: "plan_only", steps };
}
