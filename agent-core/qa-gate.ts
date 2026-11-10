export type QACheckStatus = "passed" | "failed" | "blocked" | "not_run";

export interface QACheckEvidence {
  checkId: string;
  status: QACheckStatus;
  executedAt: string;
  command: string;
  summary: string;
  evidenceRef?: string;
}

export interface QAGateInput {
  requiredChecks: readonly string[];
  evidence: readonly QACheckEvidence[];
  now?: Date;
  maxAgeMs?: number;
}

export interface QAGateFinding {
  checkId: string;
  status: "missing" | "duplicate" | "invalid" | "stale" | QACheckStatus;
  message: string;
}

export interface QAGateResult {
  passed: boolean;
  evaluatedAt: string;
  requiredChecks: string[];
  findings: QAGateFinding[];
}

/**
 * Independent release gate. A model assertion or a green UI label is not evidence:
 * each passing check must have a command, timestamp, summary and evidence reference.
 * This module evaluates supplied evidence; it does not execute tests itself.
 */
export function evaluateQAGate(input: QAGateInput): QAGateResult {
  const now = input.now ?? new Date();
  const maxAgeMs = input.maxAgeMs ?? 24 * 60 * 60 * 1000;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("QA evaluation time must be a valid Date.");
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) throw new Error("QA evidence age limit must be positive.");
  if (!Array.isArray(input.requiredChecks) || input.requiredChecks.length === 0) throw new Error("At least one required QA check must be specified.");
  const requiredChecks = [...new Set(input.requiredChecks)];
  if (requiredChecks.length !== input.requiredChecks.length || requiredChecks.some(id => typeof id !== "string" || !/^[a-z][a-z0-9_.-]{1,79}$/.test(id))) {
    throw new Error("Required QA check IDs must be unique, valid identifiers.");
  }
  const byId = new Map<string, QACheckEvidence[]>();
  for (const item of input.evidence) {
    if (!item || typeof item.checkId !== "string") continue;
    const list = byId.get(item.checkId) ?? [];
    list.push(item);
    byId.set(item.checkId, list);
  }
  const findings: QAGateFinding[] = [];
  for (const checkId of requiredChecks) {
    const matches = byId.get(checkId) ?? [];
    if (matches.length === 0) {
      findings.push({ checkId, status: "missing", message: "No execution evidence was supplied." });
      continue;
    }
    if (matches.length !== 1) {
      findings.push({ checkId, status: "duplicate", message: "Conflicting duplicate evidence entries prevent acceptance." });
      continue;
    }
    const item = matches[0];
    const timestamp = typeof item.executedAt === "string" ? Date.parse(item.executedAt) : NaN;
    if (!["passed", "failed", "blocked", "not_run"].includes(item.status)
      || !Number.isFinite(timestamp)
      || timestamp > now.getTime()
      || typeof item.command !== "string" || !item.command.trim()
      || typeof item.summary !== "string" || !item.summary.trim()
      || (item.status === "passed" && (typeof item.evidenceRef !== "string" || !item.evidenceRef.trim()))) {
      findings.push({ checkId, status: "invalid", message: "Evidence is incomplete or malformed; a pass requires a command, timestamp, summary and evidence reference." });
      continue;
    }
    if (now.getTime() - timestamp > maxAgeMs) {
      findings.push({ checkId, status: "stale", message: "Evidence is older than the permitted QA evidence window." });
      continue;
    }
    findings.push({
      checkId,
      status: item.status,
      message: item.status === "passed" ? "Verified evidence supplied." : `Check is ${item.status}; release acceptance is blocked.`,
    });
  }
  return {
    passed: findings.length === requiredChecks.length && findings.every(finding => finding.status === "passed"),
    evaluatedAt: now.toISOString(),
    requiredChecks,
    findings,
  };
}
