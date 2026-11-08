import { randomUUID } from "node:crypto";
import type { ConversationRepository } from "./conversation-repository.ts";
import type { ConversationMessage, ConversationRecord, ConversationRole } from "./conversation-store.ts";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
interface SupabaseConversationRow {
  id: string;
  founder_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages?: Array<{ id: string }>;
}
interface SupabaseMessageRow {
  id: string;
  role: ConversationRole;
  content: string;
  created_at: string;
}

export class SupabaseConversationStore implements ConversationRepository {
  private readonly restUrl: string;
  constructor(baseUrl: string, private readonly serviceRoleKey: string, private readonly fetcher: FetchLike = fetch) {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      throw new Error("Supabase URL must use HTTPS outside localhost.");
    }
    if (!serviceRoleKey.trim()) throw new Error("Supabase service-role key is required.");
    this.restUrl = parsed.toString().replace(/\/$/, "") + "/rest/v1";
  }

  async list(founderId: string): Promise<ConversationRecord[]> {
    const query = new URLSearchParams({
      select: "id,title,created_at,updated_at,messages:maya_conversation_messages(id)",
      founder_id: `eq.${founderId}`,
      order: "updated_at.desc",
      limit: "200",
    });
    const rows = await this.request<SupabaseConversationRow[]>(`maya_conversations?${query}`);
    return rows.map(row => ({
      id: row.id, founderId, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at,
      messages: [], messageCount: Array.isArray(row.messages) ? row.messages.length : 0,
    }));
  }

  async get(founderId: string, id: string): Promise<ConversationRecord | undefined> {
    const query = new URLSearchParams({
      select: "id,founder_id,title,created_at,updated_at",
      id: `eq.${id}`, founder_id: `eq.${founderId}`, limit: "1",
    });
    const rows = await this.request<SupabaseConversationRow[]>(`maya_conversations?${query}`);
    const row = rows[0];
    if (!row) return undefined;
    const messageQuery = new URLSearchParams({
      select: "id,role,content,created_at",
      conversation_id: `eq.${id}`, founder_id: `eq.${founderId}`,
      order: "created_at.asc", limit: "1000",
    });
    const messages = await this.request<SupabaseMessageRow[]>(`maya_conversation_messages?${messageQuery}`);
    const mapped: ConversationMessage[] = messages.map(message => ({
      id: message.id, role: message.role, text: message.content, createdAt: message.created_at,
    }));
    return {
      id: row.id, founderId, title: row.title, createdAt: row.created_at,
      updatedAt: row.updated_at, messages: mapped, messageCount: mapped.length,
    };
  }

  async getOrCreate(founderId: string, id: string, firstMessage = ""): Promise<ConversationRecord> {
    if (!founderId || !id || id.length > 128) throw new Error("A valid Founder and conversation ID are required.");
    const existing = await this.get(founderId, id);
    if (existing) return existing;
    const now = new Date().toISOString();
    await this.request<SupabaseConversationRow[]>("maya_conversations", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ id, founder_id: founderId, title: firstMessage.trim().slice(0, 72) || "New conversation", created_at: now, updated_at: now }),
    });
    const created = await this.get(founderId, id);
    if (!created) throw new Error("Conversation could not be created for this Founder.");
    return created;
  }

  async append(founderId: string, id: string, role: ConversationRole, text: string): Promise<ConversationRecord> {
    if (role !== "user" && role !== "model") throw new Error("Invalid conversation message role.");
    if (typeof text !== "string" || !text.trim() || text.length > 20000) throw new Error("Conversation message must contain 1–20,000 characters.");
    const result = await this.request<unknown>("rpc/maya_append_conversation_message", {
      method: "POST",
      body: JSON.stringify({ p_founder_id: founderId, p_conversation_id: id, p_role: role, p_content: text, p_message_id: randomUUID() }),
    });
    void result;
    const updated = await this.get(founderId, id);
    if (!updated) throw new Error("Conversation not found for this Founder.");
    return updated;
  }

  async delete(founderId: string, id: string): Promise<boolean> {
    const query = new URLSearchParams({ id: `eq.${id}`, founder_id: `eq.${founderId}`, select: "id" });
    const rows = await this.request<Array<{ id: string }>>(`maya_conversations?${query}`, {
      method: "DELETE", headers: { Prefer: "return=representation" },
    });
    return rows.length > 0;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(`${this.restUrl}/${path}`, {
      ...init,
      headers: {
        apikey: this.serviceRoleKey,
        Authorization: `Bearer ${this.serviceRoleKey}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`Supabase conversation storage failed (${response.status}): ${detail}`);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
