import { FileTaskRepository } from "./file-task-repository.ts";
import type { TaskRepository } from "./task-orchestrator.ts";
import { SupabaseTaskRepository } from "./supabase-task-repository.ts";

export function createTaskRepository(): TaskRepository {
  const driver = (process.env.MAYA_STORAGE_DRIVER || "file").toLowerCase();
  if (driver === "file") return new FileTaskRepository();
  if (driver === "supabase") {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) throw new Error("MAYA_STORAGE_DRIVER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    return new SupabaseTaskRepository(url, serviceRoleKey);
  }
  throw new Error(`Unsupported MAYA_STORAGE_DRIVER: ${driver}`);
}
