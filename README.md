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
