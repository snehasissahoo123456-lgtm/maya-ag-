import type { MemoryEntry } from "../actionEngineCore.ts";
import type { MemoryRepository } from "./memory-repository.ts";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type MemoryEmbeddingProvider = (text: string, purpose: "document" | "query") => Promise<number[] | undefined>;
interface MemoryRow {
  id: string; founder_id: string; category: MemoryEntry["category"]; title: string; content: string;
  created_at: string; updated_at: string; embedding?: number[] | null;
}
const CATEGORIES = new Set(["founder_profile", "project", "design", "technical", "process", "lesson", "assumption"]);

export class SupabaseMemoryRepository implements MemoryRepository {
  private readonly restUrl: string;
  private readonly initializedFounders = new Set<string>();
  constructor(baseUrl: string, private readonly serviceRoleKey: string, private readonly legacySeed: MemoryEntry[] = [], private readonly embed?: MemoryEmbeddingProvider, private readonly fetcher: FetchLike = fetch) {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") throw new Error("Supabase URL must use HTTPS outside localhost.");
    if (!serviceRoleKey.trim()) throw new Error("Supabase service-role key is required.");
    this.restUrl = parsed.toString().replace(/\/$/, "") + "/rest/v1";
  }
  async list(founderId: string): Promise<MemoryEntry[]> {
    await this.ensureLegacyImport(founderId);
    const query = new URLSearchParams({ select: "id,founder_id,category,title,content,created_at,updated_at", founder_id: `eq.${founderId}`, order: "updated_at.desc", limit: "500" });
    const rows = await this.request<MemoryRow[]>(`maya_memories?${query}`);
    return rows.map(row => this.fromRow(row));
  }
  async save(founderId: string, memory: MemoryEntry): Promise<void> {
    await this.ensureLegacyImport(founderId);
    this.validate(memory);
    let embedding: number[] | undefined;
    if (this.embed) {
      try { embedding = await this.embed(memory.title + "\\n" + memory.content, "document"); }
      catch { embedding = undefined; }
      if (embedding && (embedding.length !== 768 || embedding.some(value => !Number.isFinite(value)))) embedding = undefined;
    }
    const rows = await this.request<MemoryRow[]>("maya_memories", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ id: memory.id, founder_id: founderId, category: memory.category, title: memory.title, content: memory.content, created_at: memory.createdAt, updated_at: memory.updatedAt, embedding: embedding ?? null }),
    });
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== memory.id || rows[0].founder_id !== founderId) throw new Error("Supabase did not confirm Founder memory persistence.");
  }
  async delete(founderId: string, id: string): Promise<boolean> {
    await this.ensureLegacyImport(founderId);
    const query = new URLSearchParams({ id: `eq.${id}`, founder_id: `eq.${founderId}`, select: "id" });
    const rows = await this.request<Array<{ id: string }>>(`maya_memories?${query}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
    return Array.isArray(rows) && rows.length > 0;
  }
  async search(founderId: string, query: string, limit = 20): Promise<MemoryEntry[]> {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) throw new Error("A non-empty memory query is required.");
    const bounded = Math.max(1, Math.min(Math.floor(limit), 100));
    if (this.embed) {
      try {
        const queryEmbedding = await this.embed(query, "query");
        if (queryEmbedding && queryEmbedding.length === 768 && queryEmbedding.every(Number.isFinite)) {
          const rows = await this.request<MemoryRow[]>( "rpc/maya_search_memories", {
            method: "POST",
            body: JSON.stringify({ p_founder_id: founderId, p_query_embedding: queryEmbedding, p_limit: bounded }),
          });
          if (Array.isArray(rows) && rows.length > 0) {
            const semantic = rows.map(row => this.fromRow(row));
            const keyword = await this.keywordSearch(founderId, needle, bounded);
            const seen = new Set(semantic.map(item => item.id));
            return [...semantic, ...keyword.filter(item => !seen.has(item.id))].slice(0, bounded);
          }
        }
      } catch {
        // Semantic retrieval is an enhancement; bounded keyword search remains the fallback.
      }
    }
    return this.keywordSearch(founderId, needle, bounded);
  }

  private async keywordSearch(founderId: string, needle: string, limit: number): Promise<MemoryEntry[]> {
    const memories = await this.list(founderId);
    return memories.filter(item => item.title.toLocaleLowerCase().includes(needle) ||
      item.content.toLocaleLowerCase().includes(needle) || item.category.includes(needle)).slice(0, limit);
  }
  private async ensureLegacyImport(founderId: string): Promise<void> {
    if (this.initializedFounders.has(founderId)) return;
    const seed = this.legacySeed.slice(0, 500).map(item => ({
      id: item.id, category: item.category, title: item.title, content: item.content,
      createdAt: item.createdAt, updatedAt: item.updatedAt,
    }));
    await this.request<Array<{ imported: boolean }>>("rpc/maya_import_legacy_memories", {
      method: "POST", body: JSON.stringify({ p_founder_id: founderId, p_memories: seed }),
    });
    this.initializedFounders.add(founderId);
  }
  private fromRow(row: MemoryRow): MemoryEntry {
    return { id: row.id, category: row.category, title: row.title, content: row.content, createdAt: row.created_at, updatedAt: row.updated_at };
  }
  private validate(memory: MemoryEntry): void {
    if (!memory.id || memory.id.length > 128 || !CATEGORIES.has(memory.category)) throw new Error("Memory identity or category is invalid.");
    if (!memory.title.trim() || memory.title.length > 160) throw new Error("Memory title must contain 1–160 characters.");
    if (!memory.content.trim() || memory.content.length > 20000) throw new Error("Memory content must contain 1–20,000 characters.");
  }
  private async request<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(`${this.restUrl}/${endpoint}`, {
      ...init, headers: { apikey: this.serviceRoleKey, Authorization: `Bearer ${this.serviceRoleKey}`, "Content-Type": "application/json", ...(init.headers || {}) },
    });
    if (!response.ok) throw new Error(`Supabase memory storage failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    if (response.status === 204) return undefined as T;
    const body = await response.text();
    return (body ? JSON.parse(body) : undefined) as T;
  }
}
