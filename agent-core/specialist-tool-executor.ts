import { CapabilityRegistry, type AgentIdentity, type CapabilityDefinition } from "./capability-registry.ts";
import { getAgentManifest } from "./agent-manifests.ts";

export interface SpecialistToolDeclaration {
  name: string;
  description: string;
  parametersJsonSchema: {
    type: "object";
    properties: Record<string, { type: "string" | "number" | "boolean"; description?: string; enum?: readonly string[] }>;
    required: string[];
    additionalProperties: false;
  };
}

export type SpecialistCapabilityHandler = (
  capability: string,
  args: Record<string, unknown>,
  context: { founderId: string; signal: AbortSignal },
) => Promise<unknown>;

/**
 * Exposes only low-risk capabilities explicitly covered by a specialist manifest.
 * Specialist identities can never approve actions or invoke high-risk capabilities.
 */
export class SpecialistToolExecutor {
  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly handler: SpecialistCapabilityHandler,
    private readonly maxResultBytes = 32_000,
  ) {}

  list(agentId: string): SpecialistToolDeclaration[] {
    const manifest = getAgentManifest(agentId);
    if (!manifest || manifest.role === "founder" || manifest.role === "ceo") return [];
    return this.registry.list()
      .filter(definition =>
        definition.risk === "low" &&
        !definition.requiresApproval &&
        definition.allowedRoles.includes(manifest.role) &&
        definition.requiredScopes.every(scope => manifest.defaultScopes.includes(scope)),
      )
      .map(definition => this.toDeclaration(definition));
  }

  async execute(agentId: string, founderId: string, capability: string, input: unknown): Promise<unknown> {
    if (!founderId || founderId.length > 256) throw new Error("A verified Founder identity is required.");
    const manifest = getAgentManifest(agentId);
    if (!manifest || manifest.role === "founder" || manifest.role === "ceo") {
      throw new Error("Unknown or non-runnable specialist identity.");
    }
    const actor: AgentIdentity = {
      id: `specialist:${manifest.id}`,
      founderId,
      role: manifest.role,
      scopes: manifest.defaultScopes,
    };
    const { definition, args } = this.registry.validate(capability, actor, input);
    if (definition.risk !== "low" || definition.requiresApproval) {
      throw new Error("Specialists may execute only low-risk, non-approval capabilities.");
    }
    if (!definition.requiredScopes.every(scope => manifest.defaultScopes.includes(scope))) {
      throw new Error("Specialist manifest does not grant every required capability scope.");
    }

    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.handler(capability, args, { founderId, signal: controller.signal }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error(`Specialist capability timed out after ${definition.timeoutMs} ms.`));
          }, definition.timeoutMs);
        }),
      ]);
      let serialized: string;
      try { serialized = JSON.stringify(result) ?? "null"; }
      catch { throw new Error("Specialist capability returned a non-serializable result."); }
      if (Buffer.byteLength(serialized, "utf8") > this.maxResultBytes) {
        throw new Error("Specialist capability result exceeds the configured response limit.");
      }
      return result;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private toDeclaration(definition: CapabilityDefinition): SpecialistToolDeclaration {
    const properties: SpecialistToolDeclaration["parametersJsonSchema"]["properties"] = {};
    const required: string[] = [];
    for (const [name, argument] of Object.entries(definition.arguments)) {
      properties[name] = { type: argument.type, ...(argument.enum ? { enum: argument.enum } : {}) };
      if (argument.required) required.push(name);
    }
    return {
      name: definition.name,
      description: definition.description,
      parametersJsonSchema: { type: "object", properties, required, additionalProperties: false },
    };
  }
}
