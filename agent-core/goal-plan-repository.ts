import type { StoredGoalPlan } from "./goal-plan-store.ts";
import type { GoalPlan } from "./goal-planner.ts";

export interface GoalPlanRepository {
  create(founderId: string, plan: GoalPlan): Promise<StoredGoalPlan>;
  list(founderId: string): Promise<StoredGoalPlan[]>;
  get(founderId: string, id: string): Promise<StoredGoalPlan | undefined>;
  save(founderId: string, plan: StoredGoalPlan): Promise<void>;
}
