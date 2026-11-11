import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createDeveloperGitSnapshot, type GitSnapshotSource } from "./developer-git-snapshot.ts";

const gitBlob = (content: string) => createHash("sha1").update("blob " + Buffer.byteLength(content) + "\0").update(content).digest("hex");
function sourceFor(files: Record<string, string>, overrides: Partial<{
  commitSha: string; treeSha: string; truncated: boolean; mode: string; blobContent: string;
}> = {}): GitSnapshotSource {
  const entries = Object.entries(files).map(([path, content]) => ({
    path, mode: overrides.mode ?? "100644", type: "blob", sha: gitBlob(content), size: Buffer.byteLength(content),
  }));
  return {
    async getCommit() { return { sha: overrides.commitSha ?? "a".repeat(40), treeSha: overrides.treeSha ?? "b".repeat(40) }; },
    async getTree() { return { entries, truncated: overrides.truncated ?? false }; },
    async getBlob(sha) {
      const entry = entries.find(item => item.sha === sha)!;
      const content = overrides.blobContent ?? files[entry.path];
      return { sha, content: Buffer.from(content).toString("base64"), encoding: "base64" };
    },
  };
}

test("creates a verified content-hashed snapshot from requested Git blobs", async () => {
  const snapshot = await createDeveloperGitSnapshot({
    source: sourceFor({ "src/app.ts": "export const app = true;", "README.md": "# Maya" }),
    ref: "main", workspaceId: "workspace-123", paths: ["src/app.ts", "README.md"],
  });
  assert.equal(snapshot.baselineCommit, "a".repeat(40));
  assert.equal(snapshot.files.length, 2);
  assert.equal(snapshot.files[0].path, "README.md");
  assert.equal(snapshot.files[0].contentSha256, createHash("sha256").update("# Maya").digest("hex"));
});

test("rejects missing paths, duplicate paths and protected paths", async () => {
  const source = sourceFor({ "src/app.ts": "ok" });
  await assert.rejects(() => createDeveloperGitSnapshot({ source, ref: "main", workspaceId: "workspace-123", paths: ["missing.ts"] }), /not present/);
  await assert.rejects(() => createDeveloperGitSnapshot({ source, ref: "main", workspaceId: "workspace-123", paths: ["src/app.ts", "src/app.ts"] }), /Duplicate file paths/);
  await assert.rejects(() => createDeveloperGitSnapshot({ source, ref: "main", workspaceId: "workspace-123", paths: ["server.ts"] }), /protected/);
});

test("rejects truncated trees, invalid commit identity and unsafe Git modes", async () => {
  await assert.rejects(() => createDeveloperGitSnapshot({ source: sourceFor({ "src/a.ts": "a" }, { truncated: true }), ref: "main", workspaceId: "workspace-123", paths: ["src/a.ts"] }), /truncated/);
  await assert.rejects(() => createDeveloperGitSnapshot({ source: sourceFor({ "src/a.ts": "a" }, { commitSha: "bad" }), ref: "main", workspaceId: "workspace-123", paths: ["src/a.ts"] }), /invalid commit/);
  await assert.rejects(() => createDeveloperGitSnapshot({ source: sourceFor({ "src/a.ts": "a" }, { mode: "120000" }), ref: "main", workspaceId: "workspace-123", paths: ["src/a.ts"] }), /refuses symlinks/);
});

test("rejects altered blobs, malformed base64 and size-limit overruns", async () => {
  const altered = sourceFor({ "src/a.ts": "trusted" }, { blobContent: Buffer.from("tampered").toString("base64") });
  await assert.rejects(() => createDeveloperGitSnapshot({ source: altered, ref: "main", workspaceId: "workspace-123", paths: ["src/a.ts"] }), /object-hash/);
  const large = sourceFor({ "src/a.ts": "123456" });
  await assert.rejects(() => createDeveloperGitSnapshot({ source: large, ref: "main", workspaceId: "workspace-123", paths: ["src/a.ts"], policy: { maxFileBytes: 4, maxTotalBytes: 4 } }), /per-file/);
});

test("rejects non-UTF8 Git blobs", async () => {
  const content = Buffer.from([0xff, 0xfe]).toString("base64");
  const sha = createHash("sha1").update("blob 2\0").update(Buffer.from([0xff, 0xfe])).digest("hex");
  const source: GitSnapshotSource = {
    async getCommit() { return { sha: "a".repeat(40), treeSha: "b".repeat(40) }; },
    async getTree() { return { entries: [{ path: "src/a.ts", mode: "100644", type: "blob", sha, size: 2 }], truncated: false }; },
    async getBlob() { return { sha, content, encoding: "base64" }; },
  };
  await assert.rejects(() => createDeveloperGitSnapshot({ source, ref: "main", workspaceId: "workspace-123", paths: ["src/a.ts"] }), /non-UTF-8/);
});
