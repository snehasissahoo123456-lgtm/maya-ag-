# Maya — Master Operating Scope and Completion Register

**Status:** Authoritative product requirements and implementation checklist  
**Product:** Maya, private Founder-operated agentic company operating system  
**Owner:** Founder  
**Rule:** A requirement in this document is a target, not evidence that the capability exists. Mark an item implemented only when code, tests, integration configuration, and the required runtime evidence exist. Mark it operational only after an end-to-end test in the target environment.

## 1. Product objective

Maya must become a secure, persistent, multi-agent operating system that can receive a Founder objective, understand it, plan the work, assign specialist agents, use approved tools and integrations, execute real work, independently verify outcomes, recover safely from failures, and report evidence.

The required lifecycle is:

`Founder request → intent and risk classification → plan → task/dependency graph → delegation → approval gates → execution → independent verification → recovery or completion → report and audit`

Maya must not be reduced to a chat interface, a collection of reasoning-only agents, or a set of disconnected feature demos. All work-capable modules must converge on shared identity, permissions, task state, memory, audit, approvals, scheduling, observability, and recovery contracts.

## 2. Founder experience and control plane

- [ ] Founder sign-in, secure session lifecycle, logout, session revocation, device/session inventory, and account recovery.
- [ ] Founder dashboard showing live system health, active tasks, queued work, blocked work, approvals, agents, schedules, integrations, alerts, costs/usage where available, and recent outcomes.
- [ ] Unified text chat and voice interface with streaming status, tool activity, cancellation, clarification, and task hand-off.
- [ ] English default; Founder-selected English, Hindi, and Odia support; retain the user's selected language and switch only when requested or clearly needed.
- [ ] Every long-running request becomes a durable project/task record with an ID, owner, status, timestamps, dependencies, risk, assigned agent, and evidence.
- [ ] Founder can inspect the plan before execution, edit scope, prioritize, pause, resume, cancel, reassign, approve, reject, and request a second opinion.
- [ ] Approval inbox shows exact action, target, arguments/digest, risk, consequences, expiry, and whether approval is one-time or recurring.
- [ ] Notifications for completion, failures, approval requests, security events, service outages, and scheduled reports; configurable channels and quiet hours.
- [ ] Searchable history of conversations, projects, decisions, reports, files, and task evidence with Founder-scoped access.
- [ ] Responsive UI for desktop, laptop, tablet, and mobile; accessible keyboard navigation and clear status semantics.
- [ ] Exportable task/project reports, daily summaries, and PDF/CSV/JSON artifacts where appropriate.
- [ ] Founder can inspect why Maya selected a plan, agent, model, tool, or approval requirement; record concise decision rationale without exposing hidden chain-of-thought.

## 3. Central reasoning and orchestration brain

- [ ] Convert natural-language requests into structured objectives, constraints, deliverables, deadlines, budgets, and success criteria.
- [ ] Ask a focused clarification when an essential fact is missing; do not silently invent requirements.
- [ ] Break objectives into dependency-aware plans and atomic tasks with explicit inputs, outputs, owners, and verification criteria.
- [ ] Maintain project context across sessions using durable, searchable, Founder-scoped memory.
- [ ] Distinguish facts, user-provided instructions, external research, assumptions, and unverified claims.
- [ ] Route tasks to the best available model/provider by capability, privacy, latency, reliability, and configured cost limits.
- [ ] Support configured cloud models and optional local/offline models; degrade gracefully when a provider is unavailable.
- [ ] Use bounded tool/function calling with schema validation, argument validation, capability checks, timeouts, budgets, and output limits.
- [ ] Detect ambiguity, contradictions, stale context, missing permissions, unavailable integrations, and unsafe requests before acting.
- [ ] Maintain task state and durable checkpoints across process restarts; never infer completion from a model response alone.
- [ ] Support cancellation and cooperative stop signals across orchestration and delegated work.
- [ ] Use idempotency keys, leases, concurrency limits, retry policies, dead-letter/recovery queues, and duplicate-execution prevention.
- [ ] Separate planning, execution, and verification; independent QA must not simply repeat the executing agent's assertion.
- [ ] Provide bounded reflection on failures: classify, collect evidence, propose repair, test repair, and request approval where required. No unreviewed self-granting of permissions.

## 4. Agent hierarchy and workforce

