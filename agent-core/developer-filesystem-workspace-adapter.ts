import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PreparedDeveloperPatchPackage } from "./developer-patch-package.ts";
import type {
  DeveloperWorkspaceAdapter, DeveloperWorkspaceState, DeveloperWorkspaceApplyResult,
} from "./developer-workspace-executor.ts";
import { validateDeveloperPatch } from "./developer-change-control.ts";

const GIT_SHA = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const WORKSPACE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$/;
const SNAPSHOT_ID = /^snapshot-[a-f0-9-]{36}$/i;
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const inside = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

export interface DeveloperFilesystemIsolation {
  /** Must be established by the host/container supervisor, not inferred from a config flag. */
  verify(): Promise<{ isolated: boolean; networkAccess: boolean; secretsMounted: boolean }>;
}
export interface DeveloperFilesystemWorkspaceOptions {
  workspaceRoot: string;
  queueRoot: string;
  isolation: DeveloperFilesystemIsolation;
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}
interface SnapshotFile {
  path: string;
  existed: boolean;
  content?: string;
  mode?: number;
  contentSha256?: string;
}
interface StoredSnapshot {
  version: 1;
  snapshotId: string;
  workspaceId: string;
  baselineCommit: string;
  createdAt: string;
  files: SnapshotFile[];
}

/**
 * Filesystem implementation of DeveloperWorkspaceAdapter.
 *
 * It never runs commands. It uses precondition hashes, rejects symlinks and
 * path escapes, stages all proposed contents before publication, and records
 * a durable restore snapshot. The caller must supply a real isolation verifier.
 */
export class DeveloperFilesystemWorkspaceAdapter implements DeveloperWorkspaceAdapter {
  private readonly workspaceRoot: string;
  private readonly queueRoot: string;
  private readonly maxFiles: number;
  private readonly maxFileBytes: number;
  private readonly maxTotalBytes: number;
  private readonly locks = new Set<string>();

  private constructor(
    private readonly options: DeveloperFilesystemWorkspaceOptions,
    workspaceRoot: string,
    queueRoot: string,
  ) {
    this.workspaceRoot = workspaceRoot;
    this.queueRoot = queueRoot;
    this.maxFiles = options.maxFiles ?? 40;
    this.maxFileBytes = options.maxFileBytes ?? 256 * 1024;
    this.maxTotalBytes = options.maxTotalBytes ?? 2 * 1024 * 1024;
  }

  static async create(options: DeveloperFilesystemWorkspaceOptions): Promise<DeveloperFilesystemWorkspaceAdapter> {
    if (!options || !options.isolation || typeof options.isolation.verify !== "function") {
      throw new Error("A host-provided isolation verifier is required.");
    }
    for (const [name, value] of Object.entries({
      maxFiles: options.maxFiles ?? 40,
      maxFileBytes: options.maxFileBytes ?? 256 * 1024,
      maxTotalBytes: options.maxTotalBytes ?? 2 * 1024 * 1024,
    })) {
      if (!Number.isInteger(value) || value < 1) throw new Error("Invalid filesystem adapter limit: " + name);
    }
    const workspaceRoot = await thisRoot(path.resolve(options.workspaceRoot));
    const queueRoot = await thisRoot(path.resolve(options.queueRoot));
    const snapshots = path.join(queueRoot, "snapshots");
    const locks = path.join(queueRoot, "locks");
    await fs.mkdir(snapshots, { recursive: true, mode: 0o700 });
    await fs.mkdir(locks, { recursive: true, mode: 0o700 });
    await assertDirectory(snapshots);
    await assertDirectory(locks);
    return new DeveloperFilesystemWorkspaceAdapter(options, workspaceRoot, queueRoot);
  }

  private async currentWorkspace() {
    const entries = await fs.readdir(this.workspaceRoot, { withFileTypes: true });
    const candidates = entries.filter(entry => entry.isDirectory() && WORKSPACE_ID.test(entry.name));
    if (candidates.length !== 1) throw new Error("Adapter requires exactly one enrolled workspace in its dedicated workspace root.");
    const workspaceId = candidates[0].name;
    const workspacePath = path.join(this.workspaceRoot, workspaceId);
    await assertDirectory(workspacePath);
    const real = await fs.realpath(workspacePath);
    if (real !== workspacePath || !inside(this.workspaceRoot, real)) throw new Error("Workspace path resolves outside its enrolled root.");
    const baselineDirectory = path.join(this.queueRoot, "baselines");
    await assertDirectory(baselineDirectory);
    const baselinePath = path.join(baselineDirectory, workspaceId + ".sha");
    const baselineStat = await fs.lstat(baselinePath);
    if (!baselineStat.isFile() || baselineStat.isSymbolicLink() || baselineStat.size > 64) {
      throw new Error("Workspace baseline record is invalid.");
    }
    const baselineCommit = (await fs.readFile(baselinePath, "utf8")).trim();
    if (!GIT_SHA.test(baselineCommit)) throw new Error("Workspace baseline commit is invalid.");
    return { workspaceId, workspacePath, baselineCommit: baselineCommit.toLowerCase() };
  }

