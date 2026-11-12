import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const SHA256 = /^[a-f0-9]{64}$/i;
const MAX_ENTRIES = 200_000;
const MAX_BYTES = 1024 * 1024 * 1024;
const inside = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};
const digest = (value: Buffer) => createHash("sha256").update(value).digest("hex");

interface DependencyManifest {
  version: 1;
  packageJsonSha256: string;
  bunLockSha256: string;
}
export interface OfflineDependencySeedOptions {
  workspaceRoot: string;
  sourceNodeModules: string;
  manifestPath: string;
  maxEntries?: number;
  maxBytes?: number;
}
export interface OfflineDependencySeedResult {
  target: string;
  entries: number;
  bytes: number;
  packageJsonSha256: string;
  bunLockSha256: string;
}

async function regularFile(file: string): Promise<Buffer> {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error("Dependency seed inputs must be regular, unlinked files.");
  }
  return fs.readFile(file);
}

async function inspectTree(root: string, directory: string, limits: { entries: number; bytes: number; maxEntries: number; maxBytes: number }): Promise<void> {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    limits.entries++;
    if (limits.entries > limits.maxEntries) throw new Error("Dependency tree exceeds the entry limit.");
    const target = path.join(directory, entry.name);
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) {
      const resolved = await fs.realpath(target);
      if (!inside(root, resolved)) throw new Error("Dependency tree contains a symlink outside its own root.");
      const linked = await fs.stat(target);
      if (!linked.isFile() && !linked.isDirectory()) throw new Error("Dependency symlink target is not a regular file or directory.");
    } else if (stat.isDirectory()) {
      await inspectTree(root, target, limits);
    } else if (stat.isFile()) {
      if (stat.nlink !== 1) throw new Error("Dependency tree contains a hard-linked file.");
      limits.bytes += stat.size;
      if (limits.bytes > limits.maxBytes) throw new Error("Dependency tree exceeds the byte limit.");
    } else {
      throw new Error("Dependency tree contains a special filesystem entry.");
    }
  }
}

async function makeWorkerReadable(directory: string, root: string): Promise<void> {
  await fs.chmod(directory, 0o2770);
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) {
      const resolved = await fs.realpath(target);
      if (!inside(root, resolved)) throw new Error("Copied dependency symlink escapes the workspace.");
    } else if (stat.isDirectory()) {
      await makeWorkerReadable(target, root);
    } else if (stat.isFile()) {
      const mode = stat.mode & 0o777;
      await fs.chmod(target, mode | 0o060 | ((mode & 0o100) ? 0o010 : 0));
    } else {
      throw new Error("Copied dependency tree contains an unsupported filesystem entry.");
    }
  }
}

/**
 * Copies only the image-baked node_modules tree into a disposable workspace.
 * The workspace package.json and bun.lock must match the build-time manifest.
 * No package manager, shell, network request or install script is invoked.
 */
export async function seedOfflineWorkspaceDependencies(options: OfflineDependencySeedOptions): Promise<OfflineDependencySeedResult> {
  const maxEntries = options.maxEntries ?? MAX_ENTRIES;
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new Error("Dependency seed limits must be positive integers.");
  }
  const workspaceRoot = await fs.realpath(path.resolve(options.workspaceRoot));
  const sourceNodeModules = path.resolve(options.sourceNodeModules);
  const sourceStat = await fs.lstat(sourceNodeModules);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink() || await fs.realpath(sourceNodeModules) !== sourceNodeModules) {
    throw new Error("Baked node_modules source must be a canonical, regular directory.");
  }
  const manifestStat = await fs.lstat(options.manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 4096) {
    throw new Error("Build-time dependency manifest is missing or invalid.");
  }
  const manifest = JSON.parse(await fs.readFile(options.manifestPath, "utf8")) as Partial<DependencyManifest>;
  if (manifest.version !== 1 || !SHA256.test(manifest.packageJsonSha256 ?? "") || !SHA256.test(manifest.bunLockSha256 ?? "")) {
    throw new Error("Build-time dependency manifest has an unsupported schema.");
  }

  const packageJson = await regularFile(path.join(workspaceRoot, "package.json"));
  const bunLock = await regularFile(path.join(workspaceRoot, "bun.lock"));
  const packageJsonSha256 = digest(packageJson);
  const bunLockSha256 = digest(bunLock);
  if (packageJsonSha256 !== manifest.packageJsonSha256.toLowerCase() ||
      bunLockSha256 !== manifest.bunLockSha256.toLowerCase()) {
    throw new Error("Workspace package.json or bun.lock differs from the dependency image baseline.");
  }

  const target = path.join(workspaceRoot, "node_modules");
  try {
    await fs.lstat(target);
    throw new Error("Workspace already contains node_modules; refusing to overwrite it.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const sourceLimits = { entries: 0, bytes: 0, maxEntries, maxBytes };
  await inspectTree(sourceNodeModules, sourceNodeModules, sourceLimits);
  try {
    await fs.cp(sourceNodeModules, target, {
      recursive: true,
      force: false,
      errorOnExist: true,
      dereference: false,
      preserveTimestamps: false,
    });
    const targetStat = await fs.lstat(target);
    if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) throw new Error("Seeded node_modules is not a regular directory.");
    const targetLimits = { entries: 0, bytes: 0, maxEntries, maxBytes };
    await inspectTree(workspaceRoot, target, targetLimits);
    await makeWorkerReadable(target, workspaceRoot);
    return {
      target,
      entries: targetLimits.entries,
      bytes: targetLimits.bytes,
      packageJsonSha256,
      bunLockSha256,
    };
  } catch (error) {
    await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
