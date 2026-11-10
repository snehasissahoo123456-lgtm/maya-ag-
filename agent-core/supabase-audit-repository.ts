import type { AuditRepository, MayaAuditEvent } from "./audit-repository.ts";
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
interface AuditRow {
  id: string; founder_id: string; actor_id: string; actor_role: string; event_type: MayaAuditEvent["type"];
  task_id: string; capability: string; action_digest: string; occurred_at: string;
  metadata: Record<string, string | number | boolean | null>;
}
export class SupabaseAuditRepository implements AuditRepository {
  private readonly restUrl: string;
  constructor(baseUrl: string, private readonly serviceRoleKey: string, private readonly fetcher: FetchLike = fetch) {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") throw new Error("Supabase URL must use HTTPS outside localhost.");
    if (!serviceRoleKey.trim()) throw new Error("Supabase service-role key is required.");
    this.restUrl = parsed.toString().replace(/\/$/, "") + "/rest/v1";
  }
  async append(event: MayaAuditEvent): Promise<void> {
    const rows = await this.request<AuditRow[]>("maya_audit_events", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        id: event.id, founder_id: event.founderId, actor_id: event.actorId, actor_role: event.actorRole,
        event_type: event.type, task_id: event.taskId, capability: event.capability,
        action_digest: event.actionDigest, occurred_at: event.occurredAt, metadata: event.metadata,
      }),
    });
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== event.id) throw new Error("Supabase did not confirm the audit event insert.");
  }
  async list(founderId: string, limit = 100): Promise<MayaAuditEvent[]> {
    const query = new URLSearchParams({
      select: "id,founder_id,actor_id,actor_role,event_type,task_id,capability,action_digest,occurred_at,metadata",
      founder_id: `eq.${founderId}`, order: "occurred_at.desc", limit: String(Math.max(1, Math.min(Math.floor(limit), 500))),
    });
    const rows = await this.request<AuditRow[]>(`maya_audit_events?${query}`);
    return rows.map(row => ({
      id: row.id, founderId: row.founder_id, actorId: row.actor_id, actorRole: row.actor_role,
      type: row.event_type, taskId: row.task_id, capability: row.capability, actionDigest: row.action_digest,
      occurredAt: row.occurred_at, metadata: row.metadata || {},
    }));
  }
  private async request<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(`${this.restUrl}/${endpoint}`, {
      ...init, headers: { apikey: this.serviceRoleKey, Authorization: `Bearer ${this.serviceRoleKey}`, "Content-Type": "application/json", ...(init.headers || {}) },
    });
    if (!response.ok) throw new Error(`Supabase audit storage failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    if (response.status === 204) return undefined as T;
    const body = await response.text();
    return (body ? JSON.parse(body) : undefined) as T;
  }
}
