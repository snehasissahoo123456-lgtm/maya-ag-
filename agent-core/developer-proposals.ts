import { randomUUID } from "node:crypto";
import path from "node:path";
import type { TaskOrchestrator } from "./task-orchestrator.ts";

export interface DeveloperFileChangeInput {
  founderId: string;
  path: string;
  expectedSha256: string;
  content: string;
  instruction: string;
}

export interface DeveloperFileChangeReceipt {
  taskId: string;
  status: string;
  capability: "workspace.write_file";
  requiresFounderApproval: true;
  path: string;
  expectedSha256: string;
  contentBytes: number;
}

/**
 * Developer specialists may propose a bounded file replacement, but this service
 * only enqueues a high-risk task. It never writes a file or approves its own proposal.
 */
export class DeveloperProposalService {
  constructor(private readonly tasks: Pick<TaskOrchestrator, "enqueue">) {}

  async proposeFileChange(input: DeveloperFileChangeInput): Promise<DeveloperFileChangeReceipt> {
    if (typeof input.founderId !== "string" || !input.founderId.trim() || input.founderId.length > 256) {
      throw new Error("A verified Founder identity is required.");
    }
    if (typeof input.path !== "string" || !input.path.trim() || input.path.length > 1024 ||
        path.isAbsolute(input.path) || path.win32.isAbsolute(input.path) ||
        input.path.split(/[\\/]/).some(segment => !segment || segment === "." || segment === "..")) {
      throw new Error("Developer changes require a normalized workspace-relative file path.");
    }
    if (!/^[a-f0-9]{64}$/.test(input.expectedSha256)) {
      throw new Error("Developer proposals must include the SHA-256 digest of the exact file version they read.");
    }
    if (typeof input.content !== "string" || Buffer.byteLength(input.content, "utf8") > 100_000) {
      throw new Error("Proposed file content must be text no larger than 100 KB.");
    }
    if (typeof input.instruction !== "string" || !input.instruction.trim() || input.instruction.length > 1000) {
      throw new Error("Developer change instruction must contain 1–1,000 characters.");
    }

    const segments = input.path.split(/[\\/]/).map(segment => segment.toLowerCase());
    const base = segments[segments.length - 1] || "";
    if (segments.some(segment => [".git", "node_modules", ".maya-data", "secrets", "credentials"].includes(segment)) ||
        base === ".env" || base.startsWith(".env.") || base === ".npmrc" || base === ".netrc" ||
        base === "id_rsa" || base.endsWith(".pem") || base.endsWith(".key") || base.endsWith(".p12") || base.endsWith(".pfx")) {
      throw new Error("Developer proposals cannot target secrets, credentials or generated dependency paths.");
    }

    const envelope = await this.tasks.enqueue({
      id: "developer-" + randomUUID(),
      founderId: input.founderId,
      instruction: input.instruction.trim(),
      capability: "workspace.write_file",
      args: {
        path: input.path,
        expectedSha256: input.expectedSha256,
        content: input.content,
      },
      actor: {
        id: "specialist:developer",
        founderId: input.founderId,
        role: "developer",
        scopes: ["workspace:write"],
      },
    });
    if (envelope.capability !== "workspace.write_file" || envelope.task.requiresApproval !== true) {
      throw new Error("Developer proposal was not queued behind the required Founder approval gate.");
    }
    return {
      taskId: envelope.task.id,
      status: envelope.task.status,
      capability: "workspace.write_file",
      requiresFounderApproval: true,
      path: input.path,
      expectedSha256: input.expectedSha256,
      contentBytes: Buffer.byteLength(input.content, "utf8"),
    };
  }
}
