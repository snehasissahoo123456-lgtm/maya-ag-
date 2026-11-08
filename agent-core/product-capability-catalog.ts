export type CapabilityAvailability = "implemented" | "limited" | "planned" | "blocked";
export interface ProductCapability {
  id: string;
  category: string;
  description: string;
  availability: CapabilityAvailability;
  currentEvidence: string;
  dependencies: string[];
}
export const MAYA_PRODUCT_CAPABILITIES: readonly ProductCapability[] = Object.freeze([
 { id: "research.web-grounding", category: "Research and intelligence", description: "Research public sources, compare evidence and produce cited briefs.", availability: "limited", currentEvidence: "Gemini Google Search grounding in chat; no dedicated research workflow or source archive.", dependencies: ["provider quotas", "source provenance", "research task templates"] },
 { id: "engineering.workspace-inspection", category: "Software engineering", description: "Inspect enrolled workspace files and run repository validation.", availability: "limited", currentEvidence: "Server workspace listing/reading and real lint/test/build command.", dependencies: ["local PC connector", "sandboxed write/edit adapter", "Git diff verification", "VS Code integration"] },
 { id: "business.venture-operations", category: "Business and venture operations", description: "Plan operations, track projects, prepare SOPs and report KPIs.", availability: "planned", currentEvidence: "Task queue and persistent notes only.", dependencies: ["durable database", "project integrations", "approval workflow", "reporting scheduler"] },
 { id: "property.real-estate", category: "Real estate and property", description: "Organize property leads, due diligence, valuations, documents and follow-ups.", availability: "planned", currentEvidence: "No property-specific workflow or external property integration.", dependencies: ["property CRM schema", "document vault", "source-backed research", "human legal/financial review"] },
 { id: "hospitality.operations", category: "Hospitality and travel", description: "Support hotel inventory, bookings, guest communication and tour operations.", availability: "planned", currentEvidence: "No booking, PMS, messaging or payment adapter.", dependencies: ["PMS/booking integrations", "guest-data controls", "payment provider approval"] },
 { id: "media.content-production", category: "Content and media", description: "Plan, draft and coordinate scripts, posts, video and brand assets.", availability: "planned", currentEvidence: "No production pipeline or publishing connector.", dependencies: ["asset storage", "media generation providers", "human publishing approval"] },
 { id: "productivity.personal-assistant", category: "Personal productivity", description: "Manage reminders, schedules, notes and personal task workflows.", availability: "limited", currentEvidence: "Persistent memory notes and queued tasks; no calendar, email or push integration.", dependencies: ["calendar/email integrations", "push notifications", "device enrollment"] },
 { id: "finance.analysis", category: "Finance and administration", description: "Prepare budgets, cash-flow analysis, reconciliations and decision briefs.", availability: "planned", currentEvidence: "No financial-account connector; payment execution intentionally absent.", dependencies: ["read-only financial data connectors", "audit trail", "Founder review"] },
 { id: "devices.local-runtime", category: "PC and device operations", description: "Execute explicitly approved actions on enrolled PC and Android devices.", availability: "planned", currentEvidence: "No PC connector, native Android app or enrolled device.", dependencies: ["device identity", "local connector", "Android app", "permission and revocation flow"] },
 { id: "agents.delegation", category: "AI workforce and agent factory", description: "Delegate bounded tasks to CEO, Developer and specialist agents.", availability: "limited", currentEvidence: "Agent role manifests and a bounded delegation policy exist; no live model-backed sub-agent runtime.", dependencies: ["agent runtime", "durable task queue", "budget metering", "trace and approval integration"] },
]);
export function getCapabilitiesByCategory(category: string): ProductCapability[] {
 return MAYA_PRODUCT_CAPABILITIES.filter(item => item.category === category).map(item => ({ ...item, dependencies: [...item.dependencies] }));
}
