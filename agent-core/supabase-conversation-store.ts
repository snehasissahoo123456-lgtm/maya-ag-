import type { ConversationRecord, ConversationStoreAdapter } from "./conversation-store.ts";

/** Server-only Supabase REST adapter. Never pass the service-role key to browser code. */
export class SupabaseConversationStore implements ConversationStoreAdapter {
  private readonly baseUrl: string;
  private readonly serviceRoleKey: string;
  private readonly fetcher: typeof fetch;

  constructor(
    url = process.env.SUPABASE_URL || "",
    serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    fetcher: typeof fetch = fetch,
  ) {
    if (!url) throw new Error("Supabase conversation storage requires SUPABASE_URL.");
    if (!serviceRoleKey) throw new Error("Supabase conversation storage requires SUPABASE_SERVICE_ROLE_KEY.");
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      throw new Error("Supabase URL must use HTTPS outside localhost.");
    }
    this.baseUrl = parsed.toString().replace(/\/$/, "") + "/rest/v1/maya_conversations";
    this.serviceRoleKey = serviceRoleKey;
    this.fetcher = fetcher;
  }

  async list(founderId: string): Promise<ConversationRecord[]> {
    const url = new URL(this.baseUrl);
    url.searchParams.set("select", "id,founder_id,title,messages,created_at,updated_at");
    url.searchParams.set("founder_id", `eq.${founderId}`);
    url.searchParams.set("order", "updated_at.desc");
    const response = await this.request(url, { method: "GET" });
    return (await response.json() as any[]).map(row => this.fromRow(row));
  }

  async get(id: string, founderId: string): Promise<ConversationRecord | null> {
    const url = new URL(this.baseUrl);
    url.searchParams.set("select", "id,founder_id,title,messages,created_at,updated_at");
    url.searchParams.set("id", `eq.${id}`);
    url.searchParams.set("founder_id", `eq.${founderId}`);
    url.searchParams.set("limit", "1");
    const rows = await (await this.request(url, { method: "GET" })).json() as any[];
    return rows[0] ? this.fromRow(rows[0]) : null;
  }

  async upsert(record: ConversationRecord): Promise<ConversationRecord> {
    const url = new URL(this.baseUrl);
    url.searchParams.set("on_conflict", "id");
    const response = await this.request(url, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        id: record.id, founder_id: record.founderId, title: record.title, messages: record.messages,
        created_at: record.createdAt, updated_at: record.updatedAt,
      }),
    });
    const rows = await response.json() as any[];
    if (!rows[0]) throw new Error("Supabase did not return the saved conversation.");
    return this.fromRow(rows[0]);
  }

  async delete(id: string, founderId: string): Promise<boolean> {
    const url = new URL(this.baseUrl);
    url.searchParams.set("id", `eq.${id}`);
    url.searchParams.set("founder_id", `eq.${founderId}`);
    const response = await this.request(url, { method: "DELETE", headers: { Prefer: "return=representation" } });
    const rows = await response.json() as unknown[];
    return rows.length > 0;
  }

  private async request(url: URL, init: RequestInit): Promise<Response> {
    const response = await this.fetcher(url, {
      ...init,
      headers: {
        apikey: this.serviceRoleKey,
        Authorization: `Bearer ${this.serviceRoleKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1000);
      throw new Error(`Supabase conversation storage failed (${response.status}): ${detail}`);
    }
    return response;
  }

  private fromRow(row: any): ConversationRecord {
    return {
      id: String(row.id), founderId: String(row.founder_id), title: String(row.title || ""),
      messages: Array.isArray(row.messages) ? row.messages : [],
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }
}
