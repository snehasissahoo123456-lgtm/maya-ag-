import type { FounderStateRepository } from "./founder-state-repository.ts";
import fs from "node:fs";
import path from "node:path";

export interface MayaPersistentState<TTask = unknown, TMemory = unknown, TPersona = unknown> {
  tasks: TTask[];
  memories: TMemory[];
  persona: TPersona;
}

/**
 * Small atomic JSON store for single-instance deployments.
 * Place data outside the source tree by default. Use a managed database before horizontal scaling.
 */
export class MayaPersistentStore<TTask = unknown, TMemory = unknown, TPersona = unknown> implements FounderStateRepository {
  private readonly directory: string;
  private readonly filePath: string;

  constructor(directory = process.env.MAYA_DATA_DIR || path.resolve(process.cwd(), "..", "maya-data")) {
    this.directory = path.resolve(directory);
    this.filePath = path.join(this.directory, "state.json");
  }

  async load(_founderId: string, defaults: MayaPersistentState<TTask, TMemory, TPersona>): Promise<MayaPersistentState<TTask, TMemory, TPersona>> {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return {
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : defaults.tasks,
        memories: Array.isArray(parsed.memories) ? parsed.memories : defaults.memories,
        persona: parsed.persona && typeof parsed.persona === "object" ? parsed.persona : defaults.persona,
      };
    } catch {
      return structuredClone(defaults);
    }
  }

  async save(_founderId: string, state: MayaPersistentState<TTask, TMemory, TPersona>): Promise<void> {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(this.directory, 0o700); } catch {}
    const tempPath = path.join(this.directory, `.state.${process.pid}.${Date.now()}.tmp`);
    const payload = JSON.stringify({ version: 1, savedAt: new Date().toISOString(), ...state }, null, 2);
    fs.writeFileSync(tempPath, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try { fs.renameSync(tempPath, this.filePath); }
    catch (error) {
      try { fs.rmSync(tempPath, { force: true }); } catch {}
      throw error;
    }
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
  }
}
