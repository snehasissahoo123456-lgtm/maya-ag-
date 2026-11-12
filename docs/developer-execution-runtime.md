# Developer execution runtime composition

`DeveloperExecutionRuntime` is the composition root for the existing Developer change modules.

## What it connects

- Founder-scoped Developer change storage
- Exact-action, single-use Founder approval ledger
- Filesystem workspace adapter with content preconditions and rollback snapshots
- Developer execution coordinator
- Fixed-command sandbox QA orchestration (typecheck, tests, production build)

## Required host integration

The caller must inject a `DeveloperFilesystemIsolation` verifier that obtains an attestation from a trusted host/container supervisor. It must report whether the enrolled workspace is isolated, whether it can access a network, and whether application secrets are mounted.

The runtime deliberately does not infer isolation from Compose YAML, environment variables, container labels or a user-supplied boolean. If the verifier cannot provide a trustworthy answer, the caller must return a blocked state.

## Lifecycle

1. Create the runtime with persistent change and approval repositories and the host verifier.
2. Call `readiness()`; proceed only when `readyToApply === true`.
3. Request exact-action approval for a prepared patch package.
4. Have the Founder approve the exact approval-ledger record through the existing authenticated control plane.
5. Execute the approved package. The executor rechecks workspace identity, baseline, isolation, content hashes and approval binding.
6. Start the separately operated no-network sandbox worker under its own supervisor.
7. Call `verify()`; the QA orchestrator waits for typecheck, test and build evidence. A missing, malformed, failed or timed-out result triggers rollback to the exact snapshot.

## Deliberate non-features

This module does not start a worker, create a supervisor attestation, execute arbitrary shell commands, install dependencies over a network, merge GitHub branches, deploy, or bypass independent Reviewer and Founder approval.

## Founder readiness endpoint

The authenticated application server exposes `GET /api/developer/runtime/status`. It reports the current Founder-scoped change counts and explicitly lists runtime blockers. This endpoint is diagnostic only; it does not enable execution or attest isolation.

## Current deployment status

The runtime composition is a library and is not enabled by the application server yet. Production activation is blocked until a real host/container supervisor and durable shared storage are integrated and verified. The sandbox worker's Docker profile is configuration, not isolation proof.
