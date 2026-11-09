import { ConversationStore } from "./conversation-store.ts";
import { SupabaseConversationStore } from "./supabase-conversation-store.ts";
import type { ConversationStoreAdapter } from "./conversation-store.ts";

/** Select a server-side conversation repository from explicit environment configuration. */
export function createConversationRepository(): ConversationStoreAdapter {
  const driver = (process.env.MAYA_STORAGE_DRIVER || "file").trim().toLowerCase();
  if (driver === "file") return new ConversationStore();
  if (driver === "supabase") {
    if (!process.env.SUPABASE_URL) throw new Error("Supabase storage requires SUPABASE_URL.");
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase storage requires SUPABASE_SERVICE_ROLE_KEY.");
    return new SupabaseConversationStore();
  }
  throw new Error(`Unsupported MAYA_STORAGE_DRIVER "${driver}". Use "file" or "supabase".`);
}