- [ ] Founder is the ultimate authority; Maya is the central orchestrator; department leads coordinate specialist agents.
- [ ] Support configurable agent hierarchy and delegation depth, including the long-term target of 100+ specialist agents without hard-coding an arbitrary count.
- [ ] Agent registry includes stable identity, role, purpose, model, tools, scopes, limits, version, health, and owner.
- [ ] CEO/Operations lead can route work across departments, track dependencies, resolve conflicts, and produce a consolidated report.
- [ ] Specialist agents can receive a bounded task packet, access only authorized context/tools, return structured results and evidence, and escalate blockers.
- [ ] Delegation must preserve parent task, Founder, project, permission, deadline, and approval context.
- [ ] Child agents cannot expand their own permissions, approve their own high-risk actions, or bypass parent policy.
- [ ] Parallel execution for independent tasks; serialized execution for dependent or conflicting mutations.
- [ ] Agent health, timeouts, heartbeat, load, concurrency, failure rate, and version are observable.
- [ ] Agent creation, editing, disabling, retiring, and tool-scope changes require authorized administrative control and audit.
- [ ] Independent reviewer/QA agent for material outputs, code, financial analyses, and external-facing deliverables.

### Department coverage

Each department must have a manifest, specialist roles, permitted tools, task templates, verification standards, and escalation policy.

- [ ] **CEO / Strategy:** objective tracking, prioritization, business plans, decision briefs, cross-department coordination.
- [ ] **Research / Intelligence:** web research, source validation, competitive intelligence, market maps, due diligence, citation-backed briefs.
- [ ] **Developer / Engineering:** requirements, architecture, code changes, tests, debugging, reviews, CI, releases, rollback and maintenance.
- [ ] **Product / Design:** user research, PRDs, UX flows, prototypes, design systems, accessibility and usability audits.
- [ ] **Operations / Project Management:** SOPs, task boards, dependencies, capacity, vendors, recurring processes and operational reporting.
- [ ] **Finance / Accounting:** budgets, forecasts, cash-flow models, expense categorization, reconciliations and variance analysis; no movement of money without explicit approval.
- [ ] **Sales / CRM:** lead research, qualification, pipeline updates, proposals, follow-up drafting and sales analytics; sending or committing externally follows approval policy.
- [ ] **Marketing / Content:** strategy, calendars, copy, SEO research, campaign assets, publishing preparation and performance analysis; publishing requires configured authorization.
- [ ] **Customer Support / Success:** ticket triage, knowledge retrieval, response drafting, escalation, SLA tracking and feedback analysis.
- [ ] **HR / People Operations:** role descriptions, hiring workflows, onboarding checklists, training and internal documentation; sensitive personnel decisions require human review.
- [ ] **Legal / Compliance support:** contract and policy summarization, obligation extraction, compliance checklists and risk flags; not a substitute for qualified legal advice or approval.
- [ ] **Procurement / Vendor Management:** vendor discovery, comparison, quote analysis, purchase requests and renewal tracking; purchase commitments require approval.
- [ ] **Administration / Executive Assistant:** calendar and meeting preparation, agendas, minutes, reminders, document organization and follow-up tracking.
- [ ] **Data / Analytics:** ingestion from authorized sources, data quality, SQL/analysis, dashboards, KPI definitions and reproducible reports.
- [ ] **Security / IT:** access reviews, vulnerability triage, patch planning, incident response support, backups, endpoint inventory and security monitoring.
- [ ] **Real Estate / Asset Operations (configurable):** property research, listing comparison, due diligence checklists, document tracking, rent/occupancy analysis and maintenance workflows; legal/financial commitments require approval.
- [ ] **Media / Creative:** briefs, scripts, visual asset workflows, presentation production, editing coordination and brand consistency.

## 5. Execution and tool operating layer

- [ ] Shared capability registry describing each tool's exact scope, risk class, input/output schema, prerequisites, timeout, and approval requirement.
- [ ] Tool adapters for internal APIs, approved third-party APIs, browser automation, local device bridge, filesystem, Git, databases, and document generation.
- [ ] Tool calls must be authenticated, authorized, scoped, rate-limited, logged, bounded, and attributable to a Founder task and agent.
- [ ] Separate read, draft, reversible write, irreversible write, external communication, financial, account/security, and production deployment capabilities.
- [ ] Preflight checks before mutation: identity, permission, target ownership, argument digest, current state, backup/snapshot, and rollback plan.
- [ ] Execution receipts capture tool, target, timestamp, result status, evidence reference, and any side effects.
- [ ] Long-running actions support heartbeat, progress, cancellation, resumability, and safe recovery.
- [ ] No fabricated success: an action is complete only after its target system confirms success and required verification passes.
- [ ] No automatic retry of uncertain non-idempotent actions; park for reconciliation.
- [ ] Support task-level budgets for time, model calls, tool calls, data volume, and monetary spend where measurable.

