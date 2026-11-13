export type DeveloperChangeStatus =
  | "draft" | "submitted" | "reviewed" | "approved" | "executing"
  | "verifying" | "completed" | "rejected" | "rolled_back";

export interface DeveloperChangeRequest {
  id: string;
  founderId: string;
  title: string;
  objective: string;
  workspaceId: string;
  status: DeveloperChangeStatus;
  files: string[];
  patch: string;
  diffSha256: string;
  review?: { reviewerId: string; decision: "approved" | "changes_requested"; notes: string; at: string };
  founderApproval?: { founderId: string; at: string };
  execution?: { startedAt: string; finishedAt?: string; commandIds: string[]; taskId?: string; packageSha256?: string };
  verification?: { passed: boolean; evidenceRef: string; summary: string; at: string };
  rollbackSnapshotId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeveloperChangePolicy {
  maxFiles: number;
  maxPatchChars: number;
  allowedExtensions: readonly string[];
}

const DEFAULT_POLICY: DeveloperChangePolicy = {
  maxFiles: 40,
  maxPatchChars: 120_000,
  allowedExtensions: [".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".css", ".html", ".yml", ".yaml", ".sql", ".ps1", ".sh"],
};
const SECRET_OR_CONTROL_PATH = /(^|\/)(\.env(?:\..*)?|id_rsa|id_ed25519|credentials?(?:\.json)?|secrets?\.ya?ml|.*\.pem|.*\.key)$/i;
const SECRET_CONTENT = /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,})\b|-----BEGIN CERTIFICATE-----)/;

export function validateDeveloperPatch(input: {
  files: readonly string[];
  patch: string;
  policy?: Partial<DeveloperChangePolicy>;
}): { files: string[]; patch: string } {
  const policy = { ...DEFAULT_POLICY, ...input.policy };
  if (!Array.isArray(input.files) || input.files.length < 1 || input.files.length > policy.maxFiles) {
    throw new Error("Developer patch must contain between 1 and the configured maximum number of files.");
  }
  if (typeof input.patch !== "string" || !input.patch.trim() || input.patch.length > policy.maxPatchChars) {
    throw new Error("Developer patch is empty or exceeds the configured size limit.");
  }
  if (SECRET_CONTENT.test(input.patch)) throw new Error("Patch contains a credential or private-key pattern.");
  const files = [...new Set(input.files)];
  if (files.length !== input.files.length) throw new Error("Duplicate file paths are not allowed.");
  for (const file of files) {
    if (typeof file !== "string" || !file.trim() || file.length > 240 || file.includes("\\") ||
      file.startsWith("/") || /^[A-Za-z]:/.test(file) || file.split("/").some(part => !part || part === "." || part === "..") ||
      SECRET_OR_CONTROL_PATH.test(file)) {
      throw new Error("Patch contains an unsafe or protected file path.");
    }
    const extension = file.slice(file.lastIndexOf(".")).toLowerCase();
    if (!policy.allowedExtensions.includes(extension)) throw new Error("File extension is not allowed in the Developer workspace: " + file);
  }
  return { files, patch: input.patch };
}

export function createDeveloperChangeRequest(input: {
  id: string; founderId: string; title: string; objective: string; workspaceId: string;
  files: readonly string[]; patch: string; diffSha256: string; now?: Date;
}): DeveloperChangeRequest {
  for (const [key, value] of Object.entries({ id: input.id, founderId: input.founderId, title: input.title, objective: input.objective, workspaceId: input.workspaceId, diffSha256: input.diffSha256 })) {
    if (typeof value !== "string" || !value.trim()) throw new Error(key + " is required.");
  }
  if (!/^[a-f0-9]{64}$/i.test(input.diffSha256)) throw new Error("A SHA-256 digest of the reviewed diff is required.");
  const safe = validateDeveloperPatch({ files: input.files, patch: input.patch });
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("A valid request timestamp is required.");
  return {
    id: input.id, founderId: input.founderId, title: input.title.trim().slice(0, 160),
    objective: input.objective.trim().slice(0, 4000), workspaceId: input.workspaceId,
    status: "draft", files: safe.files, patch: safe.patch, diffSha256: input.diffSha256.toLowerCase(),
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  };
}

function transition(request: DeveloperChangeRequest, status: DeveloperChangeStatus, now: Date): DeveloperChangeRequest {
  return { ...request, status, updatedAt: now.toISOString() };
}

export function submitDeveloperChange(request: DeveloperChangeRequest, now = new Date()): DeveloperChangeRequest {
  if (request.status !== "draft") throw new Error("Only a draft change can be submitted for review.");
  return transition(request, "submitted", now);
}

export function recordDeveloperReview(request: DeveloperChangeRequest, input: {
  reviewerId: string; decision: "approved" | "changes_requested"; notes: string; now?: Date;
}): DeveloperChangeRequest {
  if (request.status !== "submitted") throw new Error("Only a submitted change can be reviewed.");
  if (!input.reviewerId.trim() || input.reviewerId === request.founderId) throw new Error("An independent reviewer identity is required.");
  const now = input.now ?? new Date();
  const review = { reviewerId: input.reviewerId, decision: input.decision, notes: input.notes.slice(0, 4000), at: now.toISOString() };
  return { ...request, review, status: input.decision === "approved" ? "reviewed" : "rejected", updatedAt: now.toISOString() };
}

export function approveDeveloperChange(request: DeveloperChangeRequest, founderId: string, now = new Date()): DeveloperChangeRequest {
  if (request.status !== "reviewed" || request.review?.decision !== "approved") throw new Error("Independent review approval is required before Founder approval.");
  if (founderId !== request.founderId) throw new Error("Only the owning Founder can approve this change.");
  return { ...request, founderApproval: { founderId, at: now.toISOString() }, status: "approved", updatedAt: now.toISOString() };
}

export function startDeveloperChangeExecution(request: DeveloperChangeRequest, now = new Date()): DeveloperChangeRequest {
  if (request.status !== "approved" || !request.founderApproval) throw new Error("Founder approval is required before execution.");
  return { ...request, status: "executing", execution: { startedAt: now.toISOString(), commandIds: [] }, updatedAt: now.toISOString() };
}

export function recordDeveloperVerification(request: DeveloperChangeRequest, input: {
  passed: boolean; evidenceRef: string; summary: string; now?: Date;
}): DeveloperChangeRequest {
  if (request.status !== "executing" && request.status !== "verifying") throw new Error("Verification can only be recorded after execution starts.");
  if (!input.evidenceRef.trim() || !input.summary.trim()) throw new Error("Verification evidence and summary are required.");
  const now = input.now ?? new Date();
  const verification = { passed: input.passed, evidenceRef: input.evidenceRef, summary: input.summary.slice(0, 4000), at: now.toISOString() };
  return { ...request, verification, status: input.passed ? "completed" : "verifying", updatedAt: now.toISOString(),
    execution: request.execution ? { ...request.execution, finishedAt: now.toISOString() } : undefined };
}

export function markDeveloperChangeRolledBack(request: DeveloperChangeRequest, snapshotId: string, now = new Date()): DeveloperChangeRequest {
  if (!["executing", "verifying", "completed"].includes(request.status)) throw new Error("Only an executed change can be rolled back.");
  if (!snapshotId.trim()) throw new Error("A verified rollback snapshot is required.");
  return { ...request, status: "rolled_back", rollbackSnapshotId: snapshotId, updatedAt: now.toISOString() };
}
