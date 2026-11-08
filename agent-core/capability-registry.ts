export type CapabilityRisk = "low" | "medium" | "high" | "critical";
export type AgentRole = "founder" | "ceo" | "developer" | "specialist";
export interface CapabilityArgument {
  type: "string" | "number" | "boolean";
  required?: boolean;
  maxLength?: number;
  enum?: readonly string[];
}
export interface CapabilityDefinition {
  name: string;
  description: string;
  risk: CapabilityRisk;
  allowedRoles: readonly AgentRole[];
  requiredScopes: readonly string[];
  arguments: Readonly<Record<string, CapabilityArgument>>;
  timeoutMs: number;
  requiresApproval: boolean;
  verification: string;
}
export interface AgentIdentity {
  id: string;
  founderId: string;
  role: AgentRole;
  scopes: readonly string[];
}
export class CapabilityDeniedError extends Error {
  constructor(message: string) { super(message); this.name = "CapabilityDeniedError"; }
}
export class CapabilityRegistry {
  private readonly definitions = new Map<string, CapabilityDefinition>();
  register(definition: CapabilityDefinition): void {
    if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(definition.name)) throw new Error("Invalid capability name.");
    if (this.definitions.has(definition.name)) throw new Error("Capability already registered: " + definition.name);
    if (definition.timeoutMs < 100 || definition.timeoutMs > 120_000) throw new Error("Capability timeout must be between 100 and 120000 ms.");
    if (!definition.verification.trim()) throw new Error("Every capability requires a verification method.");
    this.definitions.set(definition.name, Object.freeze({ ...definition, arguments: Object.freeze({ ...definition.arguments }) }));
  }
  get(name: string): CapabilityDefinition | undefined { return this.definitions.get(name); }
  list(): CapabilityDefinition[] { return [...this.definitions.values()]; }
  validate(name: string, actor: AgentIdentity, input: unknown): { definition: CapabilityDefinition; args: Record<string, unknown> } {
    const definition = this.definitions.get(name);
    if (!definition) throw new CapabilityDeniedError("Capability is not registered.");
    if (!definition.allowedRoles.includes(actor.role)) throw new CapabilityDeniedError("Agent role is not allowed to use this capability.");
    if (definition.requiredScopes.some(scope => !actor.scopes.includes(scope))) throw new CapabilityDeniedError("Required capability scope is missing.");
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new CapabilityDeniedError("Capability arguments must be an object.");
    const args = input as Record<string, unknown>;
    for (const key of Object.keys(args)) if (!(key in definition.arguments)) throw new CapabilityDeniedError("Unexpected argument: " + key);
    for (const [key, spec] of Object.entries(definition.arguments)) {
      const value = args[key];
      if (value === undefined || value === null) {
        if (spec.required) throw new CapabilityDeniedError("Missing required argument: " + key);
        continue;
      }
      if (typeof value !== spec.type) throw new CapabilityDeniedError("Invalid type for argument: " + key);
      if (spec.type === "string" && spec.maxLength && (value as string).length > spec.maxLength) throw new CapabilityDeniedError("Argument too long: " + key);
      if (spec.enum && !spec.enum.includes(String(value))) throw new CapabilityDeniedError("Invalid value for argument: " + key);
    }
    return { definition, args: { ...args } };
  }
}
