import type { AuditRepository } from "./audit-repository.ts";
import { FileAuditRepository } from "./file-audit-repository.ts";
import { SupabaseAuditRepository } from "./supabase-audit-repository.ts";

export function createAuditRepository(): AuditRepository {
  const driver = (process.env.MAYA_STORAGE_DRIVER || "file").toLowerCase();
  if (driver === "file") return new FileAuditRepository();
  if (driver === "supabase") {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) throw new Error("MAYA_STORAGE_DRIVER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    return new SupabaseAuditRepository(url, serviceRoleKey);
  }
  throw new Error(`Unsupported MAYA_STORAGE_DRIVER: ${driver}`);
}
