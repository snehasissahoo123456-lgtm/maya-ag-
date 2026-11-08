import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ScheduledJobRepository, ScheduledReadJob } from "./scheduled-job-repository.ts";

interface ScheduleFile { version: 1; jobs: ScheduledReadJob[]; }

/** Single-instance atomic scheduler repository. Schedule only read-only workspace file jobs. */
export class FileScheduledJobRepository implements ScheduledJobRepository {
  private readonly filePath: string;
  private queue: Promise<void> = Promise.resolve();
  constructor(directory = process.env.MAYA_DATA_DIR || path.resolve(process.cwd(), "..", "maya-data")) {
    this.filePath = path.join(path.resolve(directory), "scheduled-jobs.json");
    this.read();
  }

  async create(job: ScheduledReadJob): Promise<void> {
    await this.mutate(state => {
      if (!job.id || !job.founderId || !job.title.trim() || job.title.length > 160 || !job.path.trim() || job.path.length > 1024) throw new Error("Schedule identity, title and workspace path are invalid.");
      if (!Number.isFinite(Date.parse(job.nextRunAt))) throw new Error("Scheduled run time must be a valid ISO timestamp.");
      if (job.intervalMs !== null && (!Number.isInteger(job.intervalMs) || job.intervalMs < 60_000 || job.intervalMs > 30 * 24 * 60 * 60_000)) throw new Error("Recurring interval must be between one minute and 30 days.");
      if (job.status !== "active" || job.runCount !== 0 || job.failureCount !== 0) throw new Error("New scheduled jobs must start active with zero counters.");
      if (state.jobs.some(item => item.id === job.id)) throw new Error("Scheduled job ID already exists.");
      if (state.jobs.length >= 2000) throw new Error("Scheduled job capacity reached.");
      state.jobs.unshift(structuredClone(job));
    });
  }

  async get(founderId: string, id: string): Promise<ScheduledReadJob | undefined> {
    await this.queue;
    const job = this.read().jobs.find(item => item.id === id && item.founderId === founderId);
    return job ? structuredClone(job) : undefined;
  }

  async list(founderId: string): Promise<ScheduledReadJob[]> {
    await this.queue;
    return this.read().jobs.filter(item => item.founderId === founderId).sort((a,b) => a.nextRunAt.localeCompare(b.nextRunAt)).map(item => structuredClone(item));
  }

  async listDue(founderId: string, now: string, limit: number): Promise<ScheduledReadJob[]> {
    await this.queue;
    const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
    return this.read().jobs.filter(item => item.founderId === founderId && item.status === "active" && Date.parse(item.nextRunAt) <= Date.parse(now))
      .sort((a,b) => a.nextRunAt.localeCompare(b.nextRunAt)).slice(0, bounded).map(item => structuredClone(item));
  }

  async markEnqueued(founderId: string, id: string, scheduledAt: string, nextRunAt: string | null): Promise<void> {
    await this.mutate(state => {
      const job = state.jobs.find(item => item.id === id && item.founderId === founderId);
      if (!job || job.status !== "active" || job.nextRunAt !== scheduledAt) throw new Error("Scheduled job is no longer active at this run time.");
      job.lastRunAt = scheduledAt;
      job.runCount++;
      job.failureCount = 0;
      job.lastError = undefined;
      job.updatedAt = new Date().toISOString();
      if (nextRunAt) {
        job.nextRunAt = nextRunAt;
        job.status = "active";
      } else {
        job.status = "completed";
      }
    });
  }

  async recordFailure(founderId: string, id: string, error: string): Promise<void> {
    await this.mutate(state => {
      const job = state.jobs.find(item => item.id === id && item.founderId === founderId);
      if (!job) throw new Error("Scheduled job not found for this Founder.");
      job.failureCount++;
      job.lastError = error.slice(0, 1000);
      job.updatedAt = new Date().toISOString();
      if (job.failureCount >= 3) job.status = "paused";
    });
  }

  async pause(founderId: string, id: string): Promise<boolean> {
    let paused = false;
    await this.mutate(state => {
      const job = state.jobs.find(item => item.id === id && item.founderId === founderId && item.status === "active");
      if (!job) return;
      job.status = "paused";
      job.updatedAt = new Date().toISOString();
      paused = true;
    });
    return paused;
  }

  private async mutate(change: (state: ScheduleFile) => void): Promise<void> {
    const operation = this.queue.then(() => { const state = this.read(); change(state); this.write(state); });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private read(): ScheduleFile {
    if (!fs.existsSync(this.filePath)) return { version: 1, jobs: [] };
    let parsed: any;
    try { parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")); }
    catch { throw new Error("Scheduled job storage is corrupt; refusing to overwrite it."); }
    if (parsed?.version !== 1 || !Array.isArray(parsed.jobs)) throw new Error("Scheduled job storage has an unsupported format.");
    for (const job of parsed.jobs) {
      if (!job || typeof job.id !== "string" || typeof job.founderId !== "string" || typeof job.title !== "string" ||
          typeof job.path !== "string" || !["active", "paused", "completed"].includes(job.status) ||
          !Number.isFinite(Date.parse(job.nextRunAt)) || !Number.isInteger(job.runCount) || !Number.isInteger(job.failureCount)) {
        throw new Error("Scheduled job storage contains an invalid record.");
      }
    }
    return parsed as ScheduleFile;
  }

  private write(state: ScheduleFile): void {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(directory, 0o700); } catch {}
    const temp = path.join(directory, `.scheduled-jobs.${process.pid}.${randomUUID()}.tmp`);
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
    try { fs.renameSync(temp, this.filePath); }
    catch (error) { try { fs.rmSync(temp, { force: true }); } catch {} throw error; }
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
  }
}
