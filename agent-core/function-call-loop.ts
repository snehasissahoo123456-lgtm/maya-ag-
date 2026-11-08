export interface FunctionCallingChat {
  sendMessage(input: { message: unknown }): Promise<any>;
}
export type AgentToolExecutor = (name: string, args: Record<string, unknown>) => Promise<unknown>;

/**
 * Bounded Gemini function-calling loop. Each tool call is executed by the server-side
 * allowlisted executor; model output never becomes shell code or a filesystem path by itself.
 */
export async function runFunctionCallingTurn(
  chat: FunctionCallingChat,
  userMessage: unknown,
  executeTool: AgentToolExecutor,
  limits: { maxRounds?: number; maxCalls?: number } = {},
): Promise<any> {
  const maxRounds = Math.max(1, Math.min(limits.maxRounds ?? 3, 5));
  const maxCalls = Math.max(1, Math.min(limits.maxCalls ?? 6, 12));
  let totalCalls = 0;
  let response = await chat.sendMessage({ message: userMessage });

  for (let round = 0; round < maxRounds; round += 1) {
    const calls = Array.isArray(response?.functionCalls) ? response.functionCalls : [];
    if (calls.length === 0) return response;
    const remaining = maxCalls - totalCalls;
    if (remaining <= 0) return response;
    const selected = calls.slice(0, remaining);
    totalCalls += selected.length;

    const parts = await Promise.all(selected.map(async (call: any) => {
      const name = String(call?.name || "");
      const args = call?.args && typeof call.args === "object" && !Array.isArray(call.args)
        ? call.args as Record<string, unknown> : {};
      try {
        const result = await executeTool(name, args);
        return { functionResponse: { name, response: { output: result }, ...(call.id ? { id: call.id } : {}) } };
      } catch (error) {
        return { functionResponse: { name, response: { error: error instanceof Error ? error.message : String(error) }, ...(call.id ? { id: call.id } : {}) } };
      }
    }));

    response = await chat.sendMessage({
      message: [{ role: "user", parts }],
    });
  }
  return response;
}
