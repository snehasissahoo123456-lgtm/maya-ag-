import { createHash } from "node:crypto";
import type { DeveloperChangeRequest } from "./developer-change-control.ts";
import { validateDeveloperPatch } from "./developer-change-control.ts";

export interface DeveloperPatchFile {
  path: string;
  content: string;
  /** SHA-256 of the exact current file. null means the file must not exist yet. */
  expectedSha256: string | null;
}

export interface PreparedDeveloperPatchPackage {
  version: 1;
  changeId: string;
  founderId: string;
  workspaceId: string;
  baselineCommit: string;
  diffSha256: string;
  packageSha256: string;
  files: Array<{
    path: string;
    content: string;
    expectedSha256: string | null;
    contentSha256: string;
  }>;
  createdAt: string;
}

export interface DeveloperPatchPackagePolicy {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

const DEFAULT_POLICY: DeveloperPatchPackagePolicy = {
  maxFiles: 40,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 2 * 1024 * 1024,
};
const SHA256 = /^[a-f0-9]{64}$/i;
const GIT_SHA = /^[a-f0-9]{40}$/i;
const SECRET_CONTENT = /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,})\b|-----BEGIN CERTIFICATE-----)/;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonical(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Creates an immutable, content-addressed proposal artifact for a future isolated
 * Developer workspace. It never writes to a workspace, runs commands or approves changes.
 */
export function prepareDeveloperPatchPackage(input: {
  change: DeveloperChangeRequest;
  baselineCommit: string;
  files: readonly DeveloperPatchFile[];
  now?: Date;
  policy?: Partial<DeveloperPatchPackagePolicy>;
}): PreparedDeveloperPatchPackage {
  const { change } = input;
  if (!change || (change.status !== "draft" && !(change.status === "approved" && change.review?.decision === "approved" && change.founderApproval?.founderId === change.founderId))) {
    throw new Error("A draft change or independently reviewed and Founder-approved change is required to prepare a patch package.");
  }
  if (!GIT_SHA.test(input.baselineCommit)) throw new Error("A full baseline Git commit SHA is required.");
  if (!Array.isArray(input.files) || input.files.length < 1) throw new Error("At least one proposed file is required.");
  const policy = { ...DEFAULT_POLICY, ...input.policy };
  if (!Number.isInteger(policy.maxFiles) || policy.maxFiles < 1 || policy.maxFiles > 100 ||
      !Number.isInteger(policy.maxFileBytes) || policy.maxFileBytes < 1 ||
      !Number.isInteger(policy.maxTotalBytes) || policy.maxTotalBytes < policy.maxFileBytes) {
    throw new Error("Developer patch package limits are invalid.");
  }
  if (input.files.length > policy.maxFiles) throw new Error("Patch package exceeds its file-count limit.");

  const safe = validateDeveloperPatch({ files: input.files.map(file => file.path), patch: change.patch });
  if (sha256(change.patch) !== change.diffSha256.toLowerCase()) {
    throw new Error("The stored diff digest does not match the proposed patch.");
  }
  if (safe.files.length !== change.files.length || safe.files.some((file, index) => file !== [...change.files].sort()[index])) {
    throw new Error("Patch package paths must exactly match the approved change request file list.");
  }

  const supplied = [...input.files].sort((a, b) => a.path.localeCompare(b.path));
  const normalized: PreparedDeveloperPatchPackage["files"] = [];
  let totalBytes = 0;
  for (const file of supplied) {
    if (typeof file.content !== "string") throw new Error("Proposed file content must be text.");
    if (file.expectedSha256 !== null && (typeof file.expectedSha256 !== "string" || !SHA256.test(file.expectedSha256))) {
      throw new Error("Existing-file preconditions must contain a valid SHA-256 digest.");
    }
    if (SECRET_CONTENT.test(file.content)) throw new Error("Proposed file contains a credential or private-key pattern.");
    const bytes = Buffer.byteLength(file.content, "utf8");
    if (bytes > policy.maxFileBytes) throw new Error("A proposed file exceeds the per-file size limit: " + file.path);
    totalBytes += bytes;
    if (totalBytes > policy.maxTotalBytes) throw new Error("Patch package exceeds its total content size limit.");
    normalized.push({
      path: file.path,
      content: file.content,
      expectedSha256: file.expectedSha256?.toLowerCase() ?? null,
      contentSha256: sha256(file.content),
    });
  }
  const now = input.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("A valid package timestamp is required.");
  const payload = {
    version: 1 as const,
    changeId: change.id,
    founderId: change.founderId,
    workspaceId: change.workspaceId,
    baselineCommit: input.baselineCommit.toLowerCase(),
    diffSha256: change.diffSha256.toLowerCase(),
    files: normalized,
  };
  return { ...payload, packageSha256: sha256(canonical(payload)), createdAt: now.toISOString() };
}

/** Recomputes all package hashes before a downstream executor may consume the artifact. */
export function verifyDeveloperPatchPackage(pkg: PreparedDeveloperPatchPackage): boolean {
  if (!pkg || pkg.version !== 1 || !GIT_SHA.test(pkg.baselineCommit) || !SHA256.test(pkg.packageSha256) ||
      !SHA256.test(pkg.diffSha256) || !Array.isArray(pkg.files) || pkg.files.length < 1) return false;
  const seen = new Set<string>();
  for (const file of pkg.files) {
    if (!file || seen.has(file.path) || !SHA256.test(file.contentSha256) ||
        (file.expectedSha256 !== null && !SHA256.test(file.expectedSha256)) ||
        sha256(file.content) !== file.contentSha256) return false;
    seen.add(file.path);
  }
  const payload = {
    version: pkg.version,
    changeId: pkg.changeId,
    founderId: pkg.founderId,
    workspaceId: pkg.workspaceId,
    baselineCommit: pkg.baselineCommit,
    diffSha256: pkg.diffSha256,
    files: pkg.files,
  };
  return sha256(canonical(payload)) === pkg.packageSha256;
}
