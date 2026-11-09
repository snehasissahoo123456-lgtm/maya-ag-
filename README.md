# Maya — Founder-Controlled AI Operator

Maya is being evolved from the existing web-based Action Engine cockpit into a cloud-coordinated and locally executable AI operator.

## Current repository
- Web cockpit: React/Lit/TypeScript frontend.
- Backend: Node.js, Express, WebSockets.
- AI provider integration: Gemini through a server-side adapter.
- Existing action engine, platform registry, watcher, and task UI are retained as the starting point.

## Current development status
The \`maya/foundation-architecture\` branch adds architecture and task lifecycle foundations, fail-closed authentication, default-deny REST authorization, a session-cookie gate for WebSockets, workspace path containment, honest unsupported-capability responses, and GitHub Actions CI.

The latest verified CI run on the development branch passed dependency installation, TypeScript typechecking, unit tests, and the production build. The Founder sign-in screen now exposes only the configured server-verified password flow; it no longer presents disabled Google/SMS paths, prefilled identity details, browser-stored bearer tokens, or misleading encryption/cloud-exposure claims. Founder password sign-in uses server-side environment credentials and an HttpOnly session cookie; Google OAuth and SMS OTP are disabled because verified providers are not configured. Legacy tasks, memories, and persona preferences persist to a local atomic JSON store. The new task control plane uses a separate file-backed repository with serialized writes, restart recovery for interrupted tasks, and authenticated Express endpoints: GET/POST /api/control-plane/tasks and POST /api/control-plane/tasks/:id/execute. The task control plane supports safe server-workspace reads, read-only text-file retrieval and Git status summaries from enrolled PCs, and high-risk server-workspace replacement plus enrolled-device file replacement/creation/directory creation and non-overwriting file moves through exact-action Founder approvals. Device actions are available only through the task orchestrator; direct device commands remain read-only. The opt-in single-process task worker is disabled by default (`MAYA_TASK_WORKER_ENABLED=false`); when enabled, it may execute allowlisted reads and only those high-risk tasks whose single-use approval has been consumed. It skips unknown capabilities and `requires_recovery` tasks and does not automatically retry uncertain side effects. It is not a durable multi-instance general-purpose executor. A real HTTP integration test starts the production server, verifies unauthenticated denial, signs in with test-only Founder credentials, creates and lists a task, executes the workspace read, checks SHA-256 evidence, and confirms a completed task cannot be run twice. The task repository also rolls back its in-memory mutation if an atomic disk write fails. The capability registry, exact-action approval ledger, task orchestrator, agent manifests, delegation policy, and capability catalog are present. The exact-action approval ledger is now file-backed with atomic replacement, expiry, Founder/task/capability/argument binding, and single-use consumption; authenticated Founder request/decision endpoints are wired. It is still single-instance file storage rather than a database, Sessions and audit logs remain in memory in the default configuration; several repositories have optional Supabase adapters, but migrations must be applied by the operator. The device bridge is a limited local connector, not general desktop automation. Android runtime, unrestricted browser/app control, external service adapters, production multi-instance hosting and end-to-end 24/7 operation remain incomplete. This remains a bounded prototype, not a production autonomous operator.

## Run locally
Requirements: a supported Node.js runtime and dependencies installed from the repository lockfile.

\`\`\`bash
bun install --frozen-lockfile
bun run dev
\`\`\`

Set \`GEMINI_API_KEY\` in a local, untracked environment file only if using Gemini. Never commit API keys or real OAuth secrets.

## Commands
\`\`\`bash
bun run lint
bun run test
bun run build
\`\`\`

## Read next
- [Product and capability contract](docs/product/agent-capability-contract.md)
- [Target architecture](docs/architecture/target-architecture.md)
- [Security baseline](docs/security/security-baseline.md)
- [Implementation roadmap](docs/implementation/roadmap.md)
- [Android runtime plan](android/README.md)

## Release policy
A task is not complete because a model says it is complete. Maya must provide independently verifiable execution evidence. High-risk actions require explicit Founder approval. Cloud availability does not imply that Android can run arbitrary code continuously in the background.


### Dashboard milestone (maya/dashboard-foundation)
The new Founder dashboard is the default authenticated landing page. It fetches `/api/health` for backend reachability and `/api/control-plane/tasks` for Founder-scoped task records. Task counts and recent task rows are derived from the returned persisted task envelopes; task data is hidden when the authenticated endpoint returns 401 or another error. The dashboard provides navigation to the existing chat/voice workspace, task workspace, memory, platform registry, diagnostics and tool catalog. Hardcoded platform/test/tool count badges and the unverified `Bridge :3000 / Autonomous` status label were removed. The task workspace no longer claims a live 24/7 scheduler; it explicitly states that the background worker is not enabled. The dashboard does not claim that Gemini, integrations, PC/Android connectors, or always-on voice are active.


### Background worker milestone (maya/task-worker-foundation)
The worker uses the same persisted task repository and orchestrator as the authenticated API. Its internal `worker` identity receives only the capability scope needed for each explicitly allowlisted operation: safe workspace reads, read-only local-PC file retrieval, exact-Founder-approved replacement of an existing server-workspace file, and exact-Founder-approved local-PC file replacement, exclusive file creation, single-directory creation beneath an existing parent, and verified non-overwriting file moves. Every mutation requires a single-use approval bound to the exact Founder, task, capability and argument digest. File writes use same-directory temporary files and verification evidence; local directory creation is non-recursive and refuses existing targets. File deletion, shell commands and arbitrary device actions remain blocked. File moves are limited to regular non-sensitive files within the enrolled workspace; destination paths must not exist, and the destination is SHA-256 verified before the source name is removed. Worker activation requires `MAYA_TASK_WORKER_ENABLED=true`; polling is configurable through `MAYA_TASK_WORKER_POLL_MS` and clamped to 1–60 seconds. A single in-process cycle lock prevents overlapping scans. Unknown capabilities and interrupted `requires_recovery` tasks are skipped. Failed tasks are not automatically retried. The health endpoint reports worker status. Unit and live HTTP integration tests verify exact approval, payload/device binding, local bridge relay, recovery behavior, single-cycle lock, no auto-retry and verified completion. This remains a bounded single-process prototype, not unrestricted PC control or a 24/7 hosted service.


## Persistent conversation history (current development branch)

Maya now has a Founder-scoped conversation repository on the `maya/persistent-conversations` development branch. Authenticated users can list, read, and delete their own conversations through `/api/conversations`; chat turns are persisted and restored after a page reload. Data is stored in an atomic, permission-restricted JSON file under `MAYA_DATA_DIR` (default: `../maya-data`). This is single-instance file persistence, not SQLite/PostgreSQL, not encrypted at rest, and not suitable for horizontal scaling until a managed database adapter and deployment-specific key management are added. Conversation data must remain outside the source repository and must be backed up securely.

## Goal planning endpoint (current development branch)

Authenticated `POST /api/agent/plan` uses the configured Gemini provider to propose a plan. The server validates every proposed tool name and argument against the registered tool declaration allowlist, bounds plans to 12 steps, and requires dependencies to reference earlier steps. The endpoint is **plan-only**: it does not execute tools, create queued tasks, or claim completion. It returns a clear provider-unavailable response when Gemini is not configured.

## Persisted plan execution (current development branch)

Validated plans are stored in `goal-plans.json` under `MAYA_DATA_DIR`. Founder-scoped APIs list and inspect plans, approve individual state-mutating steps, and execute plans sequentially. The executor pauses at approval-required steps, binds approvals to a SHA-256 digest of the exact tool and arguments, records result digests as evidence, resumes completed plans without repeating completed steps, and stops on failure without automatic retry. Sensitive tool approval is enforced again inside the executor, independent of model-provided flags. This is still single-process file-backed execution; it is not a durable distributed queue or a production 24/7 worker.

## Saved-memory retrieval and chat mutation policy (current development branch)

Maya retrieves up to five relevant explicitly saved Founder notes for each Gemini chat turn using bounded keyword scoring over note titles, categories and content. Retrieved notes are passed as JSON reference data and explicitly marked as untrusted context, not instructions. Chat-driven tool calls are read-only: memory writes, task queue writes and repository test commands are blocked in the direct chat tool loop and must go through a persisted goal plan with explicit Founder approval. This is keyword retrieval, not embeddings/vector search or autonomous self-modification.

The development UI includes a Goal Plans workspace for generating, reviewing, approving and running persisted plans. It surfaces step state and result digests; it does not expose general shell, browser, device or external-account control.

## Specialist reasoning runtime (current development branch)

Authenticated APIs expose the specialist registry and a bounded specialist-run endpoint. The UI provides a Specialist Agents workspace for Research, Operations, Content, Finance, Developer and CEO roles. Each run is a single Gemini reasoning call with the role's manifest purpose/scopes and relevant saved notes. This runtime has no tools, browser, shell, filesystem, account, payment, deployment or device access; it cannot spawn/delegate to other agents or claim to have executed work. It is a specialist reasoning interface, not yet the full multi-agent workforce.

## CEO specialist orchestration (current development branch)

The authenticated CEO orchestration endpoint uses Gemini to select one to four distinct specialists from the registered manifests, validates the dispatch, runs each specialist sequentially, and asks the CEO layer to synthesize their findings. A dedicated CEO Orchestration workspace exposes this flow. This is a reasoning-only workflow: specialist agents have no tools and cannot execute external actions, spawn more agents or claim work was completed. The run is not yet a durable distributed workflow and its findings are not yet persisted as a long-term project record.

## Supabase conversation database (optional deployment mode)

The conversation repository now supports either local atomic JSON storage or Supabase PostgREST storage. To use Supabase, apply `supabase/migrations/20261108000000_maya_conversations.sql`, set `MAYA_STORAGE_DRIVER=supabase`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` in the **server environment**, then restart Maya. The service-role key is server-only and must never be placed in browser configuration or committed. With `MAYA_STORAGE_DRIVER=file` (default), local JSON storage remains active. The migration enables RLS, denies direct anon/authenticated table access, and exposes only a Founder-scoped atomic append RPC to the service role. Goal plans, tasks and memory notes still use their existing file-backed repositories; their database migration is not complete.

