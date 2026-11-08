import type { AgentManifest } from "./agent-manifests.ts";
export interface DelegationRecord {
  id: string;
  parentAgentId: string;
  childAgentId: string;
  founderId: string;
  taskId: string;
  depth: number;
  budget: { maxTasks: number; maxTokens: number; maxDurationMs: number };
  grantedScopes: string[];
  createdAt: string;
}
export class DelegationPolicy {
  private readonly records = new Map<string, DelegationRecord>();
  constructor(private readonly maxDepth = 4, private readonly maxTasksPerParent = 12) {}
  delegate(input: {
    id: string; taskId: string; founderId: string; parent: AgentManifest; child: AgentManifest;
    parentScopes: readonly string[]; requestedScopes: readonly string[]; depth: number;
    budget: { maxTasks: number; maxTokens: number; maxDurationMs: number };
  }): DelegationRecord {
    if (!input.id || !input.taskId || !input.founderId) throw new Error("Delegation identity is required.");
    if (!input.parent.allowedDelegates.includes(input.child.role)) throw new Error("Parent agent cannot delegate to this role.");
    if (input.depth < 1 || input.depth > this.maxDepth) throw new Error("Delegation depth limit exceeded.");
    if (input.budget.maxTasks < 1 || input.budget.maxTasks > this.maxTasksPerParent || input.budget.maxTokens < 1 || input.budget.maxTokens > 1_000_000 || input.budget.maxDurationMs < 1000 || input.budget.maxDurationMs > 3_600_000) throw new Error("Delegation budget is outside policy limits.");
    if (input.requestedScopes.some(scope => !input.parentScopes.includes(scope))) throw new Error("A child cannot receive scopes its parent does not possess.");
    if ([...this.records.values()].some(record => record.id === input.id)) throw new Error("Delegation ID already exists.");
    const record: DelegationRecord = {
      id: input.id, parentAgentId: input.parent.id, childAgentId: input.child.id,
      founderId: input.founderId, taskId: input.taskId, depth: input.depth,
      budget: { ...input.budget }, grantedScopes: [...new Set(input.requestedScopes)],
      createdAt: new Date().toISOString(),
    };
    this.records.set(record.id, record);
    return { ...record, budget: { ...record.budget }, grantedScopes: [...record.grantedScopes] };
  }
  listForTask(taskId: string): DelegationRecord[] {
    return [...this.records.values()].filter(record => record.taskId === taskId).map(record => ({ ...record, budget: { ...record.budget }, grantedScopes: [...record.grantedScopes] }));
  }
}
