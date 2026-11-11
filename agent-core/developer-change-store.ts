import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateDeveloperPatch, type DeveloperChangeRequest, type DeveloperChangeStatus } from "./developer-change-control.ts";

export interface DeveloperChangeRepository {
  create(change: DeveloperChangeRequest): Promise<DeveloperChangeRequest>;
  get(input: { changeId: string; founderId: string }): Promise<DeveloperChangeRequest | null>;
  list(input: { founderId: string; limit?: number }): Promise<DeveloperChangeRequest[]>;
  update(change: DeveloperChangeRequest): Promise<DeveloperChangeRequest>;
  delete(input: { changeId: string; founderId: string }): Promise<boolean>;
}
export interface DeveloperChangeStoreOptions { maxRecords?: number; maxBytes?: number; }
interface StoredState { version: 1; updatedAt: string; records: DeveloperChangeRequest[]; }
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,79}$/;
const FOUNDER = /^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{1,119}$/;
const SHA = /^[a-f0-9]{64}$/;
const STATUSES = new Set<DeveloperChangeStatus>(["draft","submitted","reviewed","approved","executing","verifying","completed","rejected","rolled_back"]);
const ALLOWED_TRANSITIONS: Record<DeveloperChangeStatus, readonly DeveloperChangeStatus[]> = {
  draft: ["submitted"], submitted: ["reviewed","rejected"], reviewed: ["approved"],
  approved: ["executing"], executing: ["verifying","completed","rolled_back"],
  verifying: ["completed","rolled_back"], completed: ["rolled_back"], rejected: [], rolled_back: [],
};
const DEFAULT_MAX_RECORDS = 2000;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function validateRecord(value: unknown): DeveloperChangeRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Developer change record must be an object.");
  const r = value as DeveloperChangeRequest;
  if (!ID.test(r.id) || !FOUNDER.test(r.founderId) || !ID.test(r.workspaceId) ||
      typeof r.title !== "string" || !r.title.trim() || r.title.length > 160 ||
      typeof r.objective !== "string" || !r.objective.trim() || r.objective.length > 4000 ||
      !STATUSES.has(r.status) || !SHA.test(r.diffSha256) || typeof r.patch !== "string" ||
      hash(r.patch) !== r.diffSha256 || !Array.isArray(r.files) ||
      !Number.isFinite(Date.parse(r.createdAt)) || !Number.isFinite(Date.parse(r.updatedAt))) {
    throw new Error("Developer change record has invalid identity, content, status or timestamps.");
  }
  validateDeveloperPatch({ files: r.files, patch: r.patch });
  if (r.review && (!FOUNDER.test(r.review.reviewerId) || r.review.reviewerId === r.founderId ||
      !["approved","changes_requested"].includes(r.review.decision) ||
      typeof r.review.notes !== "string" || !Number.isFinite(Date.parse(r.review.at)))) {
    throw new Error("Developer change review metadata is invalid.");
  }
  if (r.founderApproval && (r.founderApproval.founderId !== r.founderId ||
      !Number.isFinite(Date.parse(r.founderApproval.at)))) throw new Error("Developer change Founder approval metadata is invalid.");
  if (r.execution && (!Number.isFinite(Date.parse(r.execution.startedAt)) ||
      (r.execution.finishedAt !== undefined && !Number.isFinite(Date.parse(r.execution.finishedAt))) ||
      !Array.isArray(r.execution.commandIds) || r.execution.commandIds.some(x => typeof x !== "string"))) {
    throw new Error("Developer change execution metadata is invalid.");
  }
  if (r.verification && (typeof r.verification.passed !== "boolean" ||
      typeof r.verification.evidenceRef !== "string" || !r.verification.evidenceRef.trim() ||
      typeof r.verification.summary !== "string" || !r.verification.summary.trim() ||
      !Number.isFinite(Date.parse(r.verification.at)))) throw new Error("Developer change verification metadata is invalid.");
  if (r.rollbackSnapshotId !== undefined && (typeof r.rollbackSnapshotId !== "string" || !r.rollbackSnapshotId.trim())) {
    throw new Error("Developer change rollback snapshot metadata is invalid.");
  }
  if (["reviewed","approved","executing","verifying","completed","rolled_back"].includes(r.status) &&
      r.review?.decision !== "approved") throw new Error("Advanced Developer change status requires independent approval.");
  if (["approved","executing","verifying","completed","rolled_back"].includes(r.status) && !r.founderApproval) {
    throw new Error("Approved Developer change status requires owning Founder approval.");
  }
  if (["executing","verifying","completed","rolled_back"].includes(r.status) && !r.execution) {
    throw new Error("Executed Developer change status requires execution metadata.");
  }
  if (r.status === "completed" && r.verification?.passed !== true) throw new Error("Completed Developer change requires passing verification.");
  if (r.status === "rolled_back" && !r.rollbackSnapshotId) throw new Error("Rolled-back Developer change requires snapshot evidence.");
  return clone(r);
}

/**
 * Founder-scoped persistence for the Developer change lifecycle.
 * File mode uses atomic replacement for a single process; use a transactional
 * database adapter for multi-instance deployments. This store never approves or executes changes.
 */