The same Supabase mode also persists validated goal plans and step execution state in `maya_goal_plans`. Plan approval and execution now use the async repository contract, so file and Supabase drivers share the same executor. The database adapter stores plan JSON and step states, while the executor still uses a single-process lock; cross-instance optimistic concurrency/locking is not yet implemented.


## Supabase task queue adapter (development branch)

The `maya/supabase-task-queue` branch adds an optional Supabase PostgREST task repository. It uses a server-only service-role key, Founder-scoped reads, and the `maya_save_task` database RPC to atomically create/update a task only when its immutable Founder owner matches. Apply `supabase/migrations/20261108010000_maya_tasks.sql` in addition to the prior conversation and goal-plan migrations before enabling `MAYA_STORAGE_DRIVER=supabase`. The local JSON task repository remains the default. This adapter does not itself make the worker distributed or multi-instance safe; claim/lease semantics and concurrent worker coordination remain separate release requirements.


## Durable audit trail (development branch)

Maya records append-only Founder-scoped task lifecycle events (enqueue, approval request/decision, execution start, verification, and failure) through an injected audit repository. Local development uses an atomic JSON file. Optional Supabase storage uses the server-only service-role key and an append-only table with no update/delete grants. Apply `supabase/migrations/20261108020000_maya_audit_events.sql` before enabling the Supabase storage driver. Audit metadata intentionally stores action digests and bounded evidence metadata rather than raw task arguments or file contents.