## 6. Browser, internet, and external research

- [ ] Search, open, navigate, extract, compare, and summarize public web sources with citations and retrieval timestamps.
- [ ] Distinguish public information from authenticated/private account data.
- [ ] Browser automation uses an isolated, managed browser profile and explicit domain/account scopes.
- [ ] Support form filling, file upload/download, and multi-step web workflows only within configured permissions.
- [ ] Detect login walls, CAPTCHAs, consent prompts, suspicious pages, prompt injection, and unexpected payment/commitment steps; stop and escalate.
- [ ] Treat web pages, documents, emails, and tool output as untrusted data, never as higher-priority instructions.
- [ ] Maintain source provenance and evidence snapshots/URLs for material research.
- [ ] No bypassing access controls, paywalls, anti-bot protections, or account security.

## 7. Local PC and device operations

- [ ] Secure Windows 11 local connector with explicit enrollment, device identity, revocable credentials, health status, and limited user-level privileges.
- [ ] Future supported macOS/Linux connectors using equivalent security controls.
- [ ] Local host supervisor installed as a managed service or user-level daemon with startup, restart, health, logs, update and uninstall lifecycle.
- [ ] Host supervisor communicates only over authenticated local IPC (Windows named pipe / Unix domain socket); no unauthenticated public TCP listener.
- [ ] Server-side public-key verification of signed, nonce-bound, short-lived host isolation attestations; private signing key remains on the host.
- [ ] Strict workspace allowlists, path canonicalization, symlink defenses, file-size limits, sensitive-path denylist, and race-condition protections.
- [ ] Read-only capabilities: system health, workspace listing, bounded file reads/search, Git status and approved diagnostics.
- [ ] Mutating capabilities: create/edit/move files, create folders, run allowlisted tests/builds, and operate approved applications only as individually scoped capabilities.
- [ ] Shell/terminal execution remains disabled by default; if ever introduced, use isolated disposable environments, command allowlists or reviewed jobs, resource limits, and explicit risk approval.
- [ ] Screen capture, keyboard/mouse control, app control, and remote desktop are separate high-risk capabilities with visible session state and explicit approval.
- [ ] No silent surveillance, credential harvesting, hidden recording, or covert background control.
- [ ] Device pairing, revocation, session expiry, local token storage, logs, and secure update mechanisms.
- [ ] Clear behavior when PC is offline, asleep, logged out, or disconnected; queued work must not be falsely reported as executed.

## 8. Developer and self-build engineering system

- [ ] Convert Founder requirements into a versioned PRD, technical design, implementation plan, and acceptance tests.
- [ ] Inspect repository, branch, issues, PRs, code ownership, CI status, and dependency graph before editing.
- [ ] Work on isolated feature branches; never write directly to protected production branches.
- [ ] Generate bounded patches with exact file paths, precondition hashes, package digest, and change summary.
- [ ] Founder reviews exact changes and approves the specific patch before application to a protected workspace.
- [ ] Apply changes through the supervised host boundary with snapshots and rollback.
- [ ] Run formatting, lint, typecheck, unit, integration, security, migration, build, container and end-to-end tests as applicable.
- [ ] Independent code review checks correctness, security, maintainability, test coverage and unintended changes.
- [ ] CI checks required before PR is considered ready; report pending/failed jobs honestly.
- [ ] PR creation, review request, release notes, changelog and deployment plan generation.
- [ ] Merge, production deployment, secret rotation, destructive migration, and production configuration changes require explicit Founder approval each time unless a narrowly defined policy is later configured.
- [ ] Verify deployed version, health, smoke tests, metrics and rollback readiness after approved release.
- [ ] Track technical debt, flaky tests, dependency vulnerabilities, outdated integrations and unfinished work.
- [ ] No self-modification of policy, identity, approval rules, security controls or its own permissions.

