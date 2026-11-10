import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { CEORunRecord, CEORunRepository } from "./ceo-run-repository.ts";

interface RunFile { version: 1; runs: CEORunRecord[]; }

/** Single-instance persistent CEO run history. Never auto-replays interrupted orchestration. */
export class FileCEORunRepository implements CEORunRepository {
  private readonly filePath: string;
  private queue: Promise<void> = Promise.resolve();
  constructor(directory = process.env.MAYA_DATA_DIR || path.resolve(process.cwd(), "..", "maya-data")) {
    this.filePath = path.join(path.resolve(directory), "ceo-runs.json");
    this.read();
  }

  async create(record: CEORunRecord): Promise<void> {
    await this.mutate(state => {
      if (!record.id || !record.founderId || !record.objective.trim()) throw new Error("CEO run identity and objective are required.");
      if (state.runs.some(item => item.id === record.id)) throw new Error("CEO run ID already exists.");
      if (state.runs.length >= 5000) throw new Error("CEO run history capacity reached; archive before accepting more runs.");
      state.runs.unshift(structuredClone(record));
    });
  }

  async update(founderId: string, record: CEORunRecord): Promise<void> {
    await this.mutate(state => {
      const index = state.runs.findIndex(item => item.id === record.id && item.founderId === founderId);
      if (index < 0) throw new Error("CEO run not found for this Founder.");
      state.runs[index] = structuredClone(record);
    });
  }

  async get(founderId: string, id: string): Promise<CEORunRecord | undefined> {
    await this.queue;
    const run = this.read().runs.find(item => item.id === id && item.founderId === founderId);
    return run ? structuredClone(run) : undefined;
  }

  async list(founderId: string, limit = 50): Promise<CEORunRecord[]> {
    await this.queue;
    const bounded = Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 50, 200));
    return this.read().runs.filter(item => item.founderId === founderId).slice(0, bounded).map(item => structuredClone(item));
  }

  async recoverInterrupted(): Promise<number> {
    let recovered = 0;
    await this.mutate(state => {
      for (const run of state.runs) {
        if (run.status !== "running") continue;
        run.status = "failed";
        run.error = "Server restarted while this CEO orchestration was in progress. It was not replayed; start a new reviewed run.";
        run.updatedAt = new Date().toISOString();
        recovered++;
      }
    });
    return recovered;
  }

  private async mutate(change: (state: RunFile) => void): Promise<void> {
    const operation = this.queue.then(() => {
      const state = this.read();
      change(state);
      this.write(state);
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private read(): RunFile {
    if (!fs.existsSync(this.filePath)) return { version: 1, runs: [] };
    let parsed: any;
    try { parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")); }
    catch { throw new Error("CEO run history is corrupt; refusing to overwrite it."); }
    if (parsed?.version !== 1 || !Array.isArray(parsed.runs)) throw new Error("CEO run history has an unsupported format.");
    for (const run of parsed.runs) {
      if (!run || typeof run.id !== "string" || typeof run.founderId !== "string" || typeof run.objective !== "string" ||
          !["running", "completed", "failed"].includes(run.status) || !Array.isArray(run.assignments) || !Array.isArray(run.findings)) {
        throw new Error("CEO run history contains an invalid record.");
      }
    }
    return parsed as RunFile;
  }

  private write(state: RunFile): void {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(directory, 0o700); } catch {}
    const temp = path.join(directory, `.ceo-runs.${process.pid}.${randomUUID()}.tmp`);
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
    try { fs.renameSync(temp, this.filePath); }
    catch (error) { try { fs.rmSync(temp, { force: true }); } catch {} throw error; }
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
  }
}
