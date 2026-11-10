import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateSelfBuildPlan, type SelfBuildPlan } from "./self-build-planner.ts";

export interface StoredSelfBuildPlan {
  planId: string;
  founderId: string;
  plan: SelfBuildPlan;
  createdAt: string;
  updatedAt: string;
}

interface StoredState {
  version: 1;
  updatedAt: string;
  records: StoredSelfBuildPlan[];
}

export interface SelfBuildPlanRepository {
  save(input: { planId: string; founderId: string; plan: unknown; now?: Date }): Promise<StoredSelfBuildPlan>;
  get(input: { planId: string; founderId: string }): Promise<StoredSelfBuildPlan | null>;
  list(input: { founderId: string; limit?: number }): Promise<StoredSelfBuildPlan[]>;
  delete(input: { planId: string; founderId: string }): Promise<boolean>;
}

export interface SelfBuildPlanStoreOptions {
  maxRecords?: number;
  maxBytes?: number;
}

const PLAN_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,79}$/;
const FOUNDER_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{1,119}$/;
const DEFAULT_MAX_RECORDS = 1000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Founder-scoped persistence for validated self-build proposals.
 * File mode is atomic for a single process; it is not a multi-instance database.
 * It stores proposals only and never schedules, approves, or executes them.
 */
export class SelfBuildPlanStore implements SelfBuildPlanRepository {
  private readonly records = new Map<string, StoredSelfBuildPlan>();
  private readonly filePath?: string;
  private readonly maxRecords: number;
  private readonly maxBytes: number;

  constructor(filePath?: string, options: SelfBuildPlanStoreOptions = {}) {
    this.filePath = filePath ? path.resolve(filePath) : undefined;
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    if (!Number.isInteger(this.maxRecords) || this.maxRecords < 1 || this.maxRecords > 10_000) {
      throw new Error("Self-build plan record limit must be between 1 and 10,000.");
    }
    if (!Number.isInteger(this.maxBytes) || this.maxBytes < 1024 || this.maxBytes > 64 * 1024 * 1024) {
      throw new Error("Self-build plan storage limit must be between 1 KB and 64 MB.");
    }
    if (this.filePath) this.load();
  }

  async save(input: { planId: string; founderId: string; plan: unknown; now?: Date }): Promise<StoredSelfBuildPlan> {
    if (!PLAN_ID.test(input.planId)) throw new Error("Plan ID must be a valid 3–80 character identifier.");
    if (!FOUNDER_ID.test(input.founderId)) throw new Error("Founder ID is invalid.");
    if (this.records.has(input.planId)) throw new Error("A self-build plan with this ID already exists.");
    if (this.records.size >= this.maxRecords) throw new Error("Self-build plan capacity reached.");
    const now = input.now ?? new Date();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("A valid plan timestamp is required.");
    const plan = validateSelfBuildPlan(input.plan, { now });
    const record: StoredSelfBuildPlan = {
      planId: input.planId,
      founderId: input.founderId,
      plan: clone(plan),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.records.set(record.planId, record);
    try {
      this.persist();
    } catch (error) {
      this.records.delete(record.planId);
      throw error;
    }
    return clone(record);
  }

  async get(input: { planId: string; founderId: string }): Promise<StoredSelfBuildPlan | null> {
    const record = this.records.get(input.planId);
    return record && record.founderId === input.founderId ? clone(record) : null;
  }

  async list(input: { founderId: string; limit?: number }): Promise<StoredSelfBuildPlan[]> {
    if (!FOUNDER_ID.test(input.founderId)) throw new Error("Founder ID is invalid.");
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Plan list limit must be between 1 and 500.");
    return [...this.records.values()]
      .filter(record => record.founderId === input.founderId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.planId.localeCompare(b.planId))
      .slice(0, limit)
      .map(clone);
  }

  async delete(input: { planId: string; founderId: string }): Promise<boolean> {
    const record = this.records.get(input.planId);
    if (!record || record.founderId !== input.founderId) return false;
    this.records.delete(input.planId);
    try {
      this.persist();
    } catch (error) {
      this.records.set(input.planId, record);
      throw error;
    }
    return true;
  }

  private load(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    const raw = fs.readFileSync(this.filePath, "utf8");
    if (Buffer.byteLength(raw, "utf8") > this.maxBytes) throw new Error("Self-build plan store exceeds its configured size limit.");
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error("Self-build plan store is corrupt; refusing to overwrite it."); }
    if (!parsed || typeof parsed !== "object" || (parsed as StoredState).version !== 1 ||
      !Array.isArray((parsed as StoredState).records)) {
      throw new Error("Self-build plan store has an unsupported or invalid format.");
    }
    const records = (parsed as StoredState).records;
    if (records.length > this.maxRecords) throw new Error("Self-build plan store exceeds its configured record limit.");
    for (const record of records) {
      if (!record || !PLAN_ID.test(record.planId) || !FOUNDER_ID.test(record.founderId) ||
        !Number.isFinite(Date.parse(record.createdAt)) || !Number.isFinite(Date.parse(record.updatedAt)) ||
        this.records.has(record.planId)) {
        throw new Error("Self-build plan store contains an invalid or duplicate record.");
      }
      const plan = validateSelfBuildPlan(record.plan, { now: new Date(record.plan.generatedAt) });
      this.records.set(record.planId, { ...record, plan });
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(directory, 0o700); } catch {}
    const state: StoredState = {
      version: 1,
      updatedAt: new Date().toISOString(),
      records: [...this.records.values()],
    };
    const serialized = JSON.stringify(state, null, 2);
    if (Buffer.byteLength(serialized, "utf8") > this.maxBytes) {
      throw new Error("Self-build plan store would exceed its configured size limit.");
    }
    const tempPath = path.join(directory, ".self-build-plans." + process.pid + "." +
      randomBytes(8).toString("hex") + ".tmp");
    fs.writeFileSync(tempPath, serialized, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try { fs.renameSync(tempPath, this.filePath); }
    catch (error) {
      try { fs.rmSync(tempPath, { force: true }); } catch {}
      throw error;
    }
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
  }
}
