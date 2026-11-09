# Maya product and capability contract

## Product objective

Maya is intended to become a Founder-controlled AI organization operating system: one authoritative backend, a web cockpit, a local PC runtime, and mobile clients. The current repository is a prototype foundation. This document records the target product contract; it is not a claim that every capability exists today.

## Authority and organization

1. **Founder** — sole root authority. Owns identity, approvals, budgets, connected accounts, device enrollment, emergency stop, and recovery.
2. **CEO / Master Orchestrator** — interprets Founder objectives, researches, decomposes work, proposes departments and specialist agents, delegates only within granted scopes, coordinates work, verifies outputs, and reports blockers.
3. **Developer / Engineering Lead** — designs and builds software, websites, mobile apps, AI agents, databases, automations, and integrations; runs tests; diagnoses failures; proposes reviewable fixes.
4. **Departments and specialist agents** — created only when needed. Each receives a task-scoped identity, explicit tool allowlist, data scope, budget, timeout, and reporting path. Agents cannot grant themselves permissions or approve their own high-risk actions.

## Target work categories

- Research, web investigation, source comparison, competitor analysis, and decision briefs.
- Software engineering: websites, applications, APIs, databases, AI agents, automation, testing, deployment, and maintenance.
- Business operations: planning, market analysis, operations, project tracking, documentation, reporting, and workflow automation.
- Content and media: scripts, short-form content, editing pipelines, graphics, publishing preparation, and analytics.
- Real estate and hospitality: property research, due diligence support, pricing/occupancy analysis, listings, hotel workflows, and customer communications.
- Finance and administration: bookkeeping/ledger integrations, invoice and document workflows, budgeting support, and auditable reporting.
- Education and personal productivity: research notes, learning plans, scheduling, reminders, and knowledge management.
- Communications: email, calendar, chat, voice, Discord, and notifications through explicitly connected providers.

These are target domains. A domain becomes available only after its real provider or local execution adapter is implemented, authorized, tested, and shown as connected.

## Interfaces and runtime targets

- Founder cockpit: task inbox, chat/voice, project status, agent roster, memory, approvals, evidence, audit log, diagnostics, and recovery.
- PC runtime: explicitly enrolled workspace connector, scoped file access, sandboxed command execution, VS Code integration, and revocable device credentials.
- Android personal profile: normal installable app with push notifications, offline queue, consent-based permissions, and supported background execution.
- Dedicated kiosk profile: optional fully managed device-owner enrollment on separate spare hardware only; provisioning may erase the device.
- Discord and web dashboard: additional interfaces to the same backend, not separate brains or duplicated sources of truth.
- Cloud runtime: durable queue and control plane with health monitoring and recovery. 24/7 availability is a deployment objective, not a guarantee of uninterrupted Android background execution.

## Required safety and reliability contract

- No fabricated task completion, fake test results, fake integrations, fake device status, or unsupported zero-error claims.
- Every completed task must include independently verifiable evidence, such as test output, commit, artifact, API response, or external provider receipt.
- High-risk actions require Founder approval bound to the exact action, arguments, target, and expiry.
- Least privilege, scoped credentials, secret redaction, workspace containment, rate limits, audit events, emergency stop, backups, and restore procedures.
- Persistent task, memory, approval, and audit state with migrations and recovery testing.
- Bounded tool calls, retries, budgets, timeouts, idempotency, checkpoints, and human escalation when blocked.
- Continuous improvement means learning from approved memory and verified outcomes. It does not mean modifying its own production code or expanding its permissions without review.

## Intended implementation sequence

1. Foundation and runtime contracts.
2. Organization and identity core.
3. CEO planning and orchestration.
4. Developer execution engine.
5. Agent Factory and specialist registry.
6. Persistent memory and retrieval.
7. Event bus and task queue.
8. Real test and verification pipeline.
9. Monitoring and observability.
10. Safe recovery and self-healing.
11. PC software control center and enrolled connector.
12. Voice and multimodal interaction.
13. Discord interface.
14. Founder web dashboard.
15. Cloud deployment, durable storage, backups, and availability.
16. Performance, cost, and reliability optimization.

## Verified development-branch implementation

The following capabilities exist across the current stacked development branches; they are not all present on `main` until their pull requests are reviewed and merged.

- Founder password authentication backed by server-side environment secrets, timing-safe password comparison, HttpOnly/SameSite session cookies, default-deny REST authorization and session-gated WebSocket upgrades. Sessions are still in-memory in the default configuration.
- Founder dashboard, task queue and approval workspace with live health/task data and honest disabled-worker status.
- Task lifecycle/orchestrator, capability registry, task repository, single-use exact-action approval ledger, SHA-256 action binding, audit events and verification-evidence-gated completion.
- Opt-in background task worker with bounded capability allowlists, recovery handling and no automatic replay of uncertain side effects. It is disabled by default.
- Goal planning and sequential plan execution through the server tool allowlist; exact Founder approval is required for state-mutating steps. A separate opt-in single-process goal-plan worker exists; it is disabled by default.
- Read-only scheduled jobs, bounded CEO orchestration with specialist reasoning, and persistent CEO run history. Specialist agents currently reason within bounded scopes; they are not yet unrestricted tool-using autonomous workers.
- Founder-scoped persistent conversation and memory repositories, keyword/semantic retrieval adapters, feedback scoring and optional Supabase repositories/migrations. Live Supabase migrations and production database validation remain operator tasks.
- Paired local-PC connector with one-time Founder pairing, token-hash storage on the server, WSS for remote connections, revocation, system information, workspace listing/reading and read-only Git status.
- Separate high-risk PC task capabilities for exact-approved file replacement, exclusive file creation, one-level directory creation and non-overwriting file movement. Each mutation requires a single-use Founder approval bound to exact arguments; results include verification evidence. Direct device command APIs remain read-only.
- GitHub Actions checks locked dependency installation, TypeScript typecheck, unit/integration tests, production build, Compose configuration and Docker image build on the current device-control development chain.

## Not implemented or not production-ready

- Verified Google OAuth, SMS delivery, multi-user/department identity, persistent session storage and live application of database migrations.
- Distributed device registry/connection routing, distributed plan-worker leases, and live two-process concurrency validation for every worker.
- Full Agent Factory, dynamic department creation, durable per-agent queues, unrestricted CEO-to-specialist tool delegation, and production-grade budget metering.
- Production PC service installation, signed connector updates, VS Code extension, Android app/APK, kiosk provisioning and Discord bot.
- Arbitrary terminal/shell execution, browser automation, keystrokes, screenshots, arbitrary app control, permanent file deletion and external email/calendar/WhatsApp/payment/deployment actions.
- Production cloud deployment, validated persistent hosting, backups, disaster recovery, security penetration testing and end-to-end 24/7 operations.

Maya remains a bounded development prototype. The presence of a capability adapter or migration file does not mean the corresponding external service is connected or production-validated.
