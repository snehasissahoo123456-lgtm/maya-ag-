import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AuditRepository, MayaAuditEvent } from "./audit-repository.ts";

interface AuditFile { version: 1; events: MayaAuditEvent[]; }

/** Append-only local audit log. No update/delete API is intentionally exposed. */
export class FileAuditRepository implements AuditRepository {
  private readonly filePath: string;
  private queue: Promise<void> = Promise.resolve();
  constructor(directory = process.env.MAYA_DATA_DIR || path.resolve(process.cwd(), "..", "maya-data")) {
    this.filePath = path.join(path.resolve(directory), "audit-events.json");
    this.read();
  }
  async append(event: MayaAuditEvent): Promise<void> {
    const operation = this.queue.then(() => {
      const state = this.read();
      if (state.events.length >= 100_000) throw new Error("Audit log capacity reached; archive before accepting more events.");
      if (state.events.some(item => item.id === event.id)) throw new Error("Audit event ID already exists.");
      state.events.push({ ...structuredClone(event), id: event.id || randomUUID() });
      this.write(state);
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
  async list(founderId: string, limit = 100): Promise<MayaAuditEvent[]> {
    await this.queue;
    const bounded = Math.max(1, Math.min(Math.floor(limit), 500));
    return this.read().events.filter(event => event.founderId === founderId).slice(-bounded).reverse().map(event => structuredClone(event));
  }
  private read(): AuditFile {
    if (!fs.existsSync(this.filePath)) return { version: 1, events: [] };
    let parsed: any;
    try { parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")); }
    catch { throw new Error("Audit log is corrupt; refusing to overwrite it."); }
    if (parsed?.version !== 1 || !Array.isArray(parsed.events)) throw new Error("Audit log has an unsupported or invalid format.");
    for (const event of parsed.events) {
      if (!event || typeof event.id !== "string" || typeof event.founderId !== "string" || typeof event.type !== "string" || !Number.isFinite(Date.parse(event.occurredAt))) {
        throw new Error("Audit log contains an invalid event.");
      }
    }
    return parsed as AuditFile;
  }
  private write(state: AuditFile): void {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(directory, 0o700); } catch {}
    const temp = path.join(directory, `.audit-events.${process.pid}.${randomUUID()}.tmp`);
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
    try { fs.renameSync(temp, this.filePath); }
    catch (error) { try { fs.rmSync(temp, { force: true }); } catch {} throw error; }
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
  }
}
