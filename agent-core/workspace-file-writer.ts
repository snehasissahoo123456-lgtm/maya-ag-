import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface WorkspaceWriteResult {
  path: string;
  bytes: number;
  sha256: string;
  verified: true;
}

function digest(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function resolveExistingWorkspaceFile(rootPath: string, requestedPath: string): { root: string; file: string } {
  if (typeof requestedPath !== "string" || !requestedPath.trim() || requestedPath.length > 1024) {
    throw new Error("A valid workspace-relative path is required.");
  }
  if (path.isAbsolute(requestedPath) || path.win32.isAbsolute(requestedPath) ||
      requestedPath.split(/[\\/]/).some(segment => segment === ".." || segment === "")) {
    throw new Error("Workspace writes require a normalized relative path without traversal segments.");
  }
  const root = fs.realpathSync(rootPath);
  const lexical = path.resolve(root, requestedPath);
  const relative = path.relative(root, lexical);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes the enrolled workspace or targets its root.");
  }
  let cursor = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error("Workspace writes through symbolic links are blocked.");
  }
  const file = fs.realpathSync(lexical);
  const realRelative = path.relative(root, file);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new Error("Resolved path escapes the enrolled workspace.");
  }
  const segments = realRelative.split(path.sep).map(part => part.toLowerCase());
  const base = path.basename(file).toLowerCase();
  const sensitive = segments.some(part => [".git", "node_modules", ".maya-data", "secrets", "credentials"].includes(part))
    || base === ".env" || base.startsWith(".env.") || base === ".npmrc" || base === ".netrc"
    || base === "id_rsa" || base.endsWith(".pem") || base.endsWith(".key")
    || base.endsWith(".p12") || base.endsWith(".pfx");
  if (sensitive) throw new Error("Writing secrets and credential files is blocked.");
  return { root, file };
}

export function replaceWorkspaceFile(
  rootPath: string,
  requestedPath: string,
  content: string,
  expectedSha256?: string,
  signal?: AbortSignal,
): WorkspaceWriteResult {
  if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > 100_000) {
    throw new Error("File content must be text no larger than 100 KB.");
  }
  if (expectedSha256 !== undefined && !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error("Expected file SHA-256 must be a 64-character lowercase hexadecimal digest.");
  }
  const { root, file } = resolveExistingWorkspaceFile(rootPath, requestedPath);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Only existing regular files can be replaced; symlinks and new files are blocked.");
  if (stat.size > 100_000) throw new Error("Existing file exceeds the 100 KB write limit.");

  const originalBytes = fs.readFileSync(file);
  const originalText = originalBytes.toString("utf8");
  if (!Buffer.from(originalText, "utf8").equals(originalBytes)) throw new Error("Only valid UTF-8 text files can be replaced.");
  const originalDigest = digest(originalBytes);
  if (expectedSha256 && expectedSha256 !== originalDigest) {
    throw new Error("File changed since the Developer proposal was created; no write performed. Re-read and prepare a new proposal.");
  }

  const temp = path.join(path.dirname(file), `.maya-write.${process.pid}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, content, { encoding: "utf8", mode: stat.mode & 0o777, flag: "wx" });
    if (signal?.aborted) throw new Error("Task execution was cancelled before commit.");

    // Recheck immediately before atomic replacement so stale proposals do not silently overwrite edits.
    const currentBytes = fs.readFileSync(file);
    if (digest(currentBytes) !== originalDigest) {
      throw new Error("File changed while the Developer write was being prepared; no write performed.");
    }
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch {}
    throw error;
  }

  const verifiedBytes = fs.readFileSync(file);
  const verifiedText = verifiedBytes.toString("utf8");
  if (verifiedText !== content) throw new Error("Write verification failed; file content differs from the approved payload.");
  return {
    path: path.relative(root, file),
    bytes: verifiedBytes.byteLength,
    sha256: digest(verifiedBytes),
    verified: true,
  };
}
