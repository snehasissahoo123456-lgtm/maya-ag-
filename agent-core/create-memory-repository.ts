import type { MemoryEntry } from "../actionEngineCore.ts";
import type { MemoryRepository } from "./memory-repository.ts";
import { FileMemoryRepository } from "./file-memory-repository.ts";
import { SupabaseMemoryRepository, type MemoryEmbeddingProvider } from "./supabase-memory-repository.ts";

export function createMemoryRepository(initialMemories: MemoryEntry[], persist: (memories: MemoryEntry[]) => void, embed?: MemoryEmbeddingProvider): MemoryRepository {
  const driver = (process.env.MAYA_STORAGE_DRIVER || "file").toLowerCase();
  if (driver === "file") return new FileMemoryRepository(initialMemories, persist);
  if (driver === "supabase") {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) throw new Error("MAYA_STORAGE_DRIVER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    return new SupabaseMemoryRepository(url, serviceRoleKey, initialMemories, embed);
  }
  throw new Error(`Unsupported MAYA_STORAGE_DRIVER: ${driver}`);
}
