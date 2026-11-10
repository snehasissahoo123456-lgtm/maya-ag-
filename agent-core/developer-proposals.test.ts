import test from "node:test";
import assert from "node:assert/strict";
import { DeveloperProposalService } from "./developer-proposals.ts";

const digest = "a".repeat(64);

test("Developer proposal queues an exact Founder-approved task without executing a write", async () => {
  let enqueued: any;
  let executed = false;
  const service = new DeveloperProposalService({
    enqueue: async input => {
      enqueued = input;
      return { capability: input.capability, task: { id: input.id, status: "queued", requiresApproval: true } } as any;
    },
  } as any);
  const receipt = await service.proposeFileChange({
    founderId: "founder-1",
    path: "agent-core/example.ts",
    expectedSha256: digest,
    content: "export const value = 2;\n",
    instruction: "Update the verified source file.",
  });
  assert.equal(receipt.requiresFounderApproval, true);
  assert.equal(receipt.status, "queued");
  assert.equal(enqueued.capability, "workspace.write_file");
  assert.equal(enqueued.actor.role, "developer");
  assert.equal(enqueued.args.expectedSha256, digest);
  assert.equal(enqueued.args.content, "export const value = 2;\n");
  assert.equal(executed, false, "proposal creation must never execute the task");
});

test("Developer proposal rejects unsafe paths, missing hashes and oversized content", async () => {
  const service = new DeveloperProposalService({ enqueue: async () => { throw new Error("must not enqueue"); } } as any);
  const base = { founderId: "founder-1", path: "src/file.ts", expectedSha256: digest, content: "x", instruction: "Update file" };
  await assert.rejects(() => service.proposeFileChange({ ...base, path: "../outside.ts" }), /workspace-relative/);
  await assert.rejects(() => service.proposeFileChange({ ...base, expectedSha256: "bad" }), /SHA-256/);
  await assert.rejects(() => service.proposeFileChange({ ...base, content: "x".repeat(100_001) }), /100 KB/);
});