## Supabase approval ledger (development branch)

Approval requests, decisions and single-use consumption now have an asynchronous repository contract. The local file adapter remains the default; optional Supabase mode uses atomic database RPCs to enforce Founder ownership, expiry, exact capability/argument digest matching and one-time consumption. Apply `supabase/migrations/20261108030000_maya_approvals.sql` before using Supabase storage. The service-role key remains server-only. No live Supabase project was modified.


## Supabase task leases (development branch)

When using the Supabase task repository, the worker claims only queued `workspace.read_file` tasks that do not require approval. Claims use `FOR UPDATE SKIP LOCKED`, a bounded owner lease and an explicit release RPC. Expired leases on tasks already marked running/verifying are parked as `requires_recovery`; they are never automatically replayed. Apply `supabase/migrations/20261108040000_maya_task_leases.sql` after the task table migration. Configure `MAYA_TASK_WORKER_LEASE_MS` and `MAYA_TASK_WORKER_MAX_TASKS_PER_CYCLE`. The worker remains opt-in and disabled by default; this is not yet a general-purpose distributed executor.


## Founder memory repository (development branch)

Maya's saved memory notes now use a Founder-scoped repository contract. File mode continues to store notes inside the existing protected `state.json` store. Supabase mode stores notes in `maya_memories`, with a one-time import of the existing local memory notes tracked by `maya_memory_imports`. Search and retrieval remain bounded keyword retrieval; this is persistent memory, not automatic self-training or model fine-tuning. Apply `supabase/migrations/20261108050000_maya_memories.sql` before enabling Supabase storage. No live database was modified.


## Semantic memory retrieval (development branch)

When Gemini embeddings are available, new Supabase memory notes are embedded with `gemini-embedding-001` at 768 dimensions and retrieved through a Founder-filtered pgvector cosine-similarity RPC. Search combines semantic matches with bounded keyword matches so legacy notes without embeddings remain discoverable. If the embedding API is unavailable, the repository falls back to keyword retrieval. Apply `supabase/migrations/20261108060000_maya_semantic_memory.sql` after the base memory migration. This is retrieval augmentation, not model self-training.


