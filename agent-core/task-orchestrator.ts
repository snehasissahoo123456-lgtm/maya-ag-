import { createTask, transitionTask, type MayaTask, type RiskLevel, type VerificationEvidence } from "./task-lifecycle.ts";
import { digestAction, type ApprovalRepository } from "./approval-ledger.ts";
import { randomUUID } from "node:crypto";
import type { AuditRepository, MayaAuditEventType } from "./audit-repository.ts";
import { CapabilityRegistry, type AgentIdentity } from "./capability-registry.ts";
export interface TaskEnvelope { task: MayaTask; capability: string; args: Record<string, unknown>; attempts: number; idempotencyKey: string; }
export interface TaskRepository {
  get(id: string, founderId?: string): Promise<TaskEnvelope | undefined>;
  put(envelope: TaskEnvelope): Promise<void>;
  list(founderId: string): Promise<TaskEnvelope[]>;
  claimNext?(founderId: string, workerId: string, leaseMs: number): Promise<TaskEnvelope | undefined>;
  releaseClaim?(taskId: string, founderId: string, workerId: string): Promise<void>;
  recoverExpiredClaims?(founderId: string): Promise<number>;
}
export interface CapabilityRunner {
  run(input: { capability: string; args: Record<string, unknown>; timeoutMs: number; idempotencyKey: string; signal: AbortSignal }): Promise<{ result: unknown; evidence: VerificationEvidence }>;
}
export class TaskOrchestrator {
  private readonly executing = new Set<string>();
  constructor(private readonly repository: TaskRepository, private readonly capabilities: CapabilityRegistry, private readonly approvals: ApprovalRepository, private readonly runner: CapabilityRunner, private readonly audit?: AuditRepository) {}
  async enqueue(input: { id: string; founderId: string; instruction: string; capability: string; args: Record<string, unknown>; actor: AgentIdentity; riskLevel?: RiskLevel }): Promise<TaskEnvelope> {
    if (input.actor.founderId !== input.founderId) throw new Error("Task Founder does not match authenticated actor.");
    const { definition, args } = this.capabilities.validate(input.capability, input.actor, input.args);
    const task = createTask({ id: input.id, founderId: input.founderId, instruction: input.instruction, riskLevel: input.riskLevel ?? definition.risk, requiresApproval: definition.requiresApproval });
    const envelope: TaskEnvelope = { task, capability: definition.name, args, attempts: 0, idempotencyKey: input.id };
    await this.repository.put(envelope);
    await this.recordAudit(input.actor, "task.enqueued", envelope, { riskLevel: task.riskLevel });
    return envelope;
  }
  async requestApproval(taskId: string, actor: AgentIdentity): Promise<{ approvalId: string; expiresAt: string }> {
    const envelope = await this.requireTask(taskId, actor.founderId);
    if (actor.role !== "founder" || actor.founderId !== envelope.task.founderId) throw new Error("Only the owning Founder can request/approve this action.");
    if (!envelope.task.requiresApproval) throw new Error("This task does not require approval.");
    if (envelope.task.status !== "queued") throw new Error("Only queued tasks can enter the approval queue.");
    const record = await this.approvals.request({ taskId, founderId: actor.founderId, capability: envelope.capability, args: envelope.args });
    envelope.task = transitionTask(envelope.task, "planning");
    envelope.task = transitionTask(envelope.task, "awaiting_approval");
    await this.repository.put(envelope);
    await this.recordAudit(actor, "task.approval_requested", envelope, { approvalId: record.id, expiresAt: record.expiresAt });
    return { approvalId: record.id, expiresAt: record.expiresAt };
  }
  async decideApproval(input: { approvalId: string; approved: boolean; actor: AgentIdentity }): Promise<void> {
    if (input.actor.role !== "founder") throw new Error("Only the Founder can approve actions.");
    const approval = (await this.approvals.listForFounder(input.actor.founderId)).find(item => item.id === input.approvalId);
    if (!approval) throw new Error("Approval not found for this Founder.");
    const decision = await this.approvals.decide({ approvalId: input.approvalId, founderId: input.actor.founderId, approved: input.approved });
    if (decision.status === "expired") throw new Error("Approval request expired.");
    const envelope = await this.requireTask(approval.taskId, input.actor.founderId);
    await this.recordAudit(input.actor, "task.approval_decided", envelope, { approvalId: approval.id, approved: input.approved });
  }
  async execute(taskId: string, actor: AgentIdentity, approvalId?: string): Promise<{ task: MayaTask; result: unknown }> {
    if (this.executing.has(taskId)) throw new Error("Task execution is already in progress.");
    this.executing.add(taskId);
    try {
      return await this.executeOnce(taskId, actor, approvalId);
    } finally {
      this.executing.delete(taskId);
    }
  }
  private async executeOnce(taskId: string, actor: AgentIdentity, approvalId?: string): Promise<{ task: MayaTask; result: unknown }> {
    const envelope = await this.requireTask(taskId, actor.founderId);
    if (actor.founderId !== envelope.task.founderId) throw new Error("Task belongs to another Founder.");
    const { definition } = this.capabilities.validate(envelope.capability, actor, envelope.args);
    if (envelope.task.status !== "queued" && envelope.task.status !== "awaiting_approval") throw new Error("Task is not executable from its current state.");
    if (envelope.task.requiresApproval) {
      if (!approvalId) throw new Error("Founder approval is required before execution.");
      const grant = await this.approvals.consume({ approvalId, founderId: actor.founderId, taskId, capability: envelope.capability, args: envelope.args });
      if (envelope.task.status === "queued") {
        envelope.task = transitionTask(envelope.task, "planning");
        envelope.task = transitionTask(envelope.task, "awaiting_approval");
      }
      envelope.task = transitionTask(envelope.task, "running", { approval: { approvalId: grant.id, taskId, founderId: actor.founderId, approvedAt: grant.decidedAt! } });
    } else {
      envelope.task = transitionTask(envelope.task, "planning");
      envelope.task = transitionTask(envelope.task, "running");
    }
    envelope.attempts += 1;
    await this.repository.put(envelope);
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await this.recordAudit(actor, "task.execution_started", envelope, { attempt: envelope.attempts });
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => { controller.abort(); reject(new Error("Capability execution timed out.")); }, definition.timeoutMs);
      });
      const output = await Promise.race([this.runner.run({ capability: definition.name, args: envelope.args, timeoutMs: definition.timeoutMs, idempotencyKey: envelope.idempotencyKey, signal: controller.signal }), timeoutPromise]);
      envelope.task = transitionTask(envelope.task, "verifying");
      await this.repository.put(envelope);
      await this.recordAudit(actor, "task.execution_verified", envelope, { evidenceReference: output.evidence.reference ?? null, evidenceKind: output.evidence.kind });
      envelope.task = transitionTask(envelope.task, "completed", { evidence: output.evidence });
      await this.repository.put(envelope);
      return { task: envelope.task, result: output.result };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      envelope.task = transitionTask(envelope.task, envelope.task.status === "verifying" ? "requires_recovery" : "failed", { error: reason });
      await this.repository.put(envelope);
      if (envelope.task.status === "failed") {
        try { await this.recordAudit(actor, "task.execution_failed", envelope, { error: reason.slice(0, 500) }); } catch { /* preserve original execution error */ }
      }
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async recordAudit(
    actor: AgentIdentity,
    type: MayaAuditEventType,
    envelope: TaskEnvelope,
    metadata: Record<string, string | number | boolean | null> = {},
  ): Promise<void> {
    if (!this.audit) return;
    await this.audit.append({
      id: randomUUID(),
      founderId: envelope.task.founderId,
      actorId: actor.id,
      actorRole: actor.role,
      type,
      taskId: envelope.task.id,
      capability: envelope.capability,
      actionDigest: digestAction(envelope.capability, envelope.args),
      occurredAt: new Date().toISOString(),
      metadata,
    });
  }

  private async requireTask(id: string, founderId: string): Promise<TaskEnvelope> {
    const envelope = await this.repository.get(id, founderId);
    if (!envelope) throw new Error("Task not found.");
    return envelope;
  }
}