## 9. Memory, knowledge and records

- [ ] Separate conversational context, explicit Founder memory, project knowledge, operational records, agent notes and audit evidence.
- [ ] Founder-scoped access control on every record and query.
- [ ] Semantic plus keyword retrieval with source, timestamp, confidence and relevance metadata.
- [ ] User can inspect, correct, export and delete eligible project/memory data subject to retention and audit policy.
- [ ] Memory ingestion requires provenance and must distinguish instructions from untrusted source material.
- [ ] Prevent cross-Founder and cross-project leakage; test authorization boundaries.
- [ ] Version important plans, decisions, SOPs, requirements, prompts, agent manifests and policies.
- [ ] Backups, restore tests, retention policies, encryption at rest/in transit, and disaster recovery.
- [ ] No claim that retrieval feedback trains or fine-tunes model weights unless a separate, approved training pipeline actually exists.

## 10. Integrations

Integrations are capability adapters, not merely logos or connected-account badges. Each integration needs secure OAuth/API credential handling, least-privilege scopes, health checks, error handling, rate limits, audit events, revocation and end-to-end tests.

- [ ] Gemini and configurable model providers; optional local Ollama or equivalent runtime.
- [ ] GitHub: repository/issue/PR/commit/workflow access; branch/commit/PR actions; merge/deploy separately approval-gated.
- [ ] Gmail: search/read/draft/send/label/archive capabilities scoped separately; sending and deletion require explicit policy/approval.
- [ ] Google Calendar and contacts: read/create/update invitations with confirmation for external attendees.
- [ ] Supabase: database, Auth, Storage, Realtime, Edge Functions and migrations with environment separation and migration approval.
- [ ] Notion and Coda: search/read/create/update pages, docs, tables and tasks within workspace permissions.
- [ ] Figma and Canva: read/design/create/update workflows with file/team access controls.
- [ ] Firecrawl or equivalent research/extraction provider.
- [ ] Product Design and other design/research tools where connected.
- [ ] Slack/Discord/Teams or equivalent notification and collaboration channels.
- [ ] Cloud storage and document services (Drive/Dropbox/OneDrive) with scoped file permissions.
- [ ] CRM, accounting, invoicing, payments, e-commerce, booking, analytics and project-management systems as explicitly configured.
- [ ] Integration directory/registry showing connected, disconnected, degraded, permission scopes, last sync and owner.
- [ ] Webhooks with signature validation, replay protection and idempotent event handling.
- [ ] Credential vault / secret manager; never expose secrets to browser bundles, prompts, logs, reports or repository history.
- [ ] Every integration must have a mock/test mode and documented recovery behavior.

## 11. Schedules, triggers and always-on operation

- [ ] Durable scheduler for one-time, recurring, event-driven and conditional jobs with timezone-aware execution.
- [ ] Jobs can create plans and tasks, not just perform a narrow file read.
- [ ] Founder-configured monitoring (PR/CI, business KPIs, inbox, renewals, deadlines, service health) with cadence, limits and stop controls.
- [ ] Cloud worker service with restart recovery, heartbeat, queue leases, concurrency controls, graceful shutdown and dead-letter handling.
- [ ] Separate local-device availability from cloud availability; do not promise local PC actions while the device is offline.
- [ ] 24/7 service health, uptime monitoring, alerting, backups, resource limits and incident runbooks.
- [ ] Deployment environments: local development, staging and production with isolated secrets/data and promotion gates.
- [ ] Mobile and desktop access to the same durable task state and approvals.
- [ ] Notifications must be deduplicated and report real task state, not model-generated assumptions.
- [ ] Configurable retention, pause-all, emergency stop and per-agent/per-integration disable controls.

## 12. Security, privacy and governance

