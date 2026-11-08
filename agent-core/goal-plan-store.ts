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
export class GoalPlanStore {
  private readonly directory: string;
  private readonly filePath: string;
  constructor(directory = process.env.MAYA_DATA_DIR || path.resolve(process.cwd(), "..", "maya-data")) {
    this.directory = path.resolve(directory);
    this.filePath = path.join(this.directory, "goal-plans.json");
  }
  create(founderId: string, plan: GoalPlan): StoredGoalPlan {
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
  list(founderId: string): StoredGoalPlan[] {
    return this.read().plans.filter((item) => item.founderId === founderId).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(item => structuredClone(item));
  }
  get(founderId: string, id: string): StoredGoalPlan | undefined {
    const item = this.read().plans.find(plan => plan.id === id && plan.founderId === founderId);
    return item ? structuredClone(item) : undefined;
  }
  save(founderId: string, plan: StoredGoalPlan): void {
    const state = this.read();
    const index = state.plans.findIndex(item => item.id === plan.id && item.founderId === founderId);
    if (index < 0) throw new Error("Plan not found for this Founder.");
    plan.updatedAt = new Date().toISOString();
    state.plans[index] = structuredClone(plan);
    this.write(state);
  }
  private read(): PlanFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (parsed?.version !== 1 || !Array.isArray(parsed.plans)) return { version: 1, plans: [] };
      return { version: 1, plans: parsed.plans.filter((item: any) => item && typeof item.id === "string" && typeof item.founderId === "string" && item.plan && item.stepStates) };
    } catch { return { version: 1, plans: [] }; }
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
