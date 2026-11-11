import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { provisionDeveloperWorkspaceFromGitHub } from "./github-workspace-bootstrap.ts";

const commitSha = "a".repeat(40);
const treeSha = "b".repeat(40);
const content = "export const bootstrapped = true;\n";
const blobSha = createHash("sha1").update("blob " + Buffer.byteLength(content) + "\0").update(content).digest("hex");

function mockFetch(options: { truncated?: boolean; blobContent?: string } = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input); calls.push(url);
    if (url.endsWith("/git/commits/" + commitSha)) {
      return Response.json({ sha: commitSha, commit: { tree: { sha: treeSha } } });
    }
    if (url.endsWith("/git/trees/" + treeSha + "?recursive=1")) {
      return Response.json({ sha: treeSha, truncated: options.truncated ?? false, tree: [
        { path: "src/bootstrap.ts", mode: "100644", type: "blob", sha: blobSha, size: Buffer.byteLength(content) },
      ] });
    }
    if (url.endsWith("/git/blobs/" + blobSha)) {
      return Response.json({ sha: blobSha, content: Buffer.from(options.blobContent ?? content).toString("base64"), encoding: "base64" });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "maya-github-bootstrap-"));
  return { root, workspaceRoot: path.join(root, "workspaces"), queueRoot: path.join(root, "queue") };
}

test("bootstraps a workspace from a pinned GitHub commit and verifies all object hashes", async () => {
  const f = await fixture(); const mock = mockFetch();
  const result = await provisionDeveloperWorkspaceFromGitHub({
    repository: "owner/repo", commitSha, workspaceId: "workspace-001",
    paths: ["src/bootstrap.ts"], workspaceRoot: f.workspaceRoot, queueRoot: f.queueRoot,
    fetchImpl: mock.fetchImpl,
  });
  assert.equal(result.workspace.baselineCommit, commitSha);
  assert.deepEqual(result.selectedPaths, ["src/bootstrap.ts"]);
  assert.equal(await fs.readFile(path.join(result.workspace.workspacePath, "src/bootstrap.ts"), "utf8"), content);
  assert.equal((await fs.readFile(path.join(f.queueRoot, "baselines", "workspace-001.sha"), "utf8")).trim(), commitSha);
  assert.equal(mock.calls.length, 3);
  await fs.rm(f.root, { recursive: true, force: true });
});

test("rejects mutable refs before making any GitHub request", async () => {
  const f = await fixture(); const mock = mockFetch();
  await assert.rejects(() => provisionDeveloperWorkspaceFromGitHub({
    repository: "owner/repo", commitSha: "main", workspaceId: "workspace-001",
    paths: ["src/bootstrap.ts"], workspaceRoot: f.workspaceRoot, queueRoot: f.queueRoot,
    fetchImpl: mock.fetchImpl,
  }), /immutable full commit SHA/);
  assert.equal(mock.calls.length, 0);
  await fs.rm(f.root, { recursive: true, force: true });
});

test("fails closed on truncated GitHub trees and does not publish a workspace", async () => {
  const f = await fixture(); const mock = mockFetch({ truncated: true });
  await assert.rejects(() => provisionDeveloperWorkspaceFromGitHub({
    repository: "owner/repo", commitSha, workspaceId: "workspace-001",
    paths: ["src/bootstrap.ts"], workspaceRoot: f.workspaceRoot, queueRoot: f.queueRoot,
    fetchImpl: mock.fetchImpl,
  }), /truncated/);
  await assert.rejects(() => fs.access(path.join(f.workspaceRoot, "workspace-001")));
  await fs.rm(f.root, { recursive: true, force: true });
});

test("rejects Git blob content tampering before publishing workspace", async () => {
  const f = await fixture(); const mock = mockFetch({ blobContent: "tampered" });
  await assert.rejects(() => provisionDeveloperWorkspaceFromGitHub({
    repository: "owner/repo", commitSha, workspaceId: "workspace-001",
    paths: ["src/bootstrap.ts"], workspaceRoot: f.workspaceRoot, queueRoot: f.queueRoot,
    fetchImpl: mock.fetchImpl,
  }), /hash verification/);
  await assert.rejects(() => fs.access(path.join(f.workspaceRoot, "workspace-001")));
  await fs.rm(f.root, { recursive: true, force: true });
});

test("rejects an empty or invalid explicit path selection", async () => {
  const f = await fixture(); const mock = mockFetch();
  await assert.rejects(() => provisionDeveloperWorkspaceFromGitHub({
    repository: "owner/repo", commitSha, workspaceId: "workspace-001",
    paths: [], workspaceRoot: f.workspaceRoot, queueRoot: f.queueRoot, fetchImpl: mock.fetchImpl,
  }), /explicit list/);
  assert.equal(mock.calls.length, 0);
  await fs.rm(f.root, { recursive: true, force: true });
});
