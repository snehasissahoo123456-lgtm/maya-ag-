import type { TaskEnvelope, TaskRepository } from "./task-orchestrator.ts";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
interface TaskRow { id: string; founder_id: string; envelope: TaskEnvelope; created_at: string; updated_at: string; }

/** Founder-scoped task repository. All state writes pass through a database RPC. */
export class SupabaseTaskRepository implements TaskRepository {
  private readonly restUrl: string;
  constructor(baseUrl: string, private readonly serviceRoleKey: string, private readonly fetcher: FetchLike = fetch) {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") throw new Error("Supabase URL must use HTTPS outside localhost.");
    if (!serviceRoleKey.trim()) throw new Error("Supabase service-role key is required.");
    this.restUrl = parsed.toString().replace(/\/$/, "") + "/rest/v1";
  }

  async get(id: string, founderId?: string): Promise<TaskEnvelope | undefined> {
    if (!founderId) throw new Error("Founder scope is required to read a task.");
    const query = new URLSearchParams({ select: "id,founder_id,envelope", id: `eq.${id}`, founder_id: `eq.${founderId}`, limit: "1" });
    const rows = await this.request<TaskRow[]>(`maya_tasks?${query}`);
    return rows[0] ? structuredClone(rows[0].envelope) : undefined;
  }

  async list(founderId: string): Promise<TaskEnvelope[]> {
    if (!founderId) throw new Error("Founder scope is required to list tasks.");
    const query = new URLSearchParams({ select: "envelope", founder_id: `eq.${founderId}`, order: "updated_at.asc", limit: "2000" });
    const rows = await this.request<Array<{ envelope: TaskEnvelope }>>(`maya_tasks?${query}`);
    return rows.map(row => structuredClone(row.envelope));
  }

  async put(envelope: TaskEnvelope): Promise<void> {
    if (!envelope?.task?.id || !envelope.task.founderId) throw new Error("Task ID and Founder identity are required.");
    const result = await this.request<TaskRow>("rpc/maya_save_task", {
      method: "POST",
      body: JSON.stringify({ p_task_id: envelope.task.id, p_founder_id: envelope.task.founderId, p_envelope: envelope }),
    });
    if (!result || result.id !== envelope.task.id || result.founder_id !== envelope.task.founderId) {
      throw new Error("Supabase did not confirm the Founder-scoped task write.");
    }
  }

  private async request<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(`${this.restUrl}/${endpoint}`, {
      ...init,
      headers: { apikey: this.serviceRoleKey, Authorization: `Bearer ${this.serviceRoleKey}`, "Content-Type": "application/json", ...(init.headers || {}) },
    });
    if (!response.ok) throw new Error(`Supabase task storage failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    if (response.status === 204) return undefined as T;
    const body = await response.text();
    return (body ? JSON.parse(body) : undefined) as T;
  }
}
