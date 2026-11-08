import type { ConversationMessage, ConversationRecord, ConversationRole } from "./conversation-store.ts";

export interface ConversationRepository {
  list(founderId: string): Promise<ConversationRecord[]>;
  get(founderId: string, id: string): Promise<ConversationRecord | undefined>;
  getOrCreate(founderId: string, id: string, firstMessage?: string): Promise<ConversationRecord>;
  append(founderId: string, id: string, role: ConversationRole, text: string): Promise<ConversationRecord>;
  delete(founderId: string, id: string): Promise<boolean>;
}
