# Maya Implementation Roadmap

Branch: maya/foundation-architecture
Status: Foundation and first security-hardening pass are implemented. Latest CI validates install, typecheck, tests, and production build. No Android APK or production deployment is claimed.

## Phase 0 — Baseline and contracts
- [x] Add a Founder dashboard as the default authenticated landing page; derive backend reachability and task counts from live API responses and remove unsupported integration/automation badges.
- [x] Replace the legacy sign-in mockup with a focused Founder password screen backed by the server-issued HttpOnly session cookie; hide unconfigured Google/SMS paths and remove misleading security claims.
- [x] Capture target cloud + local architecture.
- [x] Define task states and verification gate in shared TypeScript primitives.
- [x] Run repository typecheck, unit tests, and production build in GitHub Actions.
- [ ] Complete route and tool policy mapping, including WebSocket upgrade and every tool adapter.
- [x] Add a production-server HTTP integration test for the authenticated task API and real read-only capability.
- [x] Add repository CI. Branch protection remains unconfigured.

## Phase 1 — Make the existing server safe
- [x] Dashboard only reports backend health and Founder-scoped task records returned by the server; no simulated integration or 24/7 worker status is shown.
- Integrate verified Google OAuth/SMS identity providers, secure session issuance, HttpOnly cookie lifecycle, CSRF/origin controls, and revocation.
- Complete route/tool authorization mapping and add security acceptance tests.
- [x] Add a single-instance file-backed task repository for the new control plane, with serialized writes, corrupt-store fail-closed behavior, interrupted-task recovery, and rollback when durable writes fail. This is not a multi-instance database.
- [x] Persist the exact-action approval ledger to a single-instance file store and expose authenticated Founder request/decision endpoints. No high-risk capability is enabled.
- [x] Implement one read-only workspace-file execution adapter with path containment, secret-file blocking, size limit, and SHA-256 evidence.
- Extend workspace containment to every future file and command adapter; unrestricted shell execution remains disabled.
Exit gate: partial evidence exists for the task API, read-only capability and opt-in single-process read-only worker. Still required: comprehensive route/tool authorization tests, CSRF/origin protection, durable sessions/audit, and security acceptance testing. No privileged action or general-purpose execution worker is enabled.

## Phase 2 — Cloud control plane
- Device registry and device-bound credentials.
- [x] Add an opt-in, single-process worker that polls Founder-scoped queued tasks and executes only the allowlisted low-risk read-only workspace capability; expose worker status in health checks.
- Durable transactional task queue, multi-instance scheduler, bounded retry/backoff, durable event stream, and observability.
- AI provider adapter with server-side secrets and configurable quotas.
- [x] Specialist agent manifests and bounded delegation policy (templates only; live model-backed agents and persistent budgets remain future work).
Exit gate: two devices can share tasks securely; retries and restarts preserve state; approvals are bound to exact actions.

## Phase 3 — PC and VS Code runtime
- Local connector installed separately on Founder-approved PCs.
- Workspace allowlists, sandboxed command runner, file operations, Git integration, and test execution.
- VS Code extension or secure local integration for issue/build/preview workflows.
- Approval gates for destructive shell commands, publishing, deployments, and external communications.
Exit gate: Maya can make a change in a designated test workspace, run real tests, capture logs/diffs, and report evidence without unrestricted host access.

## Phase 4 — Android personal app
- Kotlin + Jetpack Compose app, device enrollment, secure token storage, push notifications, task inbox, voice UI, and approved Android capabilities.
- Offline cache and WorkManager-based deferred sync.
Exit gate: installable and signed test APK; reconnect, revocation, permission denial, and reboot scenarios tested.

## Phase 5 — Dedicated kiosk profile
- Device-owner provisioning guide and Device Policy Controller configuration.
- Maya launcher, Lock Task allowlist, emergency exit/recovery, kiosk health and remote revoke.
- Test on a spare device only; never kiosk-enroll the everyday phone.
Exit gate: documented provisioning and recovery test on dedicated hardware.

## Phase 6 — Company-style multi-agent operations
- Specialist departments (research, engineering, QA, content, operations) defined as bounded agent templates.
- Parent-child delegation with budgets, task scopes, provenance, and human approval boundaries.
- Daily research/learning proposals and monthly controlled release reviews.
Exit gate: sub-agents produce measurable artifacts and test evidence; they cannot create privileges, spend money, publish, or deploy outside policy.

## Release principle
Maya is operational only when actual builds, tests, integrations, device actions, and security acceptance checks have evidence. Roadmap completion, a green dashboard, model-generated text, or a successful API response alone is not proof of real-world execution.


## Conversation persistence module — development branch

- [x] Founder-scoped conversation repository with atomic JSON writes
- [x] Authenticated list/read/delete endpoints
- [x] Persist user and assistant chat turns and restore the latest conversation in the UI
- [x] Unit tests for restart persistence, Founder isolation, and bounded message history
- [ ] Replace single-instance JSON persistence with a transactional database adapter (SQLite/PostgreSQL)
- [ ] Add encryption-at-rest/key-management policy and backup/restore verification
- [ ] Add conversation search, explicit memory extraction/approval, and retrieval evaluation

This module is intentionally described as file-backed persistence, not a production database. It does not itself implement continuous learning.


## Goal planner module — development branch

- [x] Authenticated Gemini-backed goal-to-plan endpoint
- [x] Validate model output as untrusted JSON against registered tool names and argument schemas
- [x] Bound plan size and enforce earlier-step dependencies
- [x] Mark state-mutating proposal steps as requiring Founder approval
- [x] Keep planner strictly plan-only; no implicit execution or task enqueue
- [ ] Persist plans and expose plan review/approval UI
- [ ] Connect approved plans to a dependency-aware executor with idempotency and evidence
- [ ] Add multi-step recovery, retry budgets, and end-to-end execution verification



## Persisted plan execution module — development branch

- [x] Persist validated Founder-scoped plans and step states
- [x] Execute plan steps sequentially through the server tool allowlist
- [x] Pause before memory writes, task queue writes, and test-command execution until explicit Founder approval
- [x] Bind approval to a SHA-256 digest of exact tool arguments
- [x] Record result digests, resume completed steps, and fail closed without automatic retries
- [ ] Add transactional database persistence and cross-process execution locks
- [x] Add a dedicated plan review/approval/execution UI
- [ ] Add capability-level verification contracts and recovery workflows for failed steps



## Memory retrieval and chat mutation policy — development branch

- [x] Retrieve relevant saved Founder notes for each chat turn with bounded keyword ranking
- [x] Delimit retrieved memory as untrusted reference data in the model context
- [x] Block memory writes, task queue writes, and test commands from direct chat tool calls
- [x] Route state-changing operations through persisted plans and exact-action Founder approval
- [ ] Add embeddings/vector search and memory retrieval evaluation
- [ ] Add explicit memory review, correction, expiry and deletion UI
- [ ] Add transactional database storage and encryption/key management