export class DeveloperChangeStore implements DeveloperChangeRepository {
  private readonly records = new Map<string, DeveloperChangeRequest>();
  private readonly filePath?: string;
  private readonly maxRecords: number;
  private readonly maxBytes: number;
  constructor(filePath?: string, options: DeveloperChangeStoreOptions = {}) {
    this.filePath = filePath ? path.resolve(filePath) : undefined;
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    if (!Number.isInteger(this.maxRecords) || this.maxRecords < 1 || this.maxRecords > 10000) throw new Error("Developer change record limit must be between 1 and 10,000.");
    if (!Number.isInteger(this.maxBytes) || this.maxBytes < 1024 || this.maxBytes > 64 * 1024 * 1024) throw new Error("Developer change storage limit must be between 1 KB and 64 MB.");
    if (this.filePath) this.load();
  }
  async create(change: DeveloperChangeRequest): Promise<DeveloperChangeRequest> {
    const valid = validateRecord(change);
    if (this.records.has(valid.id)) throw new Error("A Developer change with this ID already exists.");
    if (this.records.size >= this.maxRecords) throw new Error("Developer change capacity reached.");
    this.records.set(valid.id, valid);
    try { this.persist(); } catch (error) { this.records.delete(valid.id); throw error; }
    return clone(valid);
  }
  async get(input: { changeId: string; founderId: string }): Promise<DeveloperChangeRequest | null> {
    const record = this.records.get(input.changeId);
    return record && record.founderId === input.founderId ? clone(record) : null;
  }
  async list(input: { founderId: string; limit?: number }): Promise<DeveloperChangeRequest[]> {
    if (!FOUNDER.test(input.founderId)) throw new Error("Founder ID is invalid.");
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Developer change list limit must be between 1 and 500.");
    return [...this.records.values()].filter(r => r.founderId === input.founderId)
      .sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
      .slice(0,limit).map(clone);
  }
  async update(change: DeveloperChangeRequest): Promise<DeveloperChangeRequest> {
    const valid = validateRecord(change);
    const current = this.records.get(valid.id);
    if (!current || current.founderId !== valid.founderId) throw new Error("Developer change not found for this Founder.");
    if (valid.createdAt !== current.createdAt) throw new Error("Developer change creation timestamp is immutable.");
    if (valid.status !== current.status && !ALLOWED_TRANSITIONS[current.status].includes(valid.status)) {
      throw new Error("Developer change lifecycle transition is not allowed: " + current.status + " -> " + valid.status);
    }
    if (current.review && JSON.stringify(valid.review) !== JSON.stringify(current.review)) {
      throw new Error("Independent review metadata is immutable once recorded.");
    }
    if (current.founderApproval && JSON.stringify(valid.founderApproval) !== JSON.stringify(current.founderApproval)) {
      throw new Error("Founder approval metadata is immutable once recorded.");
    }
    if (current.execution && (valid.execution?.startedAt !== current.execution.startedAt ||
        JSON.stringify(valid.execution.commandIds) !== JSON.stringify(current.execution.commandIds))) {
      throw new Error("Developer execution identity is immutable once execution starts.");
    }
    this.records.set(valid.id, valid);
    try { this.persist(); } catch (error) { this.records.set(valid.id,current); throw error; }
    return clone(valid);
  }
  async delete(input: { changeId: string; founderId: string }): Promise<boolean> {
    const current = this.records.get(input.changeId);
    if (!current || current.founderId !== input.founderId) return false;
    if (["approved","executing","verifying","completed","rolled_back"].includes(current.status)) {
      throw new Error("Approved or executed Developer changes cannot be deleted from the audit history.");
    }
    this.records.delete(input.changeId);
    try { this.persist(); } catch (error) { this.records.set(input.changeId,current); throw error; }
    return true;
  }
  private load(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    const stat = fs.lstatSync(this.filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > this.maxBytes) {
      throw new Error("Developer change store must be a bounded regular non-symlink file.");
    }
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(this.filePath,"utf8")); }
    catch { throw new Error("Developer change store is corrupt; refusing to overwrite it."); }
    if (!parsed || typeof parsed !== "object" || (parsed as StoredState).version !== 1 ||
        !Array.isArray((parsed as StoredState).records)) throw new Error("Developer change store has an unsupported or invalid format.");
    const records = (parsed as StoredState).records;
    if (records.length > this.maxRecords) throw new Error("Developer change store exceeds its configured record limit.");
    for (const item of records) {
      const record = validateRecord(item);
      if (this.records.has(record.id)) throw new Error("Developer change store contains duplicate record IDs.");
      this.records.set(record.id,record);
    }
  }
  private persist(): void {
    if (!this.filePath) return;
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
    const dirStat = fs.lstatSync(directory);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) throw new Error("Developer change store directory must be a regular directory.");
    const state: StoredState = {version:1,updatedAt:new Date().toISOString(),records:[...this.records.values()]};
    const serialized = JSON.stringify(state,null,2);
    if (Buffer.byteLength(serialized,"utf8") > this.maxBytes) throw new Error("Developer change store would exceed its configured size limit.");
    const temp = path.join(directory,".developer-changes."+process.pid+"."+randomBytes(8).toString("hex")+".tmp");
    fs.writeFileSync(temp,serialized,{encoding:"utf8",mode:0o600,flag:"wx"});
    try { fs.renameSync(temp,this.filePath); }
    catch(error) { try { fs.rmSync(temp,{force:true}); } catch {} throw error; }
    try { fs.chmodSync(this.filePath,0o600); } catch {}
  }
}
