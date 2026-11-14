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



## Specialist reasoning runtime — development branch

- [x] Expose Founder-authenticated specialist registry
- [x] Run bounded Gemini reasoning calls using specialist role manifests
- [x] Provide a dedicated Specialist Agents UI
- [x] Inject relevant saved notes as untrusted reference context
- [x] Enforce reasoning-only boundary with no tools or further delegation
- [ ] Build CEO orchestration and real specialist-to-specialist delegation
- [ ] Add per-agent durable work queues, budgets, concurrency controls and result verification
- [ ] Connect scoped tools through approval-aware adapters



## CEO specialist orchestration — development branch

- [x] CEO selects 1–4 registered specialists with validated dispatch JSON
- [x] Sequential specialist execution with bounded task sizes
- [x] CEO synthesis of specialist findings
- [x] Founder-authenticated orchestration API and dedicated UI
- [x] Prevent recursive CEO/Founder delegation and specialist tool execution
- [ ] Persist orchestration runs, assignments, findings and project status
- [ ] Add cross-agent budgets, concurrency limits, cancellation and resumable queues
- [ ] Allow approved specialists to use scoped tools through the approval ledger



## Supabase conversation database adapter — development branch

- [x] Define async conversation repository contract
- [x] Keep atomic file-backed implementation as the local default
- [x] Add Supabase PostgREST repository with server-only service-role authentication
- [x] Add RLS-enabled schema and atomic Founder-scoped append RPC
- [x] Select storage driver from environment and fail closed when Supabase configuration is incomplete
- [x] Add adapter, factory and async repository tests
- [ ] Migrate goal plans, memory notes, approvals, tasks and audit logs to database repositories
- [ ] Add database backup/restore, retention and encryption verification
- [ ] Apply the migration to the user's Supabase project and run live integration tests after credentials are configured



## Supabase goal plan persistence — development branch

- [x] Define async goal plan repository contract
- [x] Keep local file-backed plan store as default
- [x] Add Supabase PostgREST plan store for plans, approvals and step states
- [x] Add RLS-enabled `maya_goal_plans` table and service-role-only access
- [x] Refactor executor and plan APIs to await repository operations
- [x] Add adapter tests for Founder scoping and updates
- [ ] Add optimistic concurrency/version checks and cross-process plan execution locks
- [ ] Migrate task queue, memory notes, approval ledger and audit logs to database storage



## Supabase task queue persistence — development branch

- [x] Founder-scoped task repository interface and Supabase PostgREST adapter
- [x] Server-side service-role authentication; no database key is exposed to the browser
- [x] Atomic owner-bound task save RPC and immutable task-owner checks
- [x] Founder-filtered task reads/lists and adapter tests
- [ ] Durable approvals and audit event storage
- [ ] Distributed task leases, worker heartbeats and multi-instance idempotency
- [ ] Live Supabase migration/application and end-to-end verification in the user's project


## Durable task audit trail — development branch

- [x] Append-only audit repository interface and local atomic file adapter
- [x] Optional Supabase audit adapter with server-only credentials
- [x] Append-only schema and Founder/time index; no update/delete grants
- [x] Record task enqueue, approval, start, verification and failure lifecycle events
- [x] Authenticated Founder-only audit history endpoint
- [ ] Move approval grants themselves to a transactional database repository
- [ ] Add immutable audit-chain verification / external backup and retention policy


## Transactional approval persistence — development branch

- [x] Async approval repository contract and local file adapter
- [x] Supabase approval table with Founder-scoped listing
- [x] Atomic decision RPC with expiry enforcement
- [x] Atomic exact-action digest verification and single-use consume RPC
- [x] Server uses configured approval repository and audit logs approval lifecycle
- [ ] Verify SQL migration and concurrency behavior against a live Supabase project
- [ ] Add multi-instance task claim/lease and recovery semantics before expanding worker execution


## Distributed task claim leases — development branch

- [x] Supabase atomic claim using row locks and `SKIP LOCKED`
- [x] Bounded lease owner/expiry and explicit release
- [x] Recover expired running/verifying work into `requires_recovery` without replay
- [x] Worker uses claim/release interface and caps tasks per cycle
- [x] Lease claim tests at repository and worker layers
- [ ] Live Supabase concurrency test with two worker processes
- [ ] Heartbeat extension for longer-running capabilities (current worker only runs short read-only capability)
- [ ] Distributed worker monitoring and production hosting/restart policy


## Founder memory persistence — development branch

- [x] Founder-scoped memory repository contract
- [x] Preserve existing local `state.json` memory notes in file mode
- [x] Supabase memory table with one-time legacy import marker and RLS
- [x] Use persistent memory in chat, goal planning, specialist and CEO context
- [x] Founder-scoped save, search, list and delete APIs
- [ ] Vector/semantic retrieval and relevance evaluation
- [ ] Explicit memory extraction proposals, Founder confirmation and feedback-based quality loop
- [ ] Live Supabase migration/import verification and backup/restore tests


## Semantic memory retrieval — development branch

