import type { MemoryEntry } from "../actionEngineCore.ts";
import type { MemoryRepository } from "./memory-repository.ts";

type PersistMemories = (memories: MemoryEntry[]) => void;

/** Single-Founder file adapter that preserves the existing state.json memory data. */
export class FileMemoryRepository implements MemoryRepository {
  private memories: MemoryEntry[];
  constructor(initialMemories: MemoryEntry[], private readonly persist: PersistMemories) {
    this.memories = structuredClone(initialMemories).slice(0, 500);
  }
  async list(founderId: string): Promise<MemoryEntry[]> {
    if (!founderId) throw new Error("Founder identity is required.");
    return structuredClone(this.memories);
  }
  async save(founderId: string, memory: MemoryEntry): Promise<void> {
    if (!founderId) throw new Error("Founder identity is required.");
    this.validate(memory);
    const next = this.memories.filter(item => item.id !== memory.id);
    next.unshift(structuredClone(memory));
    this.memories = next.slice(0, 500);
    this.persist(structuredClone(this.memories));
  }
  async delete(founderId: string, id: string): Promise<boolean> {
    if (!founderId) throw new Error("Founder identity is required.");
    const next = this.memories.filter(item => item.id !== id);
    if (next.length === this.memories.length) return false;
    this.memories = next;
    this.persist(structuredClone(this.memories));
    return true;
  }
  async recordFeedback(founderId: string, memoryId: string, rating: "helpful" | "not_helpful"): Promise<MemoryEntry> {
    if (!founderId) throw new Error("Founder identity is required.");
    if (rating !== "helpful" && rating !== "not_helpful") throw new Error("Memory feedback rating is invalid.");
    const index = this.memories.findIndex(item => item.id === memoryId);
    if (index < 0) throw new Error("Memory not found for this Founder.");
    const current = this.memories[index];
    const count = Math.max(0, current.feedbackCount || 0);
    const prior = Number.isFinite(current.feedbackScore) ? current.feedbackScore! : 0;
    const value = rating === "helpful" ? 1 : -1;
    const updated: MemoryEntry = { ...current, feedbackScore: (prior * count + value) / (count + 1), feedbackCount: count + 1, updatedAt: new Date().toISOString() };
    this.memories[index] = updated;
    this.persist(structuredClone(this.memories));
    return structuredClone(updated);
  }
  async search(founderId: string, query: string, limit = 20): Promise<MemoryEntry[]> {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) throw new Error("A non-empty memory query is required.");
    const bounded = Math.max(1, Math.min(Math.floor(limit), 100));
    return this.memories.filter(item => item.title.toLocaleLowerCase().includes(needle) ||
      item.content.toLocaleLowerCase().includes(needle) || item.category.includes(needle))
      .slice(0, bounded).map(item => structuredClone(item));
  }
  private validate(memory: MemoryEntry): void {
    const categories = new Set(["founder_profile", "project", "design", "technical", "process", "lesson", "assumption"]);
    if (!memory.id || memory.id.length > 128 || !categories.has(memory.category)) throw new Error("Memory identity or category is invalid.");
    if (!memory.title.trim() || memory.title.length > 160) throw new Error("Memory title must contain 1–160 characters.");
    if (!memory.content.trim() || memory.content.length > 20000) throw new Error("Memory content must contain 1–20,000 characters.");
  }
}
