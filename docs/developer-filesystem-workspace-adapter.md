# Developer filesystem workspace adapter

The adapter in `agent-core/developer-filesystem-workspace-adapter.ts` implements the filesystem side of the existing `DeveloperWorkspaceAdapter` contract. It does not run commands, provision a Git checkout, or grant approval.

## Safety properties

- Requires a dedicated workspace root containing exactly one enrolled workspace.
- Reads the baseline commit marker created by the workspace provisioner.
- Requires a host-provided isolation verifier and reports its measured result; it does not infer isolation from environment variables.
- Rejects path traversal, symlink components, non-regular files, hard-linked targets, duplicate paths, and content-hash mismatches.
- Requires an expected SHA-256 for existing files; `null` means the target must not exist.
- Stages proposed content before replacing targets and writes a durable rollback snapshot first.
- Uses an exclusive lock file to serialize transactions across processes. A stale lock after a crash intentionally fails closed and requires operator inspection.

## Integration requirements

The adapter is not wired into the HTTP server yet. Do not instantiate it with a verifier that simply returns constant values. The deployment supervisor must establish and verify all three properties independently:

1. The workspace is isolated from the application and host filesystem except for the dedicated workspace volume.
2. The sandbox has no network access.
3. No application, Founder, reviewer, cloud, or deployment secrets are mounted into the workspace or sandbox.

The current sandbox worker executes npm scripts in a workspace. A complete execution deployment must also seed a reproducible dependency tree before running those scripts. The adapter deliberately does not run package installation or shell commands.

## Current limitations

- The lock is fail-closed; stale lock cleanup is a manual operator action.
- Filesystem rename operations are transactional with compensating restore, but a multi-file filesystem update is not a single kernel-level atomic operation.
- The adapter assumes its dedicated roots and queue volume are writable only by the trusted Maya service and sandbox supervisor.
- Runtime wiring, end-to-end QA orchestration, and production isolation enforcement remain separate work.
