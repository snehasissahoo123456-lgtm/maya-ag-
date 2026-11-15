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

/**
 * Department templates are deliberately static and least-privilege.
 * They describe available reasoning roles; they do not create 100 live workers,
 * grant unsupported tools, or confer approval/delegation authority.
 */
export const AGENT_MANIFESTS: readonly AgentManifest[] = Object.freeze([
  { id: "founder", displayName: "Founder", role: "founder", purpose: "Human owner and final authority for Maya.", allowedDelegates: ["ceo", "developer", "specialist"], defaultScopes: ["*"], maxConcurrentTasks: 100, mayCreateAgents: true, mayApproveActions: true },
  { id: "ceo", displayName: "Maya CEO", role: "ceo", purpose: "Plan work, coordinate departments, delegate bounded tasks and report to Founder.", allowedDelegates: ["developer", "specialist"], defaultScopes: ["tasks:read", "tasks:create", "agents:delegate", "memory:read", "memory:write"], maxConcurrentTasks: 12, mayCreateAgents: false, mayApproveActions: false },
  { id: "developer", displayName: "Maya Developer", role: "developer", purpose: "Implement, test and review code inside explicitly enrolled workspaces.", allowedDelegates: ["specialist"], defaultScopes: ["tasks:read", "workspace:read", "workspace:write", "tests:run"], maxConcurrentTasks: 4, mayCreateAgents: false, mayApproveActions: false },
  { id: "research", displayName: "Research & Intelligence", role: "specialist", purpose: "Research public sources, validate evidence, compare competitors and prepare cited briefs.", allowedDelegates: [], defaultScopes: ["research:web", "memory:read"], maxConcurrentTasks: 3, mayCreateAgents: false, mayApproveActions: false },
  { id: "operations", displayName: "Operations & Project Management", role: "specialist", purpose: "Prepare operating plans, SOPs, project schedules, dependencies and status reports.", allowedDelegates: [], defaultScopes: ["tasks:read", "memory:read"], maxConcurrentTasks: 3, mayCreateAgents: false, mayApproveActions: false },
  { id: "content", displayName: "Content & Media", role: "specialist", purpose: "Draft scripts, content calendars, creative briefs and brand-consistent media plans.", allowedDelegates: [], defaultScopes: ["workspace:read", "memory:read"], maxConcurrentTasks: 3, mayCreateAgents: false, mayApproveActions: false },
  { id: "finance", displayName: "Finance & Analysis", role: "specialist", purpose: "Prepare budgets, forecasts, cash-flow analysis and reconciliations; never initiate payments.", allowedDelegates: [], defaultScopes: ["finance:read", "memory:read"], maxConcurrentTasks: 2, mayCreateAgents: false, mayApproveActions: false },
  { id: "product", displayName: "Product & Design", role: "specialist", purpose: "Prepare product requirements, user journeys, UX reviews, accessibility checks and design briefs.", allowedDelegates: [], defaultScopes: ["workspace:read", "memory:read"], maxConcurrentTasks: 2, mayCreateAgents: false, mayApproveActions: false },
  { id: "marketing", displayName: "Marketing & Growth", role: "specialist", purpose: "Prepare positioning, SEO research, campaign plans, copy and performance-analysis briefs.", allowedDelegates: [], defaultScopes: ["research:web", "workspace:read", "memory:read"], maxConcurrentTasks: 2, mayCreateAgents: false, mayApproveActions: false },
  { id: "sales", displayName: "Sales & CRM", role: "specialist", purpose: "Research prospects, qualify leads, prepare proposals and draft follow-ups; cannot send external messages.", allowedDelegates: [], defaultScopes: ["research:web", "memory:read"], maxConcurrentTasks: 2, mayCreateAgents: false, mayApproveActions: false },
  { id: "customer-support", displayName: "Customer Support & Success", role: "specialist", purpose: "Classify support issues, retrieve approved knowledge and draft responses for human review.", allowedDelegates: [], defaultScopes: ["workspace:read", "memory:read"], maxConcurrentTasks: 2, mayCreateAgents: false, mayApproveActions: false },
  { id: "people-ops", displayName: "HR & People Operations", role: "specialist", purpose: "Prepare role descriptions, onboarding plans, training materials and people-operations checklists; sensitive decisions require human review.", allowedDelegates: [], defaultScopes: ["workspace:read", "memory:read"], maxConcurrentTasks: 1, mayCreateAgents: false, mayApproveActions: false },
  { id: "legal-compliance", displayName: "Legal & Compliance Support", role: "specialist", purpose: "Summarize provided contracts and policies, extract obligations and flag risks; not a substitute for qualified counsel.", allowedDelegates: [], defaultScopes: ["workspace:read", "memory:read"], maxConcurrentTasks: 1, mayCreateAgents: false, mayApproveActions: false },
  { id: "procurement", displayName: "Procurement & Vendor Management", role: "specialist", purpose: "Compare vendors and quotes, prepare purchase requests and track renewals; cannot commit purchases.", allowedDelegates: [], defaultScopes: ["research:web", "workspace:read", "memory:read"], maxConcurrentTasks: 2, mayCreateAgents: false, mayApproveActions: false },
  { id: "executive-assistant", displayName: "Administration & Executive Assistant", role: "specialist", purpose: "Prepare agendas, meeting notes, document organization and follow-up checklists.", allowedDelegates: [], defaultScopes: ["workspace:read", "memory:read"], maxConcurrentTasks: 2, mayCreateAgents: false, mayApproveActions: false },
  { id: "data-analytics", displayName: "Data & Analytics", role: "specialist", purpose: "Define KPIs, inspect authorized datasets and prepare reproducible analysis plans and reports.", allowedDelegates: [], defaultScopes: ["workspace:read", "memory:read"], maxConcurrentTasks: 2, mayCreateAgents: false, mayApproveActions: false },
  { id: "security-it", displayName: "Security & IT", role: "specialist", purpose: "Triage security findings, prepare patch plans and access-review checklists; cannot change access or production settings.", allowedDelegates: [], defaultScopes: ["workspace:read", "memory:read"], maxConcurrentTasks: 1, mayCreateAgents: false, mayApproveActions: false },
  { id: "real-estate", displayName: "Real Estate & Asset Operations", role: "specialist", purpose: "Compare property information, organize due-diligence checklists and prepare rent or occupancy analyses; legal and financial commitments require Founder approval.", allowedDelegates: [], defaultScopes: ["research:web", "workspace:read", "memory:read"], maxConcurrentTasks: 2, mayCreateAgents: false, mayApproveActions: false },
  { id: "hospitality", displayName: "Hospitality & Travel Operations", role: "specialist", purpose: "Prepare hotel operations, inventory, guest-service and travel-planning workflows; bookings and payments require approval.", allowedDelegates: [], defaultScopes: ["research:web", "workspace:read", "memory:read"], maxConcurrentTasks: 2, mayCreateAgents: false, mayApproveActions: false },
]);

export function getAgentManifest(id: string): AgentManifest | undefined {
  return AGENT_MANIFESTS.find(agent => agent.id === id);
}

export function canDelegate(from: AgentManifest, to: AgentManifest): boolean {
  return from.allowedDelegates.includes(to.role);
}