## Founder memory feedback (development branch)

The memory workspace now accepts explicit `helpful` / `not_helpful` ratings for a Founder-owned note. File mode stores one current rating per memory; Supabase mode uses a Founder-scoped RPC and persists feedback metadata. Feedback influences retrieval ordering but does not change model weights, prompts, code or permissions. Apply `supabase/migrations/20261108070000_maya_memory_feedback.sql` after the vector memory migration.


## Local device bridge (development branch)

The local device bridge pairs an explicitly enrolled PC using a five-minute one-time code. The local connector uses WSS for remote servers, stores a device token locally with restrictive file permissions, and the server stores only a SHA-256 token hash. Direct Founder-authenticated device commands remain read-only: `system.info`, `workspace.list`, `workspace.read_file`, and `workspace.git_status` (branch and tracked-file status only; no diffs). The task control plane can also read a local non-sensitive text file or bounded Git branch/tracked-change summary without mutation approval and stores the verified result with SHA-256 evidence. Separate task capabilities can replace an existing non-sensitive local text file, exclusively create a new text file, or create one directory beneath an existing parent only after a single-use exact Founder approval; the task approval covers the device ID, path and complete replacement content. The local connector rejects symlinks/path escapes and credential paths, limits reads to 50 KB and file writes/creation to 100 KB, and returns SHA-256 read-back evidence. Existing-file replacement, exclusive new-file creation, and creation of one directory beneath an existing parent are separate high-risk task capabilities; each requires a single-use Founder approval bound to the exact device and path (plus content for file actions). Directory creation is non-recursive and never replaces an existing path. Direct device command APIs remain read-only. No shell, file deletion, browser control, keystrokes, screenshots, or arbitrary application control are enabled. Start the Windows connector with `scripts/Start-Maya-Bridge.ps1`. Device registry is currently local file storage; apply persistent storage/backup and production TLS policies before hosting across multiple server instances.

Apply `supabase/migrations/20261109000000_maya_tasks.sql` after the earlier Supabase conversation and goal-plan migrations to create the Founder-scoped task table and atomic owner-bound save RPC. Supabase task storage is opt-in through `MAYA_STORAGE_DRIVER=supabase`; the default remains local file storage. Live migration application has not been performed.


## Persistent CEO orchestration history (development branch)

Founder-authenticated CEO runs are now recorded in a local, atomic `ceo-runs.json` repository. The UI can list and reopen prior reports. A server restart marks in-progress CEO runs as failed with a recovery note; Maya does not silently rerun specialist work. This repository currently uses single-instance file persistence even when other subsystems are configured for Supabase. A Supabase adapter, retention policy, encrypted backup and live migration remain outstanding.


## Scheduled read-only jobs (development branch)

The Schedules workspace supports one-time, hourly, daily and weekly jobs that read one existing, non-sensitive workspace file up to 50 KB. When due, the scheduler creates an idempotently identified `workspace.read_file` task; the separate task worker performs the allowlisted read and records verification evidence. The scheduler and task worker are both disabled by default. To enable them, set `MAYA_SCHEDULE_WORKER_ENABLED=true` and `MAYA_TASK_WORKER_ENABLED=true` on a single-instance file-storage server. This module does not run arbitrary prompts, shell commands, writes, browser actions, external messages or payments. The default schedule repository is local file storage for a single server. With `MAYA_STORAGE_DRIVER=supabase` and the schedule migration applied, the scheduler uses atomic database leases and can coordinate multiple server instances. The live migration must be applied by the operator; this repository change does not access or mutate the user's Supabase project.


Apply `supabase/migrations/20261110000000_maya_scheduled_jobs.sql` after the existing task lease migration to create the Founder-scoped schedule table and distributed claim/complete/failure/pause RPCs. With `MAYA_STORAGE_DRIVER=supabase`, both the schedule worker and task worker use atomic database leases; configure both worker flags to opt in. The migration is not applied automatically and must be run in the user's Supabase project after review.


Apply `supabase/migrations/20261110010000_maya_ceo_runs.sql` to add Supabase-backed CEO orchestration history with Founder-scoped RLS and a two-hour run lease. When `MAYA_STORAGE_DRIVER=supabase` is selected, CEO run records use this table and expired runs are marked failed rather than replayed. The migration must be applied by the operator; no Supabase project has been changed by this repository work.
