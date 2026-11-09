import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface ConversationMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt: string;
}
export interface ConversationRecord {
  id: string;
  founderId: string;
  title: string;
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}
export interface ConversationStoreAdapter {
  list(founderId: string): Promise<ConversationRecord[]>;
  get(id: string, founderId: string): Promise<ConversationRecord | null>;
  upsert(record: ConversationRecord): Promise<ConversationRecord>;
  delete(id: string, founderId: string): Promise<boolean>;
}
interface StoredConversations { version: 1; updatedAt: string; conversations: ConversationRecord[]; }

/** Single-instance, file-backed conversation store. Use a shared database for multi-instance deployments. */
export class ConversationStore implements ConversationStoreAdapter {
  private readonly filePath: string;
  private readonly records = new Map<string, ConversationRecord>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath = process.env.MAYA_CONVERSATIONS_PATH ||
    path.join(process.env.MAYA_DATA_DIR || path.resolve(process.cwd(), "..", "maya-data"), "conversations.json")) {
    this.filePath = path.resolve(filePath);
    this.load();
  }

  async list(founderId: string): Promise<ConversationRecord[]> {
    return [...this.records.values()]
      .filter(record => record.founderId === founderId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(record => structuredClone(record));
  }

  async get(id: string, founderId: string): Promise<ConversationRecord | null> {
    const record = this.records.get(id);
    return record?.founderId === founderId ? structuredClone(record) : null;
  }

  async upsert(record: ConversationRecord): Promise<ConversationRecord> {
    this.validateRecord(record);
    const previous = this.records.get(record.id);
    if (previous && previous.founderId !== record.founderId) throw new Error("Conversation ownership cannot be changed.");
    const next = structuredClone(record);
    this.records.set(next.id, next);
    try { await this.persist(); }
    catch (error) { if (previous) this.records.set(record.id, previous); else this.records.delete(record.id); throw error; }
    return structuredClone(next);
  }

  async delete(id: string, founderId: string): Promise<boolean> {
    const previous = this.records.get(id);
    if (!previous || previous.founderId !== founderId) return false;
    this.records.delete(id);
    try { await this.persist(); }
    catch (error) { this.records.set(id, previous); throw error; }
    return true;
  }

  private validateRecord(record: ConversationRecord): void {
    if (!record || typeof record.id !== "string" || !record.id || record.id.length > 128 ||
        typeof record.founderId !== "string" || !record.founderId || record.founderId.length > 128 ||
        typeof record.title !== "string" || record.title.length > 300 ||
        !Array.isArray(record.messages) || record.messages.length > 5000 ||
        !Number.isFinite(Date.parse(record.createdAt)) || !Number.isFinite(Date.parse(record.updatedAt))) {
      throw new Error("Conversation record is invalid.");
    }
    for (const message of record.messages) {
      if (!message || typeof message.id !== "string" || !["system", "user", "assistant"].includes(message.role) ||
          typeof message.content !== "string" || message.content.length > 100_000 ||
          !Number.isFinite(Date.parse(message.createdAt))) throw new Error("Conversation contains an invalid message.");
    }
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")); }
    catch { throw new Error("Conversation store is corrupt; refusing to overwrite it."); }
    if (!parsed || typeof parsed !== "object" || (parsed as StoredConversations).version !== 1 ||
        !Array.isArray((parsed as StoredConversations).conversations)) {
      throw new Error("Conversation store has an unsupported or invalid format.");
    }
    for (const record of (parsed as StoredConversations).conversations) {
      this.validateRecord(record);
      if (this.records.has(record.id)) throw new Error("Conversation store contains duplicate ids.");
      this.records.set(record.id, record);
    }
  }

  private persist(): Promise<void> {
    const run = this.writeQueue.then(() => this.writeFile());
    this.writeQueue = run.catch(() => undefined);
    return run;
  }

  private writeFile(): void {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(directory, 0o700); } catch {}
    const state: StoredConversations = { version: 1, updatedAt: new Date().toISOString(), conversations: [...this.records.values()] };
    const temp = path.join(directory, `.conversations.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`);
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
    try { fs.renameSync(temp, this.filePath); }
    catch (error) { try { fs.rmSync(temp, { force: true }); } catch {} throw error; }
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
  }
}
