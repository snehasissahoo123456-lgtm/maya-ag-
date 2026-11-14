import { createHash, randomUUID } from "node:crypto";
import { createTask, transitionTask } from "./task-lifecycle.ts";
import type { TaskEnvelope, TaskRepository } from "./task-orchestrator.ts";
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

export interface SpecialistToolExecutionEvent {
  agentId: string;
  founderId: string;
  actorRole: string;
  capability: string;
  status: "success" | "denied" | "failed";
  durationMs: number;
  completedAt: string;
  resultBytes?: number;
  resultSha256?: string;
  errorCode?: "policy_denied" | "execution_failed";
  taskId?: string;
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
    private readonly onExecution?: (event: SpecialistToolExecutionEvent) => void | Promise<void>,
    private readonly taskRepository?: TaskRepository,
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
    const startedAt = Date.now();
    let handlerStarted = false;
    let taskEnvelope: TaskEnvelope | undefined;
    try {
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

      if (this.taskRepository) {
        const taskId = "specialist-tool-" + randomUUID();
        let task = createTask({ id: taskId, founderId, instruction: "Specialist " + manifest.id + " tool execution: " + capability, riskLevel: "low", requiresApproval: false });
        task = transitionTask(task, "planning");
        task = transitionTask(task, "running");
        taskEnvelope = { task, capability, args, attempts: 1, idempotencyKey: taskId };
        await this.taskRepository.put(taskEnvelope);
      }

      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        handlerStarted = true;
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
        const resultBytes = Buffer.byteLength(serialized, "utf8");
        if (resultBytes > this.maxResultBytes) {
          throw new Error("Specialist capability result exceeds the configured response limit.");
        }
        const completedAt = new Date().toISOString();
        const resultSha256 = createHash("sha256").update(serialized, "utf8").digest("hex");
        if (taskEnvelope) {
          const evidence = { kind: "specialist-tool-result-sha256", description: "The specialist tool returned a bounded result; only its digest and byte count are retained in the task ledger.", reference: "sha256:" + resultSha256, observedAt: completedAt };
          taskEnvelope.result = { resultBytes, resultSha256, observedAt: completedAt };
          taskEnvelope.task = transitionTask(taskEnvelope.task, "verifying", { evidence });
          await this.taskRepository.put(taskEnvelope);
        }
        await this.emit({
          agentId, founderId, actorRole: manifest.role, capability, status: "success",
          durationMs: Date.now() - startedAt, completedAt,
          resultBytes, resultSha256,
          ...(taskEnvelope ? { taskId: taskEnvelope.task.id } : {}),
        });
        if (taskEnvelope) {
          taskEnvelope.task = transitionTask(taskEnvelope.task, "completed", {
            evidence: {
              kind: "specialist-tool-completion",
              description: "The specialist result was durably recorded and its audit event was acknowledged.",
              reference: "sha256:" + resultSha256,
              observedAt: completedAt,
            },
          });
          await this.taskRepository.put(taskEnvelope);
        }
        return result;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    } catch (error) {
      if (taskEnvelope) {
        if (taskEnvelope.task.status === "verifying") {
          taskEnvelope.task = transitionTask(taskEnvelope.task, "requires_recovery", { error: "The specialist tool returned, but its durable completion/audit record was not confirmed. Reconcile before retrying." });
          await this.taskRepository!.put(taskEnvelope);
        } else if (taskEnvelope.task.status === "running" || taskEnvelope.task.status === "planning") {
          taskEnvelope.task = transitionTask(taskEnvelope.task, "failed", { error: (error instanceof Error ? error.message : String(error)).slice(0, 1000) });
          await this.taskRepository!.put(taskEnvelope);
        }
      }
      await this.emit({
        agentId, founderId: founderId || "unknown", actorRole: getAgentManifest(agentId)?.role || "unknown", capability,
        status: handlerStarted ? "failed" : "denied",
        durationMs: Date.now() - startedAt,
        completedAt: new Date().toISOString(),
        ...(taskEnvelope ? { taskId: taskEnvelope.task.id } : {}),
        errorCode: handlerStarted ? "execution_failed" : "policy_denied",
      });
      throw error;
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

  private async emit(event: SpecialistToolExecutionEvent): Promise<void> {
    await this.onExecution?.(event);
  }
}
