import type { ConversationMessage } from "./conversation-store.ts";

export interface GeminiHistoryItem {
  role?: string;
  parts?: Array<Record<string, unknown>>;
}

/** Convert Gemini SDK history to a durable, Founder-scoped conversation representation. */
export function storeGeminiHistory(
  history: GeminiHistoryItem[],
  previous: ConversationMessage[],
  conversationId: string,
  now = new Date().toISOString(),
): ConversationMessage[] {
  if (!Array.isArray(history) || history.length > 5000) {
    throw new Error("Gemini conversation history is invalid or exceeds the message limit.");
  }
  return history.map((item, index) => {
    const role = item?.role === "model" ? "assistant" : item?.role;
    if (role !== "user" && role !== "assistant") {
      throw new Error("Gemini conversation contains an unsupported message role.");
    }
    const parts = Array.isArray(item.parts) ? structuredClone(item.parts) : [];
    if (parts.length > 100 || JSON.stringify(parts).length > 1_000_000) {
      throw new Error("A conversation message exceeds the durable storage limit.");
    }
    const content = parts
      .map(part => typeof part.text === "string" ? part.text : "")
      .filter(Boolean)
      .join("\n")
      .slice(0, 100_000);
    return {
      id: previous[index]?.id || `${conversationId}-message-${index + 1}`,
      role,
      content,
      parts,
      createdAt: previous[index]?.createdAt || now,
    };
  });
}

/** Reconstruct the Gemini SDK's user/model role convention from stored messages. */
export function restoreGeminiHistory(messages: ConversationMessage[]): GeminiHistoryItem[] {
  return messages.map(message => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: message.parts?.length
      ? structuredClone(message.parts)
      : message.content ? [{ text: message.content }] : [],
  }));
}
