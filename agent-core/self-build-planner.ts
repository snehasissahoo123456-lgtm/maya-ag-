import { getAgentManifest } from "./agent-manifests.ts";
import { validateDeveloperPatch } from "./developer-change-control.ts";

export type SelfBuildTaskKind = "implementation" | "test" | "documentation";
export type SelfBuildRisk = "standard" | "elevated";

export interface SelfBuildTask {
  id: string;
  title: string;
  objective: string;
  agentId: string;
  kind: SelfBuildTaskKind;
  files: string[];
  acceptanceCriteria: string[];
  dependsOn: string[];
  risk: SelfBuildRisk;
}

export interface SelfBuildPlan {
  goal: string;
  summary: string;
  baselineCommit: string;
  workspaceId: string;
  tasks: SelfBuildTask[];
  executionMode: "proposal_only";
  requiresFounderApproval: true;
  requiresIndependentQA: true;
  generatedAt: string;
}

export interface SelfBuildPolicy {
  maxTasks: number;
  maxFilesPerTask: number;
  maxTotalFiles: number;
  maxCriteriaPerTask: number;
}

const DEFAULT_POLICY: SelfBuildPolicy = {
  maxTasks: 8,
  maxFilesPerTask: 12,
  maxTotalFiles: 30,
  maxCriteriaPerTask: 8,
};

const NEVER_AUTONOMOUS_PATH = /^(?:\.env(?:\..*)?|\.git(?:\/.*)?|.*(?:^|\/)(?:id_rsa|id_ed25519|credentials?(?:\.json)?|secrets?\.ya?ml|.*\.pem|.*\.key))$/i;
const SECURITY_SURFACE_PATH = /^(?:authService\.ts|server\.ts|local-bridge(?:\.ts)?|agent-core\/(?:approval-ledger|developer-change-control|capability-registry)\.ts|\.github\/workflows\/.*|supabase\/migrations\/.*|Dockerfile|docker-compose\.yml)$/i;
const ID_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/i;

export class SelfBuildPlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelfBuildPlanValidationError";
  }
}

function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new SelfBuildPlanValidationError(field + " must contain 1–" + max + " characters.");
  }
  return value.trim();
}

function assertAcyclic(tasks: readonly SelfBuildTask[]): void {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new SelfBuildPlanValidationError("Task dependencies must not contain a cycle.");
    if (visited.has(id)) return;
    const task = byId.get(id);
    if (!task) throw new SelfBuildPlanValidationError("A task dependency references an unknown task.");
    visiting.add(id);
    for (const dependency of task.dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) visit(task.id);
}

/**
 * Validates model-produced self-build plans as untrusted proposals.
 * This module never applies patches, runs commands, creates approvals, or starts workers.
 */
