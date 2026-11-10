import type { CEORunRecord, CEORunRepository } from "./ceo-run-repository.ts";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
interface RunRow {
  id: string; founder_id: string; objective: string; status: CEORunRecord["status"];
  assignments: CEORunRecord["assignments"]; findings: CEORunRecord["findings"];
  summary: string | null; error: string | null; created_at: string; updated_at: string;
  completed_at: string | null; duration_ms: number | null; lease_until: string | null;
}

export class SupabaseCEORunRepository implements CEORunRepository {
  private readonly restUrl: string;
  constructor(baseUrl: string, private readonly serviceRoleKey: string, private readonly fetcher: FetchLike = fetch) {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") throw new Error("Supabase URL must use HTTPS outside localhost.");
    if (!serviceRoleKey.trim()) throw new Error("Supabase service-role key is required.");
    this.restUrl = parsed.toString().replace(/\/$/, "") + "/rest/v1";
  }

  async create(record: CEORunRecord): Promise<void> {
    if (!record.id || !record.founderId || !record.objective.trim() || record.objective.length > 2000) throw new Error("CEO run identity and objective are invalid.");
    const rows = await this.request<RunRow[]>("maya_ceo_runs", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify(this.toRow(record)),
    });
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== record.id || rows[0].founder_id !== record.founderId) {
      throw new Error("Supabase did not confirm the Founder-scoped CEO run creation.");
    }
  }

  async update(founderId: string, record: CEORunRecord): Promise<void> {
    if (!founderId || record.founderId !== founderId) throw new Error("CEO run Founder identity mismatch.");
    const query = new URLSearchParams({ id: `eq.${record.id}`, founder_id: `eq.${founderId}`, select: "id,founder_id" });
    const rows = await this.request<Array<{ id: string; founder_id: string }>>(`maya_ceo_runs?${query}`, {
      method: "PATCH", headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        objective: record.objective, status: record.status, assignments: record.assignments,
        findings: record.findings, summary: record.summary ?? null, error: record.error ?? null,
        updated_at: record.updatedAt, completed_at: record.completedAt ?? null,
        duration_ms: record.durationMs ?? null,
        lease_until: record.status === "running" ? new Date(Date.now() + 2 * 60 * 60_000).toISOString() : null,
      }),
    });
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== record.id || rows[0].founder_id !== founderId) {
      throw new Error("CEO run not found for this Founder or update was not persisted.");
    }
  }

  async get(founderId: string, id: string): Promise<CEORunRecord | undefined> {
    if (!founderId) throw new Error("Founder scope is required to read CEO runs.");
    const query = new URLSearchParams({ select: "*", id: `eq.${id}`, founder_id: `eq.${founderId}`, limit: "1" });
    const rows = await this.request<RunRow[]>(`maya_ceo_runs?${query}`);
    return rows[0] ? this.map(rows[0]) : undefined;
  }

  async list(founderId: string, limit = 50): Promise<CEORunRecord[]> {
    if (!founderId) throw new Error("Founder scope is required to list CEO runs.");
    const query = new URLSearchParams({ select: "*", founder_id: `eq.${founderId}`, order: "created_at.desc", limit: String(Math.max(1, Math.min(200, Math.floor(limit)))) });
    const rows = await this.request<RunRow[]>(`maya_ceo_runs?${query}`);
    return rows.map(row => this.map(row));
  }

  async recoverInterrupted(): Promise<number> {
    const rows = await this.request<Array<{ recovered: number }>>("rpc/maya_recover_interrupted_ceo_runs", { method: "POST", body: "{}" });
    return Array.isArray(rows) && rows[0] ? Number(rows[0].recovered) || 0 : 0;
  }

  private toRow(record: CEORunRecord) {
    return {
      id: record.id, founder_id: record.founderId, objective: record.objective, status: record.status,
      assignments: record.assignments, findings: record.findings, summary: record.summary ?? null,
      error: record.error ?? null, created_at: record.createdAt, updated_at: record.updatedAt,
      completed_at: record.completedAt ?? null, duration_ms: record.durationMs ?? null,
      lease_until: record.status === "running" ? new Date(Date.now() + 2 * 60 * 60_000).toISOString() : null,
    };
  }

  private map(row: RunRow): CEORunRecord {
    return {
      id: row.id, founderId: row.founder_id, objective: row.objective, status: row.status,
      assignments: row.assignments || [], findings: row.findings || [], summary: row.summary || undefined,
      error: row.error || undefined, createdAt: row.created_at, updatedAt: row.updated_at,
      completedAt: row.completed_at || undefined, durationMs: row.duration_ms === null ? undefined : Number(row.duration_ms),
    };
  }

  private async request<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(`${this.restUrl}/${endpoint}`, {
      ...init,
      headers: { apikey: this.serviceRoleKey, Authorization: `Bearer ${this.serviceRoleKey}`, "Content-Type": "application/json", ...(init.headers || {}) },
    });
    if (!response.ok) throw new Error(`Supabase CEO run storage failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    if (response.status === 204) return undefined as T;
    const body = await response.text();
    return (body ? JSON.parse(body) : undefined) as T;
  }
}
