import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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
interface StoredApprovals { version: 1; updatedAt: string; approvals: ApprovalRequest[]; }

export function digestAction(capability: string, args: Record<string, unknown>): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value as object).sort().map(key => [key, stable((value as Record<string, unknown>)[key])]));
    return value;
  };
  return createHash("sha256").update(JSON.stringify({ capability, args: stable(args) })).digest("hex");
}

/**
 * Exact-action approval ledger. Supplying a file path enables atomic, single-instance
 * persistence. Keep high-risk capabilities disabled until this durable adapter is used.
 */
export class ApprovalLedger {
  private readonly records = new Map<string, ApprovalRequest>();
  private readonly filePath?: string;

  constructor(filePath?: string) {
    this.filePath = filePath ? path.resolve(filePath) : undefined;
    if (this.filePath) this.load();
  }

  request(input: { taskId: string; founderId: string; capability: string; args: Record<string, unknown>; ttlMs?: number; now?: number }): ApprovalRequest {
    if (this.records.size >= 10_000) throw new Error("Approval ledger capacity reached; archive old records before creating more.");
    const now = input.now ?? Date.now();
    const ttl = Math.min(Math.max(input.ttlMs ?? 10 * 60_000, 30_000), 60 * 60_000);
    const record: ApprovalRequest = {
      id: randomBytes(16).toString("hex"), taskId: input.taskId, founderId: input.founderId,
      capability: input.capability, actionDigest: digestAction(input.capability, input.args),
      requestedAt: new Date(now).toISOString(), expiresAt: new Date(now + ttl).toISOString(), status: "pending",
    };
    this.records.set(record.id, record);
    try { this.persist(); } catch (error) { this.records.delete(record.id); throw error; }
    return { ...record };
  }

  decide(input: { approvalId: string; founderId: string; approved: boolean; now?: number }): ApprovalRequest {
    const record = this.records.get(input.approvalId);
    if (!record || record.founderId !== input.founderId) throw new Error("Approval not found for this Founder.");
    if (record.status !== "pending") throw new Error("Approval is no longer pending.");
    const now = input.now ?? Date.now();
    if (Date.parse(record.expiresAt) <= now) {
      record.status = "expired";
      try { this.persist(); } catch (error) { record.status = "pending"; throw error; }
      throw new Error("Approval request expired.");
    }
    const previousDecidedAt = record.decidedAt;
    record.status = input.approved ? "approved" : "rejected";
    record.decidedAt = new Date(now).toISOString();
    try { this.persist(); } catch (error) { record.status = "pending"; record.decidedAt = previousDecidedAt; throw error; }
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
      try { this.persist(); } catch (error) { record.status = "approved"; throw error; }
      throw new Error("Approval request expired.");
    }
    record.status = "consumed";
    try { this.persist(); } catch (error) { record.status = "approved"; throw error; }
    return { ...record };
  }

  listForFounder(founderId: string): ApprovalRequest[] {
    return [...this.records.values()].filter(record => record.founderId === founderId).map(record => ({ ...record }));
  }

  private load(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")); }
    catch { throw new Error("Approval ledger is corrupt; refusing to overwrite it."); }
    if (!parsed || typeof parsed !== "object" || (parsed as StoredApprovals).version !== 1 || !Array.isArray((parsed as StoredApprovals).approvals)) {
      throw new Error("Approval ledger has an unsupported or invalid format.");
    }
    const statuses = new Set(["pending", "approved", "rejected", "consumed", "expired"]);
    for (const record of (parsed as StoredApprovals).approvals) {
      if (!record || typeof record.id !== "string" || typeof record.taskId !== "string" ||
          typeof record.founderId !== "string" || typeof record.capability !== "string" ||
          !/^[a-f0-9]{64}$/.test(record.actionDigest) ||
          !Number.isFinite(Date.parse(record.requestedAt)) || !Number.isFinite(Date.parse(record.expiresAt)) ||
          !statuses.has(record.status) || (record.decidedAt !== undefined && !Number.isFinite(Date.parse(record.decidedAt)))) {
        throw new Error("Approval ledger contains an invalid record.");
      }
      if (this.records.has(record.id)) throw new Error("Approval ledger contains duplicate record ids.");
      this.records.set(record.id, record);
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(directory, 0o700); } catch {}
    const state: StoredApprovals = { version: 1, updatedAt: new Date().toISOString(), approvals: [...this.records.values()] };
    const tempPath = path.join(directory, `.approvals.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`);
    fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
    try { fs.renameSync(tempPath, this.filePath); }
    catch (error) {
      try { fs.rmSync(tempPath, { force: true }); } catch {}
      throw error;
    }
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
  }
}
