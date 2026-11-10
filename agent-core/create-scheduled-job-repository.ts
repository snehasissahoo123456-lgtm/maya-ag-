import { FileScheduledJobRepository } from "./file-scheduled-job-repository.ts";
import type { ScheduledJobRepository } from "./scheduled-job-repository.ts";
import { SupabaseScheduledJobRepository } from "./supabase-scheduled-job-repository.ts";

export function createScheduledJobRepository(): ScheduledJobRepository {
  const driver = (process.env.MAYA_STORAGE_DRIVER || "file").toLowerCase();
  if (driver === "file") return new FileScheduledJobRepository();
  if (driver === "supabase") {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) throw new Error("MAYA_STORAGE_DRIVER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    return new SupabaseScheduledJobRepository(url, serviceRoleKey);
  }
  throw new Error(`Unsupported MAYA_STORAGE_DRIVER: ${driver}`);
}
