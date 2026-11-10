import type { ScheduledJobRepository, ScheduledReadJob } from "./scheduled-job-repository.ts";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
interface ScheduleRow {
  id: string; founder_id: string; title: string; path: string; status: ScheduledReadJob["status"];
  next_run_at: string; interval_ms: number | string | null; created_at: string; updated_at: string;
  last_run_at: string | null; run_count: number; failure_count: number; last_error: string | null;
}

export class SupabaseScheduledJobRepository implements ScheduledJobRepository {
  private readonly restUrl: string;
  constructor(baseUrl: string, private readonly serviceRoleKey: string, private readonly fetcher: FetchLike = fetch) {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") throw new Error("Supabase URL must use HTTPS outside localhost.");
    if (!serviceRoleKey.trim()) throw new Error("Supabase service-role key is required.");
    this.restUrl = parsed.toString().replace(/\/$/, "") + "/rest/v1";
  }

  async create(job: ScheduledReadJob): Promise<void> {
    const rows = await this.request<ScheduleRow[]>("maya_scheduled_jobs", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        id: job.id, founder_id: job.founderId, title: job.title, path: job.path, status: job.status,
        next_run_at: job.nextRunAt, interval_ms: job.intervalMs, created_at: job.createdAt,
        updated_at: job.updatedAt, run_count: job.runCount, failure_count: job.failureCount,
      }),
    });
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== job.id || rows[0].founder_id !== job.founderId) {
      throw new Error("Supabase did not confirm the Founder-scoped schedule creation.");
    }
  }

  async get(founderId: string, id: string): Promise<ScheduledReadJob | undefined> {
    if (!founderId) throw new Error("Founder scope is required to read a schedule.");
    const query = new URLSearchParams({ select: "*", id: `eq.${id}`, founder_id: `eq.${founderId}`, limit: "1" });
    const rows = await this.request<ScheduleRow[]>(`maya_scheduled_jobs?${query}`);
    return rows[0] ? this.map(rows[0]) : undefined;
  }

  async list(founderId: string): Promise<ScheduledReadJob[]> {
    if (!founderId) throw new Error("Founder scope is required to list schedules.");
    const query = new URLSearchParams({ select: "*", founder_id: `eq.${founderId}`, order: "next_run_at.asc", limit: "500" });
    const rows = await this.request<ScheduleRow[]>(`maya_scheduled_jobs?${query}`);
    return rows.map(row => this.map(row));
  }

  async listDue(founderId: string, now: string, limit: number): Promise<ScheduledReadJob[]> {
    const query = new URLSearchParams({
      select: "*", founder_id: `eq.${founderId}`, status: "eq.active",
      next_run_at: `lte.${now}`, order: "next_run_at.asc", limit: String(Math.max(1, Math.min(100, Math.floor(limit)))),
    });
    const rows = await this.request<ScheduleRow[]>(`maya_scheduled_jobs?${query}`);
    return rows.map(row => this.map(row));
  }

  async claimDue(founderId: string, workerId: string, leaseMs: number, limit: number): Promise<ScheduledReadJob[]> {
    if (!founderId || !workerId) throw new Error("Founder and scheduler worker identities are required.");
    const rows = await this.request<ScheduleRow[]>("rpc/maya_claim_due_scheduled_jobs", {
      method: "POST",
      body: JSON.stringify({
        p_founder_id: founderId, p_worker_id: workerId,
        p_lease_ms: Math.max(5_000, Math.min(300_000, Math.floor(leaseMs))),
        p_limit: Math.max(1, Math.min(100, Math.floor(limit))),
      }),
    });
    if (!Array.isArray(rows)) throw new Error("Supabase returned an invalid schedule claim response.");
    for (const row of rows) if (row.founder_id !== founderId) throw new Error("Supabase returned a schedule owned by another Founder.");
    return rows.map(row => this.map(row));
  }

  async markEnqueued(founderId: string, id: string, scheduledAt: string, nextRunAt: string | null, workerId?: string): Promise<void> {
    if (!workerId) throw new Error("Scheduler worker identity is required to complete a leased schedule.");
    const rows = await this.request<ScheduleRow[]>("rpc/maya_complete_scheduled_job", {
      method: "POST",
      body: JSON.stringify({ p_founder_id: founderId, p_job_id: id, p_worker_id: workerId, p_scheduled_at: scheduledAt, p_next_run_at: nextRunAt }),
    });
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== id || rows[0].founder_id !== founderId) {
      throw new Error("Schedule lease expired or ownership changed before completion.");
    }
  }

  async recordFailure(founderId: string, id: string, error: string, workerId?: string): Promise<void> {
    if (!workerId) throw new Error("Scheduler worker identity is required to release a failed schedule lease.");
    const rows = await this.request<ScheduleRow[]>("rpc/maya_fail_scheduled_job", {
      method: "POST",
      body: JSON.stringify({ p_founder_id: founderId, p_job_id: id, p_worker_id: workerId, p_error: error.slice(0, 1000) }),
    });
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== id || rows[0].founder_id !== founderId) {
      throw new Error("Schedule failure could not be recorded for the owning Founder and worker.");
    }
  }

  async pause(founderId: string, id: string): Promise<boolean> {
    const rows = await this.request<ScheduleRow[]>("rpc/maya_pause_scheduled_job", {
      method: "POST", body: JSON.stringify({ p_founder_id: founderId, p_job_id: id }),
    });
    return Array.isArray(rows) && rows.length === 1 && rows[0].id === id && rows[0].founder_id === founderId;
  }

  private map(row: ScheduleRow): ScheduledReadJob {
    return {
      id: row.id, founderId: row.founder_id, title: row.title, path: row.path, status: row.status,
      nextRunAt: row.next_run_at, intervalMs: row.interval_ms === null ? null : Number(row.interval_ms),
      createdAt: row.created_at, updatedAt: row.updated_at, lastRunAt: row.last_run_at || undefined,
      runCount: Number(row.run_count), failureCount: Number(row.failure_count), lastError: row.last_error || undefined,
    };
  }

  private async request<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(`${this.restUrl}/${endpoint}`, {
      ...init,
      headers: { apikey: this.serviceRoleKey, Authorization: `Bearer ${this.serviceRoleKey}`, "Content-Type": "application/json", ...(init.headers || {}) },
    });
    if (!response.ok) throw new Error(`Supabase schedule storage failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    if (response.status === 204) return undefined as T;
    const body = await response.text();
    return (body ? JSON.parse(body) : undefined) as T;
  }
}
