import type { ConversationMessage } from "./conversation-store.ts";

export interface GeminiHistoryItem {
  role?: string;
  parts?: Array<Record<string, unknown>>;
}

/**
 * A conversation-store-compatible message that retains Gemini's structured
 * function-call/function-response parts alongside the plain-text projection.
 */
export interface GeminiConversationMessage extends ConversationMessage {
  parts: Array<Record<string, unknown>>;
}

/** Convert Gemini SDK history to the current durable conversation message contract. */
export function storeGeminiHistory(
  history: GeminiHistoryItem[],
  previous: ConversationMessage[],
  conversationId: string,
  now = new Date().toISOString(),
): GeminiConversationMessage[] {
  if (!Array.isArray(history) || history.length > 5000) {
    throw new Error("Gemini conversation history is invalid or exceeds the message limit.");
  }
  return history.map((item, index) => {
    const role = item?.role;
    if (role !== "user" && role !== "model") {
      throw new Error("Gemini conversation contains an unsupported message role.");
    }
    const parts = Array.isArray(item.parts) ? structuredClone(item.parts) : [];
    if (parts.length > 100 || JSON.stringify(parts).length > 1_000_000) {
      throw new Error("A conversation message exceeds the durable storage limit.");
    }
    const text = parts
      .map(part => typeof part.text === "string" ? part.text : "")
      .filter(Boolean)
      .join("\n")
      .slice(0, 20_000);
    return {
      id: previous[index]?.id || `${conversationId}-message-${index + 1}`,
      role,
      text,
      parts,
      createdAt: previous[index]?.createdAt || now,
    };
  });
}

/** Reconstruct Gemini SDK history without losing structured tool-call parts. */
export function restoreGeminiHistory(messages: Array<ConversationMessage & { parts?: Array<Record<string, unknown>> }>): GeminiHistoryItem[] {
  return messages.map(message => ({
    role: message.role,
    parts: message.parts?.length
      ? structuredClone(message.parts)
      : message.text ? [{ text: message.text }] : [],
  }));
}

/** Validate browser-provided history before using it to seed a new Founder conversation. */
export function normalizeIncomingGeminiHistory(value: unknown): GeminiHistoryItem[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 5000) {
    throw new Error("Incoming conversation history is invalid or exceeds the message limit.");
  }
  return value.map((item: any) => {
    const role = item?.role === "assistant" ? "model" : item?.role;
    if (role !== "user" && role !== "model") {
      throw new Error("Incoming conversation history contains an unsupported role.");
    }
    if (!Array.isArray(item.parts) || item.parts.length > 100 ||
        JSON.stringify(item.parts).length > 1_000_000) {
      throw new Error("Incoming conversation history contains invalid or oversized parts.");
    }
    return { role, parts: structuredClone(item.parts) };
  });
}