  async inspect(): Promise<DeveloperWorkspaceState> {
    const workspace = await this.currentWorkspace();
    const verified = await this.options.isolation.verify();
    if (!verified || typeof verified.isolated !== "boolean" ||
        typeof verified.networkAccess !== "boolean" || typeof verified.secretsMounted !== "boolean") {
      throw new Error("Isolation verifier returned an invalid state.");
    }
    return { ...workspace, ...verified };
  }

  async applyAtomically(input: {
    files: PreparedDeveloperPatchPackage["files"];
    changeId: string;
    packageSha256: string;
  }): Promise<DeveloperWorkspaceApplyResult> {
    const workspace = await this.currentWorkspace();
    const releaseLock = await acquireWorkspaceLock(this.queueRoot, workspace.workspaceId, this.locks);
    try {
      const verified = await this.options.isolation.verify();
      if (!verified?.isolated || verified.networkAccess || verified.secretsMounted) {
        throw new Error("Workspace isolation must be re-verified immediately before applying files.");
      }
      if (!Array.isArray(input.files) || input.files.length < 1 || input.files.length > this.maxFiles ||
          !SHA256.test(input.packageSha256) || !input.changeId.trim()) {
        throw new Error("Workspace apply request is invalid.");
      }
      validateDeveloperPatch({ files: input.files.map(file => file.path), patch: "filesystem-apply" });
      const seen = new Set<string>();
      let totalBytes = 0;
      const staged: Array<{ path: string; target: string; temp: string; content: string }> = [];
      const snapshotFiles: SnapshotFile[] = [];

      for (const file of [...input.files].sort((a, b) => a.path.localeCompare(b.path))) {
        if (seen.has(file.path) || typeof file.content !== "string" ||
            !SHA256.test(file.contentSha256) || sha256(file.content) !== file.contentSha256 ||
            (file.expectedSha256 !== null && !SHA256.test(file.expectedSha256))) {
          throw new Error("Workspace apply contains duplicate paths or invalid content hashes.");
        }
        seen.add(file.path);
        const bytes = Buffer.byteLength(file.content, "utf8");
        if (bytes > this.maxFileBytes) throw new Error("Proposed file exceeds the per-file limit: " + file.path);
        totalBytes += bytes;
        if (totalBytes > this.maxTotalBytes) throw new Error("Proposed patch exceeds the total content limit.");

        const target = await safeTarget(workspace.workspacePath, file.path, true);
        let prior: SnapshotFile;
        try {
          const stat = await fs.lstat(target);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("Target is not a regular unlinked file: " + file.path);
          const oldContent = await fs.readFile(target, "utf8");
          if (file.expectedSha256 === null || sha256(oldContent) !== file.expectedSha256.toLowerCase()) {
            throw new Error("Existing-file precondition mismatch: " + file.path);
          }
          prior = { path: file.path, existed: true, content: oldContent, mode: stat.mode & 0o777, contentSha256: sha256(oldContent) };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          if (file.expectedSha256 !== null) throw new Error("Expected existing file is missing: " + file.path);
          prior = { path: file.path, existed: false };
        }
        snapshotFiles.push(prior);
        const temp = path.join(path.dirname(target), ".maya-stage-" + randomUUID() + ".tmp");
        staged.push({ path: file.path, target, temp, content: file.content });
      }

      const snapshotId = "snapshot-" + randomUUID();
      const snapshot: StoredSnapshot = {
        version: 1, snapshotId, workspaceId: workspace.workspaceId,
        baselineCommit: workspace.baselineCommit, createdAt: new Date().toISOString(),
        files: snapshotFiles,
      };
      const snapshotPath = path.join(this.queueRoot, "snapshots", snapshotId + ".json");
      const serialized = JSON.stringify(snapshot);
      if (Buffer.byteLength(serialized, "utf8") > MAX_SNAPSHOT_BYTES) throw new Error("Rollback snapshot exceeds the storage limit.");
      await fs.writeFile(snapshotPath, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });

      const published: string[] = [];
      try {
        for (const item of staged) {
          await fs.writeFile(item.temp, item.content, { encoding: "utf8", flag: "wx", mode: 0o600 });
        }
        for (const item of staged) {
          await fs.rename(item.temp, item.target);
          published.push(item.path);
        }
      } catch (error) {
        await restoreFiles(workspace.workspacePath, snapshot.files, published);
        throw error;
      } finally {
        await Promise.all(staged.map(item => fs.rm(item.temp, { force: true }).catch(() => undefined)));
      }
      return { snapshotId };
    } finally {
      await releaseLock();
    }
  }

  async restoreSnapshot(snapshotId: string): Promise<void> {
    if (!SNAPSHOT_ID.test(snapshotId)) throw new Error("Invalid rollback snapshot identifier.");
    const workspace = await this.currentWorkspace();
    const releaseLock = await acquireWorkspaceLock(this.queueRoot, workspace.workspaceId, this.locks);
    try {
      const snapshotPath = path.join(this.queueRoot, "snapshots", snapshotId + ".json");
      const stat = await fs.lstat(snapshotPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SNAPSHOT_BYTES) {
        throw new Error("Rollback snapshot is invalid or oversized.");
      }
      const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8")) as StoredSnapshot;
      if (snapshot.version !== 1 || snapshot.snapshotId !== snapshotId ||
          snapshot.workspaceId !== workspace.workspaceId ||
          snapshot.baselineCommit !== workspace.baselineCommit || !Array.isArray(snapshot.files) ||
          snapshot.files.length < 1 || snapshot.files.length > this.maxFiles) {
        throw new Error("Rollback snapshot does not match the current workspace and baseline.");
      }
      validateDeveloperPatch({ files: snapshot.files.map(file => file?.path), patch: "rollback-snapshot" });
      for (const file of snapshot.files) {
        if (typeof file.existed !== "boolean" ||
            (file.existed && (typeof file.content !== "string" || !SHA256.test(file.contentSha256 ?? "") ||
              sha256(file.content) !== file.contentSha256 || !Number.isInteger(file.mode) ||
              (file.mode as number) < 0 || (file.mode as number) > 0o777)) ||
            (!file.existed && (file.content !== undefined || file.mode !== undefined || file.contentSha256 !== undefined))) {
          throw new Error("Rollback snapshot contains an invalid file record.");
        }
      }
      await restoreFiles(workspace.workspacePath, snapshot.files, snapshot.files.map(file => file.path));
    } finally {
      await releaseLock();
    }
  }
}

