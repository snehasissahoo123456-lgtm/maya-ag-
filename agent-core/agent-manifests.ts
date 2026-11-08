import type { AgentRole } from "./capability-registry.ts";
export interface AgentManifest {
  id: string;
  displayName: string;
  role: AgentRole;
  purpose: string;
  allowedDelegates: readonly AgentRole[];
  defaultScopes: readonly string[];
  maxConcurrentTasks: number;
  mayCreateAgents: boolean;
  mayApproveActions: boolean;
}
export const AGENT_MANIFESTS: readonly AgentManifest[] = Object.freeze([
  { id: "founder", displayName: "Founder", role: "founder", purpose: "Human owner and final authority for Maya.", allowedDelegates: ["ceo", "developer", "specialist"], defaultScopes: ["*"], maxConcurrentTasks: 100, mayCreateAgents: true, mayApproveActions: true },
  { id: "ceo", displayName: "Maya CEO", role: "ceo", purpose: "Plan work, coordinate departments, delegate bounded tasks and report to Founder.", allowedDelegates: ["developer", "specialist"], defaultScopes: ["tasks:read", "tasks:create", "agents:delegate", "memory:read", "memory:write"], maxConcurrentTasks: 12, mayCreateAgents: false, mayApproveActions: false },
  { id: "developer", displayName: "Maya Developer", role: "developer", purpose: "Implement, test and review code inside explicitly enrolled workspaces.", allowedDelegates: ["specialist"], defaultScopes: ["tasks:read", "workspace:read", "workspace:write", "tests:run"], maxConcurrentTasks: 4, mayCreateAgents: false, mayApproveActions: false },
  { id: "research", displayName: "Research Specialist", role: "specialist", purpose: "Research sources, compare evidence and prepare concise findings.", allowedDelegates: [], defaultScopes: ["research:web", "memory:read"], maxConcurrentTasks: 3, mayCreateAgents: false, mayApproveActions: false },
  { id: "operations", displayName: "Operations Specialist", role: "specialist", purpose: "Prepare operational plans, checklists and status reports.", allowedDelegates: [], defaultScopes: ["tasks:read", "memory:read"], maxConcurrentTasks: 3, mayCreateAgents: false, mayApproveActions: false },
  { id: "content", displayName: "Content Specialist", role: "specialist", purpose: "Draft and quality-check content and media production plans.", allowedDelegates: [], defaultScopes: ["workspace:read", "memory:read"], maxConcurrentTasks: 3, mayCreateAgents: false, mayApproveActions: false },
  { id: "finance", displayName: "Finance Specialist", role: "specialist", purpose: "Prepare financial analyses and reconciliations; never initiate payments.", allowedDelegates: [], defaultScopes: ["finance:read", "memory:read"], maxConcurrentTasks: 2, mayCreateAgents: false, mayApproveActions: false },
]);
export function getAgentManifest(id: string): AgentManifest | undefined { return AGENT_MANIFESTS.find(agent => agent.id === id); }
export function canDelegate(from: AgentManifest, to: AgentManifest): boolean { return from.allowedDelegates.includes(to.role); }
