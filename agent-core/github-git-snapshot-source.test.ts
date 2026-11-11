import assert from "node:assert/strict";
import test from "node:test";
import { GitHubGitSnapshotSource } from "./github-git-snapshot-source.ts";

const commitSha = "a".repeat(40);
const treeSha = "b".repeat(40);
const blobSha = "c".repeat(40);

function response(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), { status, headers });
}
function fetchQueue(payloads: Array<Response | ((url: string, init?: RequestInit) => Response)>) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    const next = payloads.shift();
    if (!next) throw new Error("unexpected request");
    return typeof next === "function" ? next(url, init) : next;
  }) as typeof fetch;
  return { fetchImpl, requests };
}

test("reads pinned commit, recursive tree and base64 blob through read-only GitHub endpoints", async () => {
  const queue = fetchQueue([
    response({ sha: commitSha, commit: { tree: { sha: treeSha } } }),
    response({ sha: treeSha, truncated: false, tree: [
      { path: "src/index.ts", mode: "100644", type: "blob", sha: blobSha, size: 4 },
    ] }),
    response({ sha: blobSha, content: "dGVzdA==", encoding: "base64" }),
  ]);
  const source = new GitHubGitSnapshotSource({
    repository: "owner/repo", fetchImpl: queue.fetchImpl, getAccessToken: () => "short-lived-token",
  });
  assert.deepEqual(await source.getCommit(commitSha), { sha: commitSha, treeSha });
  assert.deepEqual(await source.getTree(treeSha), {
    entries: [{ path: "src/index.ts", mode: "100644", type: "blob", sha: blobSha, size: 4 }],
    truncated: false,
  });
  assert.deepEqual(await source.getBlob(blobSha), { sha: blobSha, content: "dGVzdA==", encoding: "base64" });
  assert.equal(queue.requests.length, 3);
  assert.ok(queue.requests[0].url.endsWith("/git/commits/" + commitSha));
  assert.ok(queue.requests[1].url.endsWith("/git/trees/" + treeSha + "?recursive=1"));
  assert.ok(queue.requests[2].url.endsWith("/git/blobs/" + blobSha));
  for (const request of queue.requests) {
    assert.equal(request.init?.method, "GET");
    assert.equal((request.init?.headers as Record<string, string>).Authorization, "Bearer short-lived-token");
    assert.equal(request.init?.redirect, "error");
  }
});

test("requires immutable full commit SHAs and validates repository identity", async () => {
  assert.throws(() => new GitHubGitSnapshotSource({ repository: "../repo" }), /valid owner\/repository/);
  const queue = fetchQueue([]);
  const source = new GitHubGitSnapshotSource({ repository: "owner/repo", fetchImpl: queue.fetchImpl });
  await assert.rejects(() => source.getCommit("main"), /immutable/);
  await assert.rejects(() => source.getCommit("a".repeat(39)), /immutable/);
  assert.equal(queue.requests.length, 0);
});

test("rejects mismatched commit, tree and blob identities and malformed tree entries", async () => {
  const wrongCommit = new GitHubGitSnapshotSource({
    repository: "owner/repo", fetchImpl: fetchQueue([response({ sha: "d".repeat(40), commit: { tree: { sha: treeSha } } })]).fetchImpl,
  });
  await assert.rejects(() => wrongCommit.getCommit(commitSha), /pinned commit identity/);

  const wrongTree = new GitHubGitSnapshotSource({
    repository: "owner/repo", fetchImpl: fetchQueue([response({ sha: "d".repeat(40), truncated: false, tree: [] })]).fetchImpl,
  });
  await assert.rejects(() => wrongTree.getTree(treeSha), /incomplete/);

  const badEntry = new GitHubGitSnapshotSource({
    repository: "owner/repo", fetchImpl: fetchQueue([response({ sha: treeSha, truncated: false, tree: [{ path: "a", mode: "100644", type: "blob", sha: "bad" }] })]).fetchImpl,
  });
  await assert.rejects(() => badEntry.getTree(treeSha), /invalid entry/);

  const wrongBlob = new GitHubGitSnapshotSource({
    repository: "owner/repo", fetchImpl: fetchQueue([response({ sha: "d".repeat(40), content: "dGVzdA==", encoding: "base64" })]).fetchImpl,
  });
  await assert.rejects(() => wrongBlob.getBlob(blobSha), /does not match/);
});

test("surfaces rate limits and access failures without exposing credentials", async () => {
  const limited = new GitHubGitSnapshotSource({
    repository: "owner/repo",
    fetchImpl: fetchQueue([response({ message: "rate limit" }, 403, { "x-ratelimit-remaining": "0" })]).fetchImpl,
    getAccessToken: () => "do-not-leak-this-token",
  });
  await assert.rejects(() => limited.getCommit(commitSha), /rate limit reached/);
  const denied = new GitHubGitSnapshotSource({
    repository: "owner/repo", fetchImpl: fetchQueue([response({}, 403)]).fetchImpl,
  });
  await assert.rejects(() => denied.getCommit(commitSha), /denied read access/);
});

test("propagates the GitHub truncated-tree signal so snapshot creation can fail closed", async () => {
  const source = new GitHubGitSnapshotSource({
    repository: "owner/repo",
    fetchImpl: fetchQueue([response({ sha: treeSha, truncated: true, tree: [] })]).fetchImpl,
  });
  assert.deepEqual(await source.getTree(treeSha), { entries: [], truncated: true });
});
