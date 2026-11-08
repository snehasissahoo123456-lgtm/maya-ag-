import { createHash, randomBytes } from "node:crypto";
export interface ApprovalRequest {
  id: string;
  taskId: string;
  founderId: string;
  capability: string;
  actionDigest: string;
  requestedAt: string;
  expiresAt: string;
  status: "pending" | "approved" | "rejected" | "consumed" | "expired";
  decidedAt?: string;
}
export function digestAction(capability: string, args: Record<string, unknown>): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value as object).sort().map(key => [key, stable((value as Record<string, unknown>)[key])]));
    return value;
  };
  return createHash("sha256").update(JSON.stringify({ capability, args: stable(args) })).digest("hex");
}
export class ApprovalLedger {
  private readonly records = new Map<string, ApprovalRequest>();
  request(input: { taskId: string; founderId: string; capability: string; args: Record<string, unknown>; ttlMs?: number; now?: number }): ApprovalRequest {
    const now = input.now ?? Date.now();
    const ttl = Math.min(Math.max(input.ttlMs ?? 10 * 60_000, 30_000), 60 * 60_000);
    const record: ApprovalRequest = {
      id: randomBytes(16).toString("hex"), taskId: input.taskId, founderId: input.founderId,
      capability: input.capability, actionDigest: digestAction(input.capability, input.args),
      requestedAt: new Date(now).toISOString(), expiresAt: new Date(now + ttl).toISOString(), status: "pending",
    };
    this.records.set(record.id, record);
    return { ...record };
  }
  decide(input: { approvalId: string; founderId: string; approved: boolean; now?: number }): ApprovalRequest {
    const record = this.records.get(input.approvalId);
    if (!record || record.founderId !== input.founderId) throw new Error("Approval not found for this Founder.");
    if (record.status !== "pending") throw new Error("Approval is no longer pending.");
    const now = input.now ?? Date.now();
    if (Date.parse(record.expiresAt) <= now) {
      record.status = "expired";
      throw new Error("Approval request expired.");
    }
    record.status = input.approved ? "approved" : "rejected";
    record.decidedAt = new Date(now).toISOString();
    return { ...record };
  }
  consume(input: { approvalId: string; founderId: string; taskId: string; capability: string; args: Record<string, unknown>; now?: number }): ApprovalRequest {
    const record = this.records.get(input.approvalId);
    if (!record || record.status !== "approved") throw new Error("A pending Founder-approved grant is required.");
    if (record.founderId !== input.founderId || record.taskId !== input.taskId || record.capability !== input.capability || record.actionDigest !== digestAction(input.capability, input.args)) {
      throw new Error("Approval does not match this exact Founder, task, capability and argument set.");
    }
    if (Date.parse(record.expiresAt) <= (input.now ?? Date.now())) {
      record.status = "expired";
      throw new Error("Approval request expired.");
    }
    record.status = "consumed";
    return { ...record };
  }
  listForFounder(founderId: string): ApprovalRequest[] {
    return [...this.records.values()].filter(record => record.founderId === founderId).map(record => ({ ...record }));
  }
}
