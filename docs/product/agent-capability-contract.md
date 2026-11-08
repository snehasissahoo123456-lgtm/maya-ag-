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

## Verified current implementation

- Founder password authentication backed by server-side environment secrets, timing-safe password comparison, short-lived in-memory sessions, HttpOnly/SameSite cookies, and failed-login throttling.
- Default-deny REST authorization and session-gated WebSocket upgrades.
- Atomic JSON persistence for tasks, memories, and Founder preferences in a single-instance data directory.
- Bounded Gemini function-calling loop with an allowlist for workspace listing/reading, system information, queued task creation/listing, memory save/search, and actual lint/test/build execution.
- Gemini Google Search grounding enabled in chat configuration.
- Sensitive workspace paths are blocked from agent file reads.
- Unconfigured platforms are displayed as degraded, not falsely online.
- GitHub Actions validates locked dependency installation, typecheck, unit tests, and production build.

## Not implemented

- Google OAuth verification, SMS delivery, multi-user/department credentials, persistent session storage, or database migrations.
- Server-side approval ledger bound to exact actions.
- Real task worker/scheduler, retries, event bus, idempotency, checkpoints, or autonomous task execution.
- Agent Factory, CEO/Developer multi-agent delegation, or specialist agents.
- PC connector, VS Code extension, Android Gradle project/APK, kiosk provisioning, or Discord bot.
- General file writing, arbitrary terminal execution, browser control, email/calendar/WhatsApp/notification/deployment integrations.
- Production cloud deployment, persistent cloud volume/database, backups, disaster recovery, and end-to-end operational monitoring.
