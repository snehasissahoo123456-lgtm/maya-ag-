export type ChatToolExecutor = (name: string, args: Record<string, unknown>) => Promise<unknown>;

/**
 * Chat-driven tool calls are intentionally read-only. State-changing tools must
 * go through a persisted plan and its Founder approval workflow.
 */
export function createChatToolExecutor(execute: ChatToolExecutor): ChatToolExecutor {
  const approvalRequired = new Set(["memory_save", "schedule_task", "run_tests"]);
  return async (name, args) => {
    if (approvalRequired.has(name)) {
      throw new Error(`Tool "${name}" requires a persisted plan and explicit Founder approval before execution.`);
    }
    return execute(name, args);
  };
}