- [ ] Threat model covering prompt injection, credential theft, SSRF, path traversal, malicious files, dependency compromise, supply-chain attacks, agent privilege escalation, data exfiltration, replay and tenant leakage.
- [ ] Deny-by-default capability policy and least-privilege roles for Founder, administrator, developer, department lead, agent and service account.
- [ ] Strong authentication, session expiry/revocation, CSRF protection where applicable, secure cookies, rate limits and abuse detection.
- [ ] Secrets encrypted and rotated; redact secrets and personal data from logs; never commit secrets.
- [ ] Audit trail is append-only or tamper-evident and records actor, task, capability, target, approval, decision, timestamp and result.
- [ ] Explicit approval for external messages, money movement, purchases, legal commitments, account/security changes, destructive actions, production deployments, public publishing and irreversible data changes.
- [ ] Approval binds to exact target and argument digest, has expiry, is single-use by default, and cannot be reused after material change.
- [ ] Independent approval authority: executing agent cannot approve its own action.
- [ ] Data minimization, retention/deletion controls, export controls, encryption, backup protection and access review.
- [ ] Sandboxing and resource isolation for untrusted code, browser sessions and file processing.
- [ ] Security scanning, dependency updates, vulnerability management, incident response, restore drills and penetration testing.
- [ ] Emergency stop that halts new work, revokes active execution leases and preserves audit evidence.
- [ ] No bypass of platform safeguards, account permissions, human approval or legal requirements.

## 13. Quality, observability and operational support

- [ ] Structured logs, metrics, traces and correlation IDs across Founder request → plan → agent → tool → result.
- [ ] Dashboard for queue depth, task age, worker health, retries, failures, latency, provider errors, integration status and resource usage.
- [ ] Readiness and liveness checks that distinguish configured, connected, healthy, enabled and actually operational.
- [ ] Per-feature status: not started, designed, implemented, tested, integrated, runtime-verified, production-operational.
- [ ] Test pyramid: unit, contract, integration, authorization/security, browser, device, migration, load, failure-injection and end-to-end tests.
- [ ] Golden workflow tests for common Founder requests across multiple departments and integrations.
- [ ] Failure-injection tests for network loss, worker crash, expired lease, duplicate event, provider outage, rollback failure and corrupted persistence.
- [ ] Independent verification evidence for every completed high-value task.
- [ ] User-facing diagnostics with actionable remediation; never expose secrets or internal stack traces.
- [ ] Runbooks for deployment, restore, key rotation, service restart, queue recovery, incident response and integration reconnection.

## 14. Business work outcomes Maya must eventually handle

Maya should be able to coordinate an end-to-end business workflow, not just answer questions. Examples include:

- [ ] Research a market, cite sources, compare competitors, create a business plan, budget and risk register.
- [ ] Build and maintain a website/app from requirements through design, code, tests, PR, approved deployment and monitoring.
- [ ] Find leads, prepare CRM records, draft outreach, track responses and report pipeline; external sending is permission-gated.
- [ ] Prepare marketing campaigns, content calendars, creative briefs, assets and performance reports; publishing is permission-gated.
- [ ] Analyze revenue, expenses, cash flow, unit economics, forecasts and scenarios from connected records; transactions remain approval-gated.
- [ ] Compare vendors, prepare quote analysis and purchase requests; purchase commitments remain approval-gated.
- [ ] Manage projects, assign owners, track milestones, chase blockers and produce daily/weekly reports.
- [ ] Prepare meetings, agendas, research packs, minutes, decisions and follow-up tasks.
- [ ] Manage support queues, draft responses, identify recurring issues and update knowledge bases.
- [ ] Coordinate recruitment/onboarding and maintain HR process documentation with human oversight.
- [ ] Analyze properties/assets, listings, documents, rent/occupancy and maintenance workflows with due-diligence and approval gates.
- [ ] Produce documents, spreadsheets, presentations, dashboards, reports and other deliverables with source files and version history.
- [ ] Monitor agreed business/technical signals and notify the Founder when a defined threshold or event occurs.

## 15. End-to-end acceptance gates

A feature is not complete because a page exists or a function returns a mocked result. Each capability must pass the applicable gates:

1. **Specified:** user story, scope, permissions, failure modes and acceptance criteria are written.
2. **Implemented:** production code path exists; no placeholder or mock-only behavior.
3. **Tested:** relevant unit, contract, integration and security tests pass.
4. **Integrated:** shared identity, task lifecycle, audit, approval, memory and observability are connected where applicable.
5. **Runtime-verified:** tested against the actual configured service/device/account, not only a fake adapter.
6. **Operational:** health, monitoring, recovery, backup, runbook and owner are in place.
7. **Founder-accepted:** Founder can inspect the result and approve the capability for its intended risk level.

A capability must display its actual gate. CI green alone does not prove external credentials, host services, cloud workers, integrations, or production operations are live.

## 16. Delivery sequence and critical dependencies

