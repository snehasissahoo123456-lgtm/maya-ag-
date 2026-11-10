import { randomUUID } from "node:crypto";
import type { GoalPlanRepository } from "./goal-plan-repository.ts";
import type { GoalPlan } from "./goal-planner.ts";
import type { StoredGoalPlan, GoalPlanStepState, PlanStatus } from "./goal-plan-store.ts";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
interface PlanRow {
  id: string; founder_id: string; plan: GoalPlan; status: PlanStatus;
  created_at: string; updated_at: string; step_states: Record<string, GoalPlanStepState>;
}
export class SupabaseGoalPlanStore implements GoalPlanRepository {
  private readonly restUrl: string;
  constructor(baseUrl: string, private readonly serviceRoleKey: string, private readonly fetcher: FetchLike = fetch) {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") throw new Error("Supabase URL must use HTTPS outside localhost.");
    if (!serviceRoleKey.trim()) throw new Error("Supabase service-role key is required.");
    this.restUrl = parsed.toString().replace(/\/$/, "") + "/rest/v1";
  }
  async create(founderId: string, plan: GoalPlan): Promise<StoredGoalPlan> {
    if (!founderId) throw new Error("Founder identity is required.");
    const now = new Date().toISOString();
    const stepStates: Record<string, GoalPlanStepState> = {};
    for (const step of plan.steps) stepStates[step.id] = { status: "queued" };
    const stored: StoredGoalPlan = { id: randomUUID(), founderId, plan: structuredClone(plan), status: "proposed", createdAt: now, updatedAt: now, stepStates };
    const rows = await this.request<PlanRow[]>("maya_goal_plans", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ id: stored.id, founder_id: founderId, plan: stored.plan, status: stored.status, created_at: now, updated_at: now, step_states: stepStates }),
    });
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error("Goal plan was not persisted by Supabase.");
    return stored;
  }
  async list(founderId: string): Promise<StoredGoalPlan[]> {
    const query = new URLSearchParams({ select: "id,founder_id,plan,status,created_at,updated_at,step_states", founder_id: `eq.${founderId}`, order: "updated_at.desc", limit: "500" });
    const rows = await this.request<PlanRow[]>(`maya_goal_plans?${query}`);
    return rows.map(row => this.map(row));
  }
  async get(founderId: string, id: string): Promise<StoredGoalPlan | undefined> {
    const query = new URLSearchParams({ select: "id,founder_id,plan,status,created_at,updated_at,step_states", id: `eq.${id}`, founder_id: `eq.${founderId}`, limit: "1" });
    const rows = await this.request<PlanRow[]>(`maya_goal_plans?${query}`);
    return rows[0] ? this.map(rows[0]) : undefined;
  }
  async claimNext(founderId: string, workerId: string, leaseMs: number): Promise<StoredGoalPlan | undefined> {
    if (!founderId || !workerId) throw new Error("Founder and worker identity are required to claim a goal plan.");
    const boundedLease = Math.max(5_000, Math.min(Math.floor(leaseMs), 300_000));
    const rows = await this.request<PlanRow[]>("rpc/maya_claim_next_goal_plan", {
      method: "POST",
      body: JSON.stringify({ p_founder_id: founderId, p_worker_id: workerId, p_lease_ms: boundedLease }),
    });
    if (!Array.isArray(rows) || rows.length === 0) return undefined;
    if (rows.length !== 1 || rows[0].founder_id !== founderId) throw new Error("Supabase returned an invalid goal-plan lease owner.");
    return this.map(rows[0]);
  }
  async releaseClaim(founderId: string, planId: string, workerId: string): Promise<void> {
    const rows = await this.request<Array<{ id: string; founder_id: string }>>("rpc/maya_release_goal_plan_claim", {
      method: "POST",
      body: JSON.stringify({ p_plan_id: planId, p_founder_id: founderId, p_worker_id: workerId }),
    });
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== planId || rows[0].founder_id !== founderId) {
      throw new Error("Goal-plan lease was not released for the owning Founder and worker.");
    }
  }
  async save(founderId: string, plan: StoredGoalPlan): Promise<void> {
    const query = new URLSearchParams({ id: `eq.${plan.id}`, founder_id: `eq.${founderId}`, select: "id" });
    const rows = await this.request<Array<{ id: string }>>(`maya_goal_plans?${query}`, {
      method: "PATCH", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ plan: plan.plan, status: plan.status, updated_at: new Date().toISOString(), step_states: plan.stepStates }),
    });
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error("Plan not found for this Founder or update was not persisted.");
  }
  private map(row: PlanRow): StoredGoalPlan {
    return { id: row.id, founderId: row.founder_id, plan: row.plan, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, stepStates: row.step_states || {} };
  }
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(`${this.restUrl}/${path}`, {
      ...init,
      headers: { apikey: this.serviceRoleKey, Authorization: `Bearer ${this.serviceRoleKey}`, "Content-Type": "application/json", ...(init.headers || {}) },
    });
    if (!response.ok) throw new Error(`Supabase goal-plan storage failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    if (response.status === 204) return undefined as T;
    const body = await response.text();
    return (body ? JSON.parse(body) : undefined) as T;
  }
}