async function thisRoot(input: string): Promise<string> {
  await fs.mkdir(input, { recursive: true, mode: 0o700 });
  await assertDirectory(input);
  const real = await fs.realpath(input);
  if (real !== input) throw new Error("Workspace roots cannot resolve through symlinks.");
  return real;
}
async function assertDirectory(input: string) {
  const stat = await fs.lstat(input);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Expected a regular non-symlink directory: " + input);
}
async function safeTarget(root: string, relative: string, createParents: boolean): Promise<string> {
  const target = path.resolve(root, relative);
  if (!inside(root, target) || target === root) throw new Error("Workspace file path escapes its root.");
  const parts = relative.split("/");
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Workspace path contains a symlink or non-directory component.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !createParents) throw error;
      await fs.mkdir(current, { mode: 0o700 });
    }
  }
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("Workspace target must be a regular unlinked file.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return target;
}
async function restoreFiles(root: string, files: SnapshotFile[], paths: string[]): Promise<void> {
  const selected = new Set(paths);
  for (const file of [...files].reverse()) {
    if (!selected.has(file.path)) continue;
    const target = await safeTarget(root, file.path, true);
    if (file.existed) {
      if (typeof file.content !== "string" || !Number.isInteger(file.mode)) throw new Error("Rollback snapshot file record is invalid.");
      const temp = path.join(path.dirname(target), ".maya-restore-" + randomUUID() + ".tmp");
      await fs.writeFile(temp, file.content, { encoding: "utf8", flag: "wx", mode: file.mode as number });
      await fs.rename(temp, target);
    } else {
      await fs.rm(target, { force: true });
    }
  }
}

async function acquireWorkspaceLock(queueRoot: string, workspaceId: string, localLocks: Set<string>): Promise<() => Promise<void>> {
  if (localLocks.has(workspaceId)) throw new Error("A workspace transaction is already in progress.");
  const directory = path.join(queueRoot, "locks");
  await assertDirectory(directory);
  const lockPath = path.join(directory, workspaceId + ".lock");
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try {
    handle = await fs.open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Workspace is locked by another process; stale locks require operator review.");
    }
    throw error;
  }
  localLocks.add(workspaceId);
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
  } catch (error) {
    await handle.close();
    await fs.rm(lockPath, { force: true });
    localLocks.delete(workspaceId);
    throw error;
  }
  await handle.close();
  return async () => {
    try { await fs.rm(lockPath); }
    finally { localLocks.delete(workspaceId); }
  };
}
