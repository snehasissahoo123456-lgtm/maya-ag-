import { FileCEORunRepository } from "./file-ceo-run-repository.ts";
import type { CEORunRepository } from "./ceo-run-repository.ts";
import { SupabaseCEORunRepository } from "./supabase-ceo-run-repository.ts";

export function createCEORunRepository(): CEORunRepository {
  const driver = (process.env.MAYA_STORAGE_DRIVER || "file").toLowerCase();
  if (driver === "file") return new FileCEORunRepository();
  if (driver === "supabase") {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) throw new Error("MAYA_STORAGE_DRIVER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    return new SupabaseCEORunRepository(url, serviceRoleKey);
  }
  throw new Error(`Unsupported MAYA_STORAGE_DRIVER: ${driver}`);
}
