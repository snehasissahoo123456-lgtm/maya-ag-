import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { transitionTask, type MayaTask } from "./task-lifecycle.ts";
import type { TaskEnvelope, TaskRepository } from "./task-orchestrator.ts";

interface StoredTaskState {
  version: 1;
  updatedAt: string;
  tasks: TaskEnvelope[];
}

/**
 * Single-instance durable repository for the task control plane.
 * This is deliberately file-backed for the current prototype; use a transactional
 * database adapter before running multiple server instances.
 */
export class FileTaskRepository implements TaskRepository {
  private readonly filePath: string;
  private readonly rows = new Map<string, TaskEnvelope>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath = path.join(
    process.env.MAYA_DATA_DIR || path.resolve(process.cwd(), "..", "maya-data"),
    "task-control-plane.json",
  )) {
    this.filePath = path.resolve(filePath);
    this.load();
    this.recoverInterruptedTasks();
  }

  async get(id: string, founderId?: string): Promise<TaskEnvelope | undefined> {
    await this.writeQueue;
    const value = this.rows.get(id);
    if (value && founderId && value.task.founderId !== founderId) return undefined;
    return value ? structuredClone(value) : undefined;
  }

  async list(founderId: string): Promise<TaskEnvelope[]> {
    await this.writeQueue;
    return [...this.rows.values()]
      .filter((value) => value.task.founderId === founderId)
      .map((value) => structuredClone(value));
  }

  async put(envelope: TaskEnvelope): Promise<void> {
    return this.serialize(async () => {
      const existing = this.rows.get(envelope.task.id);
      if (existing && existing.task.founderId !== envelope.task.founderId) {
        throw new Error("Task id is already owned by another Founder.");
      }
      const previous = this.rows.get(envelope.task.id);
      this.rows.set(envelope.task.id, structuredClone(envelope));
      try {
        this.persist();
      } catch (error) {
        if (previous) this.rows.set(envelope.task.id, previous);
        else this.rows.delete(envelope.task.id);
        throw error;
      }
    });
  }

  private serialize<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation);
    this.writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch {
      throw new Error("Task control-plane store is corrupt; refusing to overwrite it.");
    }
    if (!parsed || typeof parsed !== "object" || (parsed as StoredTaskState).version !== 1 || !Array.isArray((parsed as StoredTaskState).tasks)) {
      throw new Error("Task control-plane store has an unsupported or invalid format.");
    }
    for (const envelope of (parsed as StoredTaskState).tasks) {
      if (!envelope?.task?.id || !envelope.task.founderId || !envelope.capability || !envelope.args || typeof envelope.args !== "object") {
        throw new Error("Task control-plane store contains an invalid task record.");
      }
      if (this.rows.has(envelope.task.id)) throw new Error("Task control-plane store contains duplicate task ids.");
      this.rows.set(envelope.task.id, envelope);
    }
  }

  private recoverInterruptedTasks(): void {
    let changed = false;
    for (const [id, envelope] of this.rows) {
      if (envelope.task.status !== "running" && envelope.task.status !== "verifying") continue;
      envelope.task = transitionTask(envelope.task, "requires_recovery", {
        error: "Server restarted while this task was executing; inspect side effects before retrying.",
      });
      this.rows.set(id, envelope);
      changed = true;
    }
    if (changed) this.persist();
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    try { fs.chmodSync(path.dirname(this.filePath), 0o700); } catch {}
    const state: StoredTaskState = {
      version: 1,
      updatedAt: new Date().toISOString(),
      tasks: [...this.rows.values()],
    };
    const tempPath = path.join(path.dirname(this.filePath), `.task-control-plane.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
    fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
    try {
      fs.renameSync(tempPath, this.filePath);
    } catch (error) {
      try { fs.rmSync(tempPath, { force: true }); } catch {}
      throw error;
    }
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
  }
}
