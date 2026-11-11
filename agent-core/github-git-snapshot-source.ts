import type { GitBlobRecord, GitCommitRecord, GitSnapshotSource, GitTreeEntry } from "./developer-git-snapshot.ts";

const SHA = /^[a-f0-9]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const API_VERSION = "2022-11-28";

export interface GitHubGitSnapshotSourceOptions {
  repository: string;
  /** Supply a short-lived token from the host's secret store; never persist it in this adapter. */
  getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>;
  fetchImpl?: typeof fetch;
}

interface GitHubCommitPayload { sha?: unknown; commit?: { tree?: { sha?: unknown } }; }
interface GitHubTreePayload { sha?: unknown; truncated?: unknown; tree?: unknown; }
interface GitHubBlobPayload { sha?: unknown; content?: unknown; encoding?: unknown; }

/**
 * Read-only GitHub REST adapter for the verified Developer snapshot pipeline.
 * It accepts only immutable full commit SHAs, never resolves branch names, and
 * leaves object/hash verification to createDeveloperGitSnapshot.
 */
export class GitHubGitSnapshotSource implements GitSnapshotSource {
  private readonly repository: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GitHubGitSnapshotSourceOptions) {
    if (!options || typeof options.repository !== "string" || !REPOSITORY.test(options.repository) ||
        options.repository.includes("..")) {
      throw new Error("GitHub snapshot source requires a valid owner/repository name.");
    }
    if (options.getAccessToken !== undefined && typeof options.getAccessToken !== "function") {
      throw new Error("GitHub access-token provider must be a function.");
    }
    this.repository = options.repository;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string): Promise<T> {
    const token = await this.options.getAccessToken?.();
    if (token !== undefined && token !== null &&
        (typeof token !== "string" || token.trim().length < 1 || /[\r\n]/.test(token))) {
      throw new Error("GitHub access-token provider returned an invalid token.");
    }
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
    };
    if (token) headers.Authorization = "Bearer " + token;
    let response: Response;
    try {
      response = await this.fetchImpl("https://api.github.com/repos/" + this.repository + path, {
        method: "GET", headers, redirect: "error",
      });
    } catch {
      throw new Error("GitHub snapshot request failed before receiving a response.");
    }
    if (!response.ok) {
      const remaining = response.headers.get("x-ratelimit-remaining");
      if (response.status === 403 && remaining === "0") {
        throw new Error("GitHub API rate limit reached; retry after the reset window.");
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error("GitHub denied read access to the requested repository object.");
      }
      if (response.status === 404) throw new Error("Pinned GitHub object was not found.");
      if (response.status === 429) throw new Error("GitHub API throttled the snapshot request.");
      throw new Error("GitHub snapshot request failed with HTTP " + response.status + ".");
    }
    let value: unknown;
    try { value = await response.json(); }
    catch { throw new Error("GitHub returned malformed JSON for a snapshot object."); }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("GitHub returned an invalid snapshot object payload.");
    }
    return value as T;
  }

  async getCommit(ref: string): Promise<GitCommitRecord> {
    if (typeof ref !== "string" || !SHA.test(ref)) {
      throw new Error("GitHub snapshot source requires an immutable 40-character commit SHA.");
    }
    const payload = await this.request<GitHubCommitPayload>("/git/commits/" + ref.toLowerCase());
    const sha = payload.sha;
    const treeSha = payload.commit?.tree?.sha;
    if (typeof sha !== "string" || !SHA.test(sha) || sha.toLowerCase() !== ref.toLowerCase() ||
        typeof treeSha !== "string" || !SHA.test(treeSha)) {
      throw new Error("GitHub commit response does not match the pinned commit identity.");
    }
    return { sha: sha.toLowerCase(), treeSha: treeSha.toLowerCase() };
  }

  async getTree(treeSha: string): Promise<{ entries: readonly GitTreeEntry[]; truncated: boolean }> {
    if (typeof treeSha !== "string" || !SHA.test(treeSha)) {
      throw new Error("GitHub tree lookup requires a valid full tree SHA.");
    }
    const payload = await this.request<GitHubTreePayload>("/git/trees/" + treeSha.toLowerCase() + "?recursive=1");
    if (typeof payload.sha !== "string" || payload.sha.toLowerCase() !== treeSha.toLowerCase() ||
        typeof payload.truncated !== "boolean" || !Array.isArray(payload.tree)) {
      throw new Error("GitHub tree response is incomplete or does not match the requested tree.");
    }
    const entries: GitTreeEntry[] = payload.tree.map((entry: unknown) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error("GitHub tree contains a malformed entry.");
      }
      const item = entry as Record<string, unknown>;
      if (typeof item.path !== "string" || typeof item.mode !== "string" ||
          typeof item.type !== "string" || typeof item.sha !== "string" || !SHA.test(item.sha) ||
          (item.size !== undefined && (!Number.isSafeInteger(item.size) || (item.size as number) < 0))) {
        throw new Error("GitHub tree contains an invalid entry.");
      }
      return {
        path: item.path, mode: item.mode, type: item.type, sha: item.sha.toLowerCase(),
        ...(item.size === undefined ? {} : { size: item.size as number }),
      };
    });
    return { entries, truncated: payload.truncated };
  }

  async getBlob(blobSha: string): Promise<GitBlobRecord> {
    if (typeof blobSha !== "string" || !SHA.test(blobSha)) {
      throw new Error("GitHub blob lookup requires a valid full blob SHA.");
    }
    const payload = await this.request<GitHubBlobPayload>("/git/blobs/" + blobSha.toLowerCase());
    if (typeof payload.sha !== "string" || payload.sha.toLowerCase() !== blobSha.toLowerCase() ||
        typeof payload.content !== "string" || payload.encoding !== "base64") {
      throw new Error("GitHub blob response does not match the requested object or encoding.");
    }
    return { sha: payload.sha.toLowerCase(), content: payload.content, encoding: "base64" };
  }
}
