import { randomBytes } from "node:crypto";
import { digestAction, type ApprovalRepository, type ApprovalRequest } from "./approval-ledger.ts";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
interface ApprovalRow {
  id: string; task_id: string; founder_id: string; capability: string; action_digest: string;
  requested_at: string; expires_at: string; status: ApprovalRequest["status"]; decided_at?: string | null;
}
export class SupabaseApprovalLedger implements ApprovalRepository {
  private readonly restUrl: string;
  constructor(baseUrl: string, private readonly serviceRoleKey: string, private readonly fetcher: FetchLike = fetch) {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") throw new Error("Supabase URL must use HTTPS outside localhost.");
    if (!serviceRoleKey.trim()) throw new Error("Supabase service-role key is required.");
    this.restUrl = parsed.toString().replace(/\/$/, "") + "/rest/v1";
  }

  async request(input: { taskId: string; founderId: string; capability: string; args: Record<string, unknown>; ttlMs?: number; now?: number }): Promise<ApprovalRequest> {
    if (!input.taskId || !input.founderId || !input.capability) throw new Error("Task, Founder and capability are required for approval.");
    const now = input.now ?? Date.now();
    const ttl = Math.min(Math.max(input.ttlMs ?? 10 * 60_000, 30_000), 60 * 60_000);
    const record: ApprovalRequest = {
      id: randomBytes(16).toString("hex"), taskId: input.taskId, founderId: input.founderId,
      capability: input.capability, actionDigest: digestAction(input.capability, input.args),
      requestedAt: new Date(now).toISOString(), expiresAt: new Date(now + ttl).toISOString(), status: "pending",
    };
    const rows = await this.requestJson<ApprovalRow[]>("maya_approvals", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify(this.toRow(record)),
    });
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== record.id) throw new Error("Supabase did not confirm approval request persistence.");
    return record;
  }

  async decide(input: { approvalId: string; founderId: string; approved: boolean; now?: number }): Promise<ApprovalRequest> {
    const rows = await this.requestJson<ApprovalRow[]>("rpc/maya_decide_approval", {
      method: "POST",
      body: JSON.stringify({ p_approval_id: input.approvalId, p_founder_id: input.founderId, p_approved: input.approved, p_now: new Date(input.now ?? Date.now()).toISOString() }),
    });
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error("Approval not found for this Founder or decision was not persisted.");
    const result = this.fromRow(rows[0]);
    if (result.status === "expired") throw new Error("Approval request expired.");
    if (result.status !== (input.approved ? "approved" : "rejected")) throw new Error("Supabase did not persist the requested approval decision.");
    return result;
  }

  async consume(input: { approvalId: string; founderId: string; taskId: string; capability: string; args: Record<string, unknown>; now?: number }): Promise<ApprovalRequest> {
    const rows = await this.requestJson<ApprovalRow[]>("rpc/maya_consume_approval", {
      method: "POST",
      body: JSON.stringify({
        p_approval_id: input.approvalId, p_founder_id: input.founderId, p_task_id: input.taskId,
        p_capability: input.capability, p_action_digest: digestAction(input.capability, input.args),
        p_now: new Date(input.now ?? Date.now()).toISOString(),
      }),
    });
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error("Approval grant is invalid, expired, already consumed, or does not match this exact action.");
    const result = this.fromRow(rows[0]);
    if (result.status === "expired") throw new Error("Approval request expired.");
    if (result.status !== "consumed") throw new Error("Supabase did not consume the exact approval grant.");
    return result;
  }

  async listForFounder(founderId: string): Promise<ApprovalRequest[]> {
    const query = new URLSearchParams({ select: "id,task_id,founder_id,capability,action_digest,requested_at,expires_at,status,decided_at", founder_id: `eq.${founderId}`, order: "requested_at.desc", limit: "10000" });
    const rows = await this.requestJson<ApprovalRow[]>(`maya_approvals?${query}`);
    return rows.map(row => this.fromRow(row));
  }

  private toRow(record: ApprovalRequest): ApprovalRow {
    return { id: record.id, task_id: record.taskId, founder_id: record.founderId, capability: record.capability, action_digest: record.actionDigest, requested_at: record.requestedAt, expires_at: record.expiresAt, status: record.status, decided_at: record.decidedAt ?? null };
  }
  private fromRow(row: ApprovalRow): ApprovalRequest {
    return { id: row.id, taskId: row.task_id, founderId: row.founder_id, capability: row.capability, actionDigest: row.action_digest, requestedAt: row.requested_at, expiresAt: row.expires_at, status: row.status, ...(row.decided_at ? { decidedAt: row.decided_at } : {}) };
  }
  private async requestJson<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(`${this.restUrl}/${endpoint}`, {
      ...init, headers: { apikey: this.serviceRoleKey, Authorization: `Bearer ${this.serviceRoleKey}`, "Content-Type": "application/json", ...(init.headers || {}) },
    });
    if (!response.ok) throw new Error(`Supabase approval storage failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    if (response.status === 204) return undefined as T;
    const body = await response.text();
    return (body ? JSON.parse(body) : undefined) as T;
  }
}
