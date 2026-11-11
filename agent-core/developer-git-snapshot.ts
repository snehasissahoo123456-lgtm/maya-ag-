import { createHash } from "node:crypto";
import { validateDeveloperPatch } from "./developer-change-control.ts";
import type { DeveloperWorkspaceSnapshot } from "./developer-workspace-provisioner.ts";

const GIT_SHA = /^[a-f0-9]{40}$/i;
const PROTECTED = /^(?:\.env(?:\..*)?|\.git(?:\/.*)?|authService\.ts|server\.ts|local-bridge(?:\.ts)?|agent-core\/(?:approval-ledger|developer-change-control|capability-registry)\.ts|\.github\/workflows\/.*|supabase\/migrations\/.*|Dockerfile|docker-compose\.yml|.*(?:^|\/)(?:id_rsa|id_ed25519|credentials?(?:\.json)?|secrets?\.ya?ml|.*\.pem|.*\.key))$/i;
const DEFAULT_LIMITS = { maxFiles: 10_000, maxFileBytes: 2 * 1024 * 1024, maxTotalBytes: 50 * 1024 * 1024 };

export interface GitCommitRecord { sha: string; treeSha: string; }
export interface GitTreeEntry { path: string; mode: string; type: string; sha: string; size?: number; }
export interface GitBlobRecord { sha: string; content: string; encoding: "utf-8" | "base64"; }
export interface GitSnapshotSource {
  getCommit(ref: string): Promise<GitCommitRecord>;
  getTree(treeSha: string): Promise<{ entries: readonly GitTreeEntry[]; truncated: boolean }>;
  getBlob(blobSha: string): Promise<GitBlobRecord>;
}
export interface GitSnapshotPolicy {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

/** Fetches only explicitly requested tracked files and verifies Git's blob object SHA before provisioning. */
export async function createDeveloperGitSnapshot(input: {
  source: GitSnapshotSource;
  ref: string;
  workspaceId: string;
  paths: readonly string[];
  policy?: Partial<GitSnapshotPolicy>;
}): Promise<DeveloperWorkspaceSnapshot> {
  if (!input || !input.source || typeof input.ref !== "string" || !input.ref.trim() ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$/.test(input.workspaceId) ||
      !Array.isArray(input.paths) || input.paths.length < 1) {
    throw new Error("Git snapshot source, ref, workspace ID and explicit file paths are required.");
  }
  const limits = { ...DEFAULT_LIMITS, ...input.policy };
  if (!Number.isInteger(limits.maxFiles) || limits.maxFiles < 1 || limits.maxFiles > 10_000 ||
      !Number.isInteger(limits.maxFileBytes) || limits.maxFileBytes < 1 ||
      !Number.isInteger(limits.maxTotalBytes) || limits.maxTotalBytes < limits.maxFileBytes) {
    throw new Error("Git snapshot size limits are invalid.");
  }
  if (input.paths.length > limits.maxFiles) throw new Error("Git snapshot exceeds its file-count limit.");
  const requested = [...input.paths];
  validateDeveloperPatch({ files: requested, patch: "git-snapshot-selection" });
  if (requested.some(file => PROTECTED.test(file))) {
    throw new Error("Git snapshot selection includes a protected credential, security, runtime or infrastructure path.");
  }
  if (new Set(requested).size !== requested.length) throw new Error("Git snapshot paths must be unique.");

  const commit = await input.source.getCommit(input.ref);
  if (!commit || !GIT_SHA.test(commit.sha) || !GIT_SHA.test(commit.treeSha)) {
    throw new Error("Git source returned an invalid commit or tree SHA.");
  }
  const tree = await input.source.getTree(commit.treeSha);
  if (!tree || tree.truncated || !Array.isArray(tree.entries)) {
    throw new Error("Git tree is missing, malformed or truncated; refusing an incomplete snapshot.");
  }
  const byPath = new Map<string, GitTreeEntry>();
  for (const entry of tree.entries) {
    if (!entry || typeof entry.path !== "string" || byPath.has(entry.path)) {
      throw new Error("Git tree contains an invalid or duplicate path.");
    }
    byPath.set(entry.path, entry);
  }

  let totalBytes = 0;
  const files = [];
  for (const filePath of requested.sort()) {
    const entry = byPath.get(filePath);
    if (!entry) throw new Error("Requested path is not present in the baseline Git tree: " + filePath);
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode) || !GIT_SHA.test(entry.sha)) {
      throw new Error("Git snapshot refuses symlinks, submodules, trees and unsupported file modes: " + filePath);
    }
    if (typeof entry.size === "number" && entry.size > limits.maxFileBytes) {
      throw new Error("Git snapshot file exceeds the per-file limit: " + filePath);
    }
    const blob = await input.source.getBlob(entry.sha);
    if (!blob || blob.sha !== entry.sha || typeof blob.content !== "string" ||
        !["utf-8", "base64"].includes(blob.encoding)) {
      throw new Error("Git blob response does not match the requested object: " + filePath);
    }
    const bytes = blob.encoding === "base64"
      ? Buffer.from(blob.content.replace(/\s/g, ""), "base64")
      : Buffer.from(blob.content, "utf8");
    if (blob.encoding === "base64" && bytes.toString("base64").replace(/=+$/, "") !== blob.content.replace(/\s/g, "").replace(/=+$/, "")) {
      throw new Error("Git blob contains invalid base64 data: " + filePath);
    }
    if (bytes.byteLength > limits.maxFileBytes) throw new Error("Git snapshot file exceeds the per-file limit: " + filePath);
    totalBytes += bytes.byteLength;
    if (totalBytes > limits.maxTotalBytes) throw new Error("Git snapshot exceeds the total byte limit.");
    const content = bytes.toString("utf8");
    if (!Buffer.from(content, "utf8").equals(bytes)) throw new Error("Git snapshot contains non-UTF-8 content: " + filePath);
    const gitBlobSha = createHash("sha1").update("blob " + bytes.byteLength + "\0").update(bytes).digest("hex");
    if (gitBlobSha !== entry.sha.toLowerCase()) throw new Error("Git blob content failed object-hash verification: " + filePath);
    files.push({
      path: filePath,
      content,
      contentSha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return { workspaceId: input.workspaceId, baselineCommit: commit.sha.toLowerCase(), files };
}
