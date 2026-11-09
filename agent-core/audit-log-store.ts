import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

interface StoredAuditFile<T> {
  version: 1;
  updatedAt: string;
  entries: T[];
}

const SECRET_KEY = /(password|token|secret|api[_-]?key|authorization|cookie|credential|content|prompt|message|output|request[_-]?body|raw[_-]?input)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[MAX_DEPTH]";
  if (typeof value === "string") return value.length > 10_000 ? value.slice(0, 10_000) + "[TRUNCATED]" : value;
  if (Array.isArray(value)) return value.slice(0, 200).map(item => redact(item, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 200)) {
      output[key] = SECRET_KEY.test(key) ? "[REDACTED]" : redact(item, depth + 1);
    }
    return output;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  return String(value);
}

/**
 * Single-instance durable audit history. Writes are atomic and fail closed:
 * callers must not report an audit event as persisted when the disk write fails.
 * Use a transactional shared database for multi-instance deployments.
 */
export class FileAuditLogStore<T extends { id: string }> {
  private readonly filePath: string;
  private readonly maxEntries: number;
  private entries: T[] = [];

  constructor(
    filePath = process.env.MAYA_AUDIT_LOG_PATH ||
      path.join(process.env.MAYA_DATA_DIR || path.resolve(process.cwd(), "..", "maya-data"), "audit.json"),
    maxEntries = 500,
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 10_000) {
      throw new Error("Audit log retention must be between 1 and 10,000 entries.");
    }
    this.filePath = path.resolve(filePath);
    this.maxEntries = maxEntries;
    this.load();
  }

  list(limit = this.maxEntries): T[] {
    const bounded = Math.max(0, Math.min(this.maxEntries, Math.floor(limit)));
    return structuredClone(this.entries.slice(0, bounded));
  }

  append(entry: T): void {
    if (!entry || typeof entry.id !== "string" || !entry.id || entry.id.length > 200) {
      throw new Error("Audit event requires a valid id.");
    }
    const safeEntry = redact(entry) as T;
    const previous = this.entries;
    this.entries = [safeEntry, ...previous].slice(0, this.maxEntries);
    try {
      this.persist();
    } catch (error) {
      this.entries = previous;
      throw error;
    }
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch {
      throw new Error("Audit log store is corrupt; refusing to overwrite it.");
    }
    if (!parsed || typeof parsed !== "object" ||
        (parsed as StoredAuditFile<T>).version !== 1 ||
        !Array.isArray((parsed as StoredAuditFile<T>).entries)) {
      throw new Error("Audit log store has an unsupported or invalid format.");
    }
    const entries = (parsed as StoredAuditFile<T>).entries;
    if (entries.length > this.maxEntries || entries.some(entry =>
      !entry || typeof entry !== "object" || typeof entry.id !== "string" || !entry.id
    )) {
      throw new Error("Audit log store contains invalid records.");
    }
    this.entries = entries.map(entry => redact(entry) as T);
  }

  private persist(): void {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(directory, 0o700); } catch {}
    const state: StoredAuditFile<T> = {
      version: 1,
      updatedAt: new Date().toISOString(),
      entries: this.entries,
    };
    const temp = path.join(directory, `.audit.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`);
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), {
      encoding: "utf8", mode: 0o600, flag: "wx",
    });
    try {
      fs.renameSync(temp, this.filePath);
    } catch (error) {
      try { fs.rmSync(temp, { force: true }); } catch {}
      throw error;
    }
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
  }
}
