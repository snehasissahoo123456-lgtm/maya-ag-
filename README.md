# Maya — Founder-Controlled AI Operator

Maya is being evolved from the existing web-based Action Engine cockpit into a cloud-coordinated and locally executable AI operator.

## Current repository
- Web cockpit: React/Lit/TypeScript frontend.
- Backend: Node.js, Express, WebSockets.
- AI provider integration: Gemini through a server-side adapter.
- Existing action engine, platform registry, watcher, and task UI are retained as the starting point.

## Current development status
The \`maya/foundation-architecture\` branch adds architecture and task lifecycle foundations, fail-closed authentication, default-deny REST authorization, a session-cookie gate for WebSockets, workspace path containment, honest unsupported-capability responses, and GitHub Actions CI.

The latest verified CI run on the development branch passed dependency installation, TypeScript typechecking, unit tests, and the production build. The Founder sign-in screen now exposes only the configured server-verified password flow; it no longer presents disabled Google/SMS paths, prefilled identity details, browser-stored bearer tokens, or misleading encryption/cloud-exposure claims. Founder password sign-in uses server-side environment credentials and an HttpOnly session cookie; Google OAuth and SMS OTP are disabled because verified providers are not configured. Legacy tasks, memories, and persona preferences persist to a local atomic JSON store. The new task control plane uses a separate file-backed repository with serialized writes, restart recovery for interrupted tasks, and authenticated Express endpoints: GET/POST /api/control-plane/tasks and POST /api/control-plane/tasks/:id/execute. Only one low-risk capability is enabled: reading a non-secret text file inside the enrolled workspace; execution returns the file content and SHA-256 evidence. This control-plane task path now has an opt-in single-process background worker. It is disabled by default (`MAYA_TASK_WORKER_ENABLED=false`); when explicitly enabled, it polls the single-Founder task store and may execute only the low-risk `workspace.read_file` capability. It does not run high-risk/approval tasks, unknown capabilities, or `requires_recovery` tasks; it does not automatically retry failures. The worker is not a durable multi-instance queue or a general-purpose scheduler. A real HTTP integration test starts the production server, verifies unauthenticated denial, signs in with test-only Founder credentials, creates and lists a task, executes the workspace read, checks SHA-256 evidence, and confirms a completed task cannot be run twice. The task repository also rolls back its in-memory mutation if an atomic disk write fails. The capability registry, exact-action approval ledger, task orchestrator, agent manifests, delegation policy, and capability catalog are present. The exact-action approval ledger is now file-backed with atomic replacement, expiry, Founder/task/capability/argument binding, and single-use consumption; authenticated Founder request/decision endpoints are wired. It is still single-instance file storage rather than a database, and no high-risk capabilities are registered. Sessions and audit logs remain in memory; the production database, migrations, background worker, retries, crash-safe side-effect recovery, live agents, PC/VS Code connector, Android app/APK, and external service adapters remain unimplemented. This remains a prototype, not a production autonomous operator.

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
The worker uses the same persisted task repository and orchestrator as the authenticated API. Its internal `worker` identity is granted only the `workspace:read` scope and only the `workspace.read_file` capability is included in the worker's explicit allowlist. The capability remains low-risk and read-only, with path containment, sensitive-file blocking, a 50 KB limit, a 10-second timeout and SHA-256 evidence. Worker activation requires `MAYA_TASK_WORKER_ENABLED=true`; polling is configurable through `MAYA_TASK_WORKER_POLL_MS` and clamped to 1–60 seconds. A single in-process cycle lock prevents overlapping scans. High-risk tasks, unknown capabilities and interrupted `requires_recovery` tasks are skipped. Failed tasks are not automatically retried. The health endpoint reports worker status. Unit and live HTTP integration tests verify the allowlist, recovery behavior, single-cycle lock, no auto-retry and real background completion. This is a limited single-process prototype, not a production queue or 24/7 hosted service.


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
