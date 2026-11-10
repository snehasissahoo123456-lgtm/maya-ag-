import { GoalPlanStore } from "./goal-plan-store.ts";
import type { GoalPlanRepository } from "./goal-plan-repository.ts";
import { SupabaseGoalPlanStore } from "./supabase-goal-plan-store.ts";

export function createGoalPlanRepository(): GoalPlanRepository {
  const driver = (process.env.MAYA_STORAGE_DRIVER || "file").toLowerCase();
  if (driver === "file") return new GoalPlanStore();
  if (driver === "supabase") {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) throw new Error("MAYA_STORAGE_DRIVER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    return new SupabaseGoalPlanStore(url, serviceRoleKey);
  }
  throw new Error(`Unsupported MAYA_STORAGE_DRIVER: ${driver}`);
}