export function validateSelfBuildPlan(
  input: unknown,
  options: { now?: Date; policy?: Partial<SelfBuildPolicy> } = {},
): SelfBuildPlan {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SelfBuildPlanValidationError("Self-build plan must be a JSON object.");
  }
  const draft = input as Record<string, unknown>;
  const goal = requireText(draft.goal, "Goal", 2000);
  const summary = requireText(draft.summary, "Summary", 1000);
  const baselineCommit = requireText(draft.baselineCommit, "Baseline commit", 40);
  if (!SHA_PATTERN.test(baselineCommit)) throw new SelfBuildPlanValidationError("Baseline commit must be a full 40-character Git SHA.");
  const workspaceId = requireText(draft.workspaceId, "Workspace ID", 120);
  const policy = { ...DEFAULT_POLICY, ...options.policy };
  if (!Array.isArray(draft.tasks) || draft.tasks.length < 1 || draft.tasks.length > policy.maxTasks) {
    throw new SelfBuildPlanValidationError("A self-build plan must contain 1–" + policy.maxTasks + " bounded tasks.");
  }

  const ids = new Set<string>();
  let totalFiles = 0;
  const tasks = draft.tasks.map((raw, index): SelfBuildTask => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new SelfBuildPlanValidationError("Task " + index + " must be an object.");
    }
    const item = raw as Record<string, unknown>;
    const id = requireText(item.id, "Task ID", 48);
    if (!ID_PATTERN.test(id) || ids.has(id)) throw new SelfBuildPlanValidationError("Task IDs must be unique lowercase identifiers.");
    ids.add(id);
    const title = requireText(item.title, "Task title", 160);
    const objective = requireText(item.objective, "Task objective", 2000);
    const agentId = requireText(item.agentId, "Assigned agent", 64);
    const manifest = getAgentManifest(agentId);
    if (!manifest || !["developer", "specialist"].includes(manifest.role)) {
      throw new SelfBuildPlanValidationError("Task assignment must target a registered Developer or specialist agent.");
    }
    if (!["implementation", "test", "documentation"].includes(String(item.kind))) {
      throw new SelfBuildPlanValidationError("Task kind must be implementation, test or documentation.");
    }
    const kind = item.kind as SelfBuildTaskKind;
    if ((kind === "implementation" || kind === "test") && manifest.role !== "developer") {
      throw new SelfBuildPlanValidationError("Only the Developer agent may own implementation and test tasks.");
    }
    if (!Array.isArray(item.files) || item.files.length < 1 || item.files.length > policy.maxFilesPerTask ||
      item.files.some(file => typeof file !== "string")) {
      throw new SelfBuildPlanValidationError("Each task must declare a bounded list of target files.");
    }
    const files = item.files as string[];
    totalFiles += files.length;
    if (totalFiles > policy.maxTotalFiles) throw new SelfBuildPlanValidationError("The plan exceeds the total changed-file budget.");
    if (files.some(file => NEVER_AUTONOMOUS_PATH.test(file))) {
      throw new SelfBuildPlanValidationError("The plan targets a credential or repository-control path that autonomous planning cannot modify.");
    }
    if (files.some(file => SECURITY_SURFACE_PATH.test(file))) {
      throw new SelfBuildPlanValidationError("The plan targets a protected security, runtime, CI or infrastructure surface; use a separate Founder-led security change process.");
    }
    try {
      validateDeveloperPatch({ files, patch: "proposal-only" });
    } catch (error) {
      throw new SelfBuildPlanValidationError(error instanceof Error ? error.message : "Task file list failed validation.");
    }
    if (!Array.isArray(item.acceptanceCriteria) || item.acceptanceCriteria.length < 1 ||
      item.acceptanceCriteria.length > policy.maxCriteriaPerTask) {
      throw new SelfBuildPlanValidationError("Each task needs 1–" + policy.maxCriteriaPerTask + " acceptance criteria.");
    }
    const acceptanceCriteria = item.acceptanceCriteria.map((criterion, criterionIndex) =>
      requireText(criterion, "Acceptance criterion " + criterionIndex, 500));
    if (!Array.isArray(item.dependsOn) || item.dependsOn.length > policy.maxTasks ||
      item.dependsOn.some(dependency => typeof dependency !== "string")) {
      throw new SelfBuildPlanValidationError("Task dependencies must be a bounded list of task IDs.");
    }
    const dependsOn = [...new Set(item.dependsOn as string[])];
    if (dependsOn.length !== item.dependsOn.length || dependsOn.includes(id)) {
      throw new SelfBuildPlanValidationError("Task dependencies must be unique and cannot depend on themselves.");
    }
    const risk = files.some(file => /^(?:package\.json|vite\.config\.ts|tsconfig\.json|.*\.sql|.*\.ps1)$/i.test(file))
      ? "elevated" : "standard";
    return { id, title, objective, agentId, kind, files: [...files], acceptanceCriteria, dependsOn, risk };
  });

  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!ids.has(dependency)) throw new SelfBuildPlanValidationError("A task dependency references an unknown task.");
    }
  }
  assertAcyclic(tasks);
  for (const task of tasks.filter(item => item.kind === "implementation")) {
    const hasDependentTest = tasks.some(candidate => candidate.kind === "test" && candidate.dependsOn.includes(task.id));
    if (!hasDependentTest) {
      throw new SelfBuildPlanValidationError("Every implementation task must have a dependent test task.");
    }
  }

  const now = options.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new SelfBuildPlanValidationError("Self-build plan timestamp must be a valid Date.");
  }
  return {
    goal, summary, baselineCommit: baselineCommit.toLowerCase(), workspaceId, tasks,
    executionMode: "proposal_only",
    requiresFounderApproval: true,
    requiresIndependentQA: true,
    generatedAt: now.toISOString(),
  };
}
