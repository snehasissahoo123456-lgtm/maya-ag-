import type { ConversationRepository } from "./conversation-repository.ts";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type ConversationRole = "user" | "model";
export interface ConversationMessage {
  id: string;
  role: ConversationRole;
  text: string;
  createdAt: string;
}
export interface ConversationRecord {
  id: string;
  messageCount?: number;
  founderId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessage[];
}
interface ConversationFile { version: 1; conversations: ConversationRecord[]; }

/**
 * Founder-scoped, atomic JSON conversation repository for a single Maya instance.
 * This is durable file storage, not a relational database or multi-instance queue.
 */
export class ConversationStore implements ConversationRepository {
  private readonly directory: string;
  private readonly filePath: string;
  constructor(directory = process.env.MAYA_DATA_DIR || path.resolve(process.cwd(), "..", "maya-data")) {
    this.directory = path.resolve(directory);
    this.filePath = path.join(this.directory, "conversations.json");
  }

  async list(founderId: string): Promise<ConversationRecord[]> {
    return this.read().conversations
      .filter((conversation) => conversation.founderId === founderId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((conversation) => structuredClone(conversation));
  }

  async get(founderId: string, id: string): Promise<ConversationRecord | undefined> {
    const conversation = this.read().conversations.find((item) => item.id === id && item.founderId === founderId);
    return conversation ? structuredClone(conversation) : undefined;
  }

  async getOrCreate(founderId: string, id: string, firstMessage = ""): Promise<ConversationRecord> {
    if (!founderId || !id || id.length > 128) throw new Error("A valid Founder and conversation ID are required.");
    const state = this.read();
    const existing = state.conversations.find((item) => item.id === id && item.founderId === founderId);
    if (existing) return structuredClone(existing);
    if (state.conversations.some((item) => item.id === id)) throw new Error("Conversation ID is already owned by another Founder.");
    const now = new Date().toISOString();
    const record: ConversationRecord = {
      id, founderId,
      title: (firstMessage.trim().slice(0, 72) || "New conversation"),
      createdAt: now, updatedAt: now, messages: [],
    };
    state.conversations.unshift(record);
    state.conversations = state.conversations.slice(0, 2000);
    this.write(state);
    return structuredClone(record);
  }

  async append(founderId: string, id: string, role: ConversationRole, text: string): Promise<ConversationRecord> {
    if (role !== "user" && role !== "model") throw new Error("Invalid conversation message role.");
    if (typeof text !== "string" || !text.trim() || text.length > 20000) throw new Error("Conversation message must contain 1–20,000 characters.");
    const state = this.read();
    const conversation = state.conversations.find((item) => item.id === id && item.founderId === founderId);
    if (!conversation) throw new Error("Conversation not found for this Founder.");
    conversation.messages.push({ id: randomUUID(), role, text, createdAt: new Date().toISOString() });
    conversation.messages = conversation.messages.slice(-1000);
    conversation.updatedAt = new Date().toISOString();
    if (conversation.title === "New conversation" && role === "user") conversation.title = text.trim().slice(0, 72);
    this.write(state);
    return structuredClone(conversation);
  }

  async delete(founderId: string, id: string): Promise<boolean> {
    const state = this.read();
    const before = state.conversations.length;
    state.conversations = state.conversations.filter((item) => !(item.id === id && item.founderId === founderId));
    if (state.conversations.length === before) return false;
    this.write(state);
    return true;
  }

  private read(): ConversationFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (parsed?.version !== 1 || !Array.isArray(parsed.conversations)) return { version: 1, conversations: [] };
      return { version: 1, conversations: parsed.conversations.filter((item: any) =>
        item && typeof item.id === "string" && typeof item.founderId === "string" && Array.isArray(item.messages)) };
    } catch { return { version: 1, conversations: [] }; }
  }

  private write(state: ConversationFile): void {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(this.directory, 0o700); } catch {}
    const temp = path.join(this.directory, `.conversations.${process.pid}.${randomUUID()}.tmp`);
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
    try { fs.renameSync(temp, this.filePath); }
    catch (error) { try { fs.rmSync(temp, { force: true }); } catch {} throw error; }
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
  }
}
