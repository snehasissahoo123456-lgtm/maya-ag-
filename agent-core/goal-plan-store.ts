import type { GoalPlanRepository } from "./goal-plan-repository.ts";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { GoalPlan } from "./goal-planner.ts";

export type PlanStatus = "proposed" | "running" | "awaiting_approval" | "completed" | "failed";
export type StepStatus = "queued" | "awaiting_approval" | "running" | "completed" | "failed";
export interface GoalPlanStepState {
  status: StepStatus;
  approvedDigest?: string;
  result?: unknown;
  evidence?: { sha256: string; observedAt: string };
  error?: string;
}
export interface StoredGoalPlan {
  id: string;
  founderId: string;
  plan: GoalPlan;
  status: PlanStatus;
  createdAt: string;
  updatedAt: string;
  stepStates: Record<string, GoalPlanStepState>;
}
interface PlanFile { version: 1; plans: StoredGoalPlan[]; }

/** Single-instance durable plan store. Keep its directory outside the source repository. */
export class GoalPlanStore implements GoalPlanRepository {
  private readonly directory: string;
  private readonly filePath: string;
  constructor(directory = process.env.MAYA_DATA_DIR || path.resolve(process.cwd(), "..", "maya-data")) {
    this.directory = path.resolve(directory);
    this.filePath = path.join(this.directory, "goal-plans.json");
  }
  async create(founderId: string, plan: GoalPlan): Promise<StoredGoalPlan> {
    if (!founderId) throw new Error("Founder identity is required.");
    const state = this.read();
    const now = new Date().toISOString();
    const stepStates: Record<string, GoalPlanStepState> = {};
    for (const step of plan.steps) stepStates[step.id] = { status: "queued" };
    const stored: StoredGoalPlan = { id: randomUUID(), founderId, plan: structuredClone(plan), status: "proposed", createdAt: now, updatedAt: now, stepStates };
    state.plans.unshift(stored);
    state.plans = state.plans.slice(0, 500);
    this.write(state);
    return structuredClone(stored);
  }
  async list(founderId: string): Promise<StoredGoalPlan[]> {
    return this.read().plans.filter((item) => item.founderId === founderId).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(item => structuredClone(item));
  }
  async get(founderId: string, id: string): Promise<StoredGoalPlan | undefined> {
    const item = this.read().plans.find(plan => plan.id === id && plan.founderId === founderId);
    return item ? structuredClone(item) : undefined;
  }
  async save(founderId: string, plan: StoredGoalPlan): Promise<void> {
    const state = this.read();
    const index = state.plans.findIndex(item => item.id === plan.id && item.founderId === founderId);
    if (index < 0) throw new Error("Plan not found for this Founder.");
    plan.updatedAt = new Date().toISOString();
    state.plans[index] = structuredClone(plan);
    this.write(state);
  }
  private read(): PlanFile {
    let contents: string;
    try {
      contents = fs.readFileSync(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { version: 1, plans: [] };
      throw new Error("Goal-plan storage is unreadable; refusing to continue without risking Founder plan history.", { cause: error });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch (error) {
      throw new Error("Goal-plan storage contains invalid JSON; refusing to overwrite potentially recoverable Founder plan history.", { cause: error });
    }
    if (!parsed || typeof parsed !== "object" || (parsed as any).version !== 1 || !Array.isArray((parsed as any).plans)) {
      throw new Error("Goal-plan storage has an unsupported or invalid format; refusing to overwrite Founder plan history.");
    }

    const validStatuses = new Set(["proposed", "running", "awaiting_approval", "completed", "failed"]);
    const validStepStatuses = new Set(["queued", "awaiting_approval", "running", "completed", "failed"]);
    for (const item of (parsed as PlanFile).plans) {
      if (!item || typeof item !== "object" ||
          typeof item.id !== "string" || !item.id ||
          typeof item.founderId !== "string" || !item.founderId ||
          !item.plan || typeof item.plan !== "object" || !Array.isArray(item.plan.steps) ||
          !validStatuses.has(item.status) ||
          !Number.isFinite(Date.parse(item.createdAt)) ||
          !Number.isFinite(Date.parse(item.updatedAt)) ||
          !item.stepStates || typeof item.stepStates !== "object" || Array.isArray(item.stepStates)) {
        throw new Error("Goal-plan storage contains a malformed plan record; refusing to discard or overwrite it.");
      }
      for (const [stepId, state] of Object.entries(item.stepStates)) {
        if (!stepId || !state || typeof state !== "object" ||
            !validStepStatuses.has((state as any).status)) {
          throw new Error("Goal-plan storage contains a malformed step state; refusing to discard or overwrite it.");
        }
      }
    }
    return { version: 1, plans: (parsed as PlanFile).plans };
  }
  private write(state: PlanFile): void {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(this.directory, 0o700); } catch {}
    const temp = path.join(this.directory, `.goal-plans.${process.pid}.${randomUUID()}.tmp`);
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
    try { fs.renameSync(temp, this.filePath); }
    catch (error) { try { fs.rmSync(temp, { force: true }); } catch {} throw error; }
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
  }
}