### P0 — Establish a trustworthy operating foundation
- [ ] Reconcile all historical/open PRs and document what is genuinely in main.
- [ ] Maintain one authoritative requirements register and trace every feature/PR/test to it.
- [ ] Finish unified task contracts, durable state transitions, idempotency, leases, cancellation, recovery and audit across CEO, plans, Developer, schedules and future departments.
- [ ] Finish authentication/authorization, capability policy, approval ledger, secret handling and emergency stop.
- [ ] Complete host supervisor installation/service lifecycle and prove secure Windows IPC end-to-end.
- [ ] Start and runtime-verify the isolated Developer QA worker; prove heartbeat, failure, shutdown and recovery.
- [ ] Establish local/staging/production environment separation, observability, backup and restore.

### P1 — Make the core agentic loop real
- [ ] Connect Founder chat to plan → task graph → delegation → execution → independent QA → report.
- [ ] Turn specialist agents from reasoning-only workers into scoped tool-using agents.
- [ ] Unify CEO, goal-plan, Developer and generic tasks under shared scheduling, dependency and recovery semantics.
- [ ] Build a secure tool gateway and integration registry.
- [ ] Finish Developer workflow end-to-end: requirements, branch, patch, approval, apply, tests, PR, review and approved release.
- [ ] Build complete Founder dashboard, task workspace, approval inbox and evidence viewer.

### P2 — Company-wide operations
- [ ] Implement department workflows and role-specific tool manifests.
- [ ] Connect Gmail, Calendar, GitHub, Supabase, browser/research, document storage and selected productivity/design/CRM/accounting systems.
- [ ] Add durable project knowledge, semantic retrieval, reports and cross-device task continuity.
- [ ] Add business workflows, recurring monitoring and notification channels.
- [ ] Add multi-agent parallelism, delegation depth controls, capacity and cost budgets.

### P3 — Reliable 24/7 service and advanced capabilities
- [ ] Deploy cloud control plane and workers with monitored availability and disaster recovery.
- [ ] Add mobile/desktop access, voice, offline/local model fallback and local-device relay.
- [ ] Add advanced browser/app/device automation behind explicit capability and approval gates.
- [ ] Load-test, security-test, chaos-test and perform restore/incident drills.
- [ ] Expand the agent workforce based on measured workload and operational value.

## 17. Current known implementation baseline (as of this register)

The repository already contains substantial building blocks: authenticated chat and tool policy; CEO specialist orchestration; goal planning and persisted plan execution; Founder-scoped memory and retrieval; task, schedule, approval and audit repositories; file and Supabase adapters/migrations; local device bridge with bounded operations; Developer patch, approval, execution and QA APIs; host-supervisor client/server libraries; and task lifecycle links for goal-plan steps, CEO assignments and Developer execution.

Important limitations must remain visible until separately resolved and runtime-verified:
- CEO specialists are still bounded/reasoning-oriented and do not yet form a fully tool-enabled autonomous department workforce.
- Goal plans, CEO runs, Developer execution and generic task workers are not yet one fully unified distributed scheduler/executor.
- Host-supervisor libraries do not by themselves prove an installed, healthy Windows service/daemon.
- A QA worker package or Compose healthcheck does not prove the worker is running and heartbeating in the target environment.
- Existing local bridge operations are bounded and do not equal unrestricted PC/browser/GUI control.
- Supabase migrations and adapters do not prove that the user's live Supabase project has been configured or migrated.
- Integration code does not prove that OAuth/API credentials are connected or that real account operations have passed end-to-end tests.
- A scheduled worker or cloud deployment configuration does not prove 24/7 production availability.
- Semantic memory retrieval is not model self-training or autonomous policy modification.
- Merged PRs and green CI are not equivalent to runtime or production acceptance.

## 18. Rules for maintaining this register

- Every new Founder requirement must be added here or linked as a traceable child requirement before implementation is considered planned.
- Every PR must name the requirement IDs it advances and list what remains blocked.
- Every completion report must separate implemented, tested, integrated, runtime-verified and production-operational.
- Keep this document current as work is merged; do not delete unfinished requirements to make progress appear higher.
- Never silently downgrade the Founder vision. If a capability is unsafe, unavailable, paid-only, legally restricted or technically infeasible, document the constraint and propose the nearest safe implementation.
- Never claim "Maya can do everything" until the relevant workflows are demonstrably operational end-to-end.
