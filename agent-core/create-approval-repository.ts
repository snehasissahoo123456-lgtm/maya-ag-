import type { ApprovalRepository } from "./approval-ledger.ts";
import { ApprovalLedger } from "./approval-ledger.ts";
import { SupabaseApprovalLedger } from "./supabase-approval-ledger.ts";
import path from "node:path";

export function createApprovalRepository(): ApprovalRepository {
  const driver = (process.env.MAYA_STORAGE_DRIVER || "file").toLowerCase();
  if (driver === "file") {
    return new ApprovalLedger(path.join(process.env.MAYA_DATA_DIR || path.resolve(process.cwd(), "..", "maya-data"), "approvals.json"));
  }
  if (driver === "supabase") {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) throw new Error("MAYA_STORAGE_DRIVER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    return new SupabaseApprovalLedger(url, serviceRoleKey);
  }
  throw new Error(`Unsupported MAYA_STORAGE_DRIVER: ${driver}`);
}
