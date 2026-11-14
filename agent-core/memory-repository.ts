import type { MemoryEntry } from "../actionEngineCore.ts";

export interface MemoryRepository {
  list(founderId: string): Promise<MemoryEntry[]>;
  save(founderId: string, memory: MemoryEntry): Promise<void>;
  delete(founderId: string, id: string): Promise<boolean>;
  search(founderId: string, query: string, limit?: number): Promise<MemoryEntry[]>;
}
