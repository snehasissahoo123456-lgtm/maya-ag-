import { ConversationStore } from "./conversation-store.ts";
import type { ConversationRepository } from "./conversation-repository.ts";
import { SupabaseConversationStore } from "./supabase-conversation-store.ts";

export function createConversationRepository(): ConversationRepository {
  const driver = (process.env.MAYA_STORAGE_DRIVER || "file").toLowerCase();
  if (driver === "file") return new ConversationStore();
  if (driver === "supabase") {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) throw new Error("MAYA_STORAGE_DRIVER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    return new SupabaseConversationStore(url, serviceRoleKey);
  }
  throw new Error(`Unsupported MAYA_STORAGE_DRIVER: ${driver}`);
}
