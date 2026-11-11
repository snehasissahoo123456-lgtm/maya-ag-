import { createDeveloperGitSnapshot, type GitSnapshotPolicy } from "./developer-git-snapshot.ts";
import { GitHubGitSnapshotSource, type GitHubGitSnapshotSourceOptions } from "./github-git-snapshot-source.ts";
import {
  provisionDeveloperWorkspace,
  type DeveloperWorkspaceProvisionerOptions,
  type ProvisionedDeveloperWorkspace,
} from "./developer-workspace-provisioner.ts";

export interface GitHubWorkspaceBootstrapInput {
  repository: string;
  commitSha: string;
  workspaceId: string;
  paths: readonly string[];
  workspaceRoot: string;
  queueRoot: string;
  getAccessToken?: GitHubGitSnapshotSourceOptions["getAccessToken"];
  fetchImpl?: GitHubGitSnapshotSourceOptions["fetchImpl"];
  snapshotPolicy?: Partial<GitSnapshotPolicy>;
  provisionerPolicy?: Pick<DeveloperWorkspaceProvisionerOptions, "maxFiles" | "maxFileBytes" | "maxTotalBytes">;
}

export interface GitHubWorkspaceBootstrapResult {
  workspace: ProvisionedDeveloperWorkspace;
  selectedPaths: string[];
}

/**
 * Connects the read-only GitHub object source to verified snapshot creation and
 * local workspace provisioning. The caller must supply an immutable commit SHA
 * and an explicit allowlisted file list. This function never applies a patch,
 * creates an approval, enqueues jobs, executes code, merges or deploys.
 */
export async function provisionDeveloperWorkspaceFromGitHub(
  input: GitHubWorkspaceBootstrapInput,
): Promise<GitHubWorkspaceBootstrapResult> {
  if (!input || typeof input.repository !== "string" ||
      typeof input.commitSha !== "string" || !/^[a-f0-9]{40}$/i.test(input.commitSha)) {
    throw new Error("Workspace bootstrap requires a repository and immutable full commit SHA.");
  }
  if (!Array.isArray(input.paths) || input.paths.length < 1 ||
      input.paths.some(item => typeof item !== "string")) {
    throw new Error("Workspace bootstrap requires an explicit list of source paths.");
  }

  const source = new GitHubGitSnapshotSource({
    repository: input.repository,
    ...(input.getAccessToken ? { getAccessToken: input.getAccessToken } : {}),
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  });
  const snapshot = await createDeveloperGitSnapshot({
    source,
    ref: input.commitSha.toLowerCase(),
    workspaceId: input.workspaceId,
    paths: input.paths,
    policy: input.snapshotPolicy,
  });
  const workspace = await provisionDeveloperWorkspace({
    workspaceRoot: input.workspaceRoot,
    queueRoot: input.queueRoot,
    ...input.provisionerPolicy,
  }, snapshot);
  return { workspace, selectedPaths: snapshot.files.map(file => file.path) };
}