- [x] Gemini document/query embedding provider at 768 dimensions
- [x] pgvector memory column and cosine-similarity HNSW index
- [x] Founder-filtered semantic search RPC
- [x] Hybrid semantic + keyword fallback for legacy/unembedded notes
- [x] HTTP tests for authenticated memory save/list/delete and unauthenticated denial
- [ ] Live vector extension/migration verification in Supabase
- [ ] Relevance benchmark set, precision/recall evaluation and memory feedback scoring
- [ ] Explicit approval workflow for automatically extracted memory candidates


## Memory feedback loop — development branch

- [x] Founder-only helpful/not-helpful feedback endpoint
- [x] File and Supabase feedback repository behavior
- [x] Persist current feedback score/count and incorporate into keyword/vector ranking
- [x] HTTP coverage for authenticated feedback
- [ ] Evaluate ranking impact on a labelled retrieval benchmark
- [ ] Add correction proposals and Founder approval before rewriting memory content


## Secure local device bridge — development branch

- [x] Founder-authenticated one-time device pairing with five-minute expiry
- [x] Store only device-token hashes on the server and local device token in a restricted user-profile file
- [x] Authenticated device inventory, online status, command relay and credential revocation
- [x] Dedicated Devices workspace and Windows PowerShell launcher
- [x] Restrict device commands to system information, workspace listing and bounded text-file reads
- [x] Reject workspace traversal, symlinks and sensitive credential paths
- [x] Test pairing, token storage, Founder isolation, live WebSocket command relay and HTTP authorization
- [ ] Add transactional Supabase device registry and multi-instance connection routing
- [ ] Add audited capability grants and exact-action Founder approval before enabling write, shell or browser-control capabilities
- [ ] Add Windows service installation, secure auto-start, health monitoring and signed updater
- [ ] Add Android remote client and mobile push notification support
- [ ] Run threat modelling and penetration testing before enabling broader PC control

Current connector is intentionally read-only. It is not a general remote desktop, shell, or arbitrary computer-control agent.


## Approved goal-plan background worker — development branch

- [x] Explicit Founder start endpoint for background plan execution
- [x] Opt-in single-process worker resumes only plans marked running
- [x] Resume after a Founder approves the exact pending step digest
- [x] Stop at unapproved state-mutating steps and await Founder approval
- [x] Recover in-flight steps after process restart by parking the plan as failed; never replay uncertain side effects
- [x] Worker status exposed through health endpoint and bounded polling settings
- [ ] Add transactional distributed plan leases before multi-instance deployment
- [ ] Add per-step timeout/heartbeat, cancellation, retry review and evidence contracts
- [ ] Add plan-worker concurrency tests against two real server processes
- [ ] Enable only after the operator configures a single-instance persistent data directory and validates the approval workflow

The plan worker is disabled by default. It currently requires the file storage driver and one server instance; it must not be enabled with Supabase until distributed goal-plan leases exist.


## Persistent CEO orchestration history — development branch

- [x] Founder-scoped durable run records for objectives, assignments, findings, synthesis, timing and status
- [x] Persist successful and failed orchestration outcomes
- [x] Authenticated list and detail endpoints
- [x] CEO workspace history list and report reopening
- [x] Mark interrupted runs failed on server restart; do not silently replay specialist work
- [ ] Add Supabase-backed CEO run repository and RLS migration
- [ ] Add resumable specialist assignments with bounded retries, cancellation and run-level budgets
- [ ] Add durable per-specialist queues and cross-process concurrency control
- [ ] Add report export and evaluation metrics for specialist quality


## Scheduled read-only jobs — development branch

- [x] Founder-scoped one-time and recurring schedule repository
- [x] Authenticated create/list/pause API and dedicated Schedules workspace
- [x] Due-job worker converts schedules into deterministic, idempotent task IDs
- [x] Task worker executes only the registered read-only workspace-file capability
- [x] Repeated enqueue protection if a worker stops between task creation and schedule advancement
- [x] Bounded recurrence interval, per-cycle limit, failure counter and auto-pause after repeated failures
- [x] Require both schedule and task workers to be explicitly enabled
- [x] Add Supabase schedule repository with atomic `FOR UPDATE SKIP LOCKED` leases and owner-bound completion/failure RPCs
- [x] Add migration with service-role-only access and bounded lease expiry
- [ ] Apply migration to the user's Supabase project and verify it against a real configured environment
- [ ] Add richer schedule triggers only after each trigger has an audited, verified capability
- [ ] Add time-zone-aware calendar rules, missed-run policy controls and notification delivery
- [ ] Add real 24/7 hosting, monitoring and restart/backup acceptance tests

Only read-only workspace file jobs are currently schedulable. This is not a general automation scheduler.


## Supabase CEO run history — development branch

- [x] Add Supabase CEO run repository and storage-driver factory
- [x] Persist specialist assignments, findings, synthesis, status and run timing
- [x] Add Founder-scoped RLS/service-role-only migration
- [x] Add bounded run lease and expired-run recovery RPC
- [ ] Apply migration and verify on the configured Supabase project
- [ ] Add heartbeat/lease renewal for unusually long CEO runs
- [ ] Add resumable specialist queues and per-specialist execution budgets
