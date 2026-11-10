# Maya repository and department audit

**Audit date:** 10 November 2026  
**Repository:** `snehasissahoo123456-lgtm/maya-ag-`  
**Reviewed development head:** `maya/specialist-ui-runtime-status` (`6d0e554484123b83dc9d5af0eca91fd7ed9ca8e5`)  
**Development merge commit:** `ee48f4fc83367ae87f55d368c82058f4f88d3a18`  
**Main before this audit's hardening work:** `9d0ec6d73f101dcfdecd6f3d188355bc7752c82b`

## Executive result

Maya has a substantial bounded prototype: authenticated web UI, task and goal-plan foundations, approval ledger, file/Supabase adapters, limited PC bridge, specialist runtime, parallel CEO orchestration, schedule worker and append-only audit repositories.

It is **not yet a fully autonomous multi-department operator and is not release-ready**. The development stack is not integrated with the current main line. Department-specific workflows and interfaces are largely absent. Live Supabase, production hosting, real-PC acceptance and Android packaging have not been verified.

## Repository integration and pull requests

- PRs #36 and #37 are merged into `main`; they provide the persistent-session, audit, CSRF and conversation-history foundation.
- PRs #34–#45 are merged into a stacked development branch chain, not into `main`.
- PRs #2–#33 remain open as 32 stacked draft pull requests. They are not part of the default branch.
- GitHub compare reported the final development head 72 commits behind `main`. The development stack therefore cannot be treated as a safe release candidate until the histories and overlapping server/database files are reconciled.
- PR #43, #44 and #45 passed their latest full CI runs. The latest PR #44 run completed successfully. PR #45's typecheck, PowerShell validation, tests, production build, Compose validation and production image all passed.
- Among open PRs #2–#33, most latest recorded runs passed. PRs #5, #9, #10, #13 and #23 had no workflow run for the current head in the queried run history. PRs #7 and #12 failed during Bun setup before typecheck or tests, so those failures do not establish a code regression.
- The normal CI checks TypeScript, tests, build, Windows PowerShell scripts, Compose configuration and the production image. It does **not** execute the Supabase SQL migrations against PostgreSQL.

## Release-blocking integration and schema findings

### 1. Security drift between main and the development stack

The development stack had diverged from the already-merged main security baseline:

- Main had file-backed Founder sessions storing SHA-256 token hashes; the development stack had instantiated an in-memory `AuthService`.
- Main rejected cookie-authenticated state-changing REST requests without a same-origin `Origin`/`Referer`; the development stack lacked this CSRF check.
- The live authenticated WebSocket relay also needed explicit origin validation.

The hardening branch restores persistent hashed sessions, adds cookie-mutation origin checks, validates the live WebSocket origin and adds HTTP integration assertions for cross-origin and missing-origin requests. These changes remain subject to CI. File-backed sessions are still single-instance; a shared transactional session store is not implemented.

### 2. Supabase task RPC contract mismatch

The first task migration defined `maya_save_task` as returning one `maya_tasks` row. The later migration redefined the same function signature as `SETOF maya_tasks`, while `SupabaseTaskRepository.put` expects one row object. PostgreSQL cannot change a function's return type with `CREATE OR REPLACE`, and the array return would not match the adapter. The hardening branch aligns the later migration with the scalar row contract and adds a regression test.

### 3. Goal-plan lease SQL and activation

The goal-plan claim migration placed `FOR UPDATE SKIP LOCKED` before `LIMIT 1`, contrary to PostgreSQL's SELECT clause order. The hardening branch corrects the order and adds a regression test.

The legacy conversation migration creates `maya_goal_plans` before the later strict `CREATE TABLE IF NOT EXISTS` migration. That later statement does not retrofit constraints on an existing table. A forward migration is added to install and verify the missing ID, Founder, plan-shape and step-state constraints.

The worker still deliberately rejects Supabase mode. Claim/release primitives exist, but lease renewal, two-process concurrency validation and real Supabase testing are incomplete. Do not enable the Supabase goal-plan worker or multiple replicas.

### 4. Conversation schema compatibility

Main's conversation migration describes a JSONB `messages` column. The development stack uses a separate `maya_conversation_messages` table. A compatibility migration adds the JSONB column to the split-message schema and installs the immutable conversation-owner trigger. This SQL still needs execution against a real PostgreSQL/Supabase staging database.

### 5. Audit coverage is not yet unified

Task lifecycle and specialist tool outcomes are persisted through the Founder-scoped append-only audit repository. The legacy activity feed still contains in-memory-only events. Specialist audit entries do not yet provide complete CEO-run/assignment/task trace linkage. Audit-chain verification, external backup and retention policy remain outstanding.

## Department-by-department capability audit

| Department | Status | What is actually present | What remains |
|---|---|---|---|
| Research and intelligence | Limited | Gemini Google Search grounding in chat; bounded specialist reasoning | Dedicated research workspace, source archive, provenance/citation checks, repeatable research jobs and evidence comparison |
| Software engineering / Developer | Limited | Server workspace list/read and repository validation command; limited approved file operations elsewhere in the task control plane | Developer-owned write workflow, isolated worktree/sandbox, patch review, Git diff verification, test execution under approval, rollback and VS Code integration |
| QA and verification | Not a complete department | CI and task verification evidence exist | Independent QA agent, test-plan generation, regression matrix, failure triage and acceptance gate |
| Business and venture operations | Planned | Generic tasks and memory notes | Projects, SOPs, KPIs, owners, reporting cadence and connected business systems |
| Real estate and property | Planned | No property-specific workflow | Property CRM, leads, land/acre/dismil records, document vault, due diligence, valuation sources and human legal review |
| Hospitality and travel | Planned | No booking/PMS/messaging adapter | Room inventory, reservations, guest communications, tour operations and approved payment integration |
| Content and media | Planned | No end-to-end production/publishing pipeline | Content calendar, script/review workflow, asset store, media generation connectors and human publishing approval |
| Personal productivity | Limited | Memory, task queue, scheduled read-only jobs and PWA | Calendar, email, reminders, push notifications, mobile background sync and reliable voice workflows |
| Finance and administration | Planned | No financial-account connector; payment execution absent | Read-only statements, budgets, cash flow, reconciliation, reports and explicit Founder review |
| PC and device operations | Limited | Paired local PC bridge, bounded file/list/search/Git operations and exact-approved file changes | Device registry/relay distribution, connector isolation, shell/browser/app control under separate grants, VS Code integration and physical-PC acceptance |
| AI workforce / CEO | Limited | CEO selects up to four specialists concurrently; role-scoped read tools and persisted specialist audit events | Approved write tools, per-agent budgets, global concurrency, cancellation, durable assignment queues, independent verification and larger workforce governance |

The UI currently has general pages for Dashboard, Live Chat, Goal Plans, CEO Orchestration, Specialist Agents, Devices, Schedules, Tasks, Tools and Memory. The specialist interface is a shared role-driven workspace. There are not yet separate, functional department pages for Research, Developer, QA, Business, Real Estate, Hospitality, Media and Finance.

## Platform and operational status

- **Authentication:** Founder password flow only. Google OAuth and SMS OTP are deliberately disabled because verified providers are not configured. Login rate limiting remains outstanding.
- **Persistence:** File-backed stores are the default; optional Supabase adapters exist for several repositories. Migrations have not been applied to a live project.
- **Workers:** Task and schedule workers are opt-in. Goal-plan worker is opt-in and file-only pending lease renewal. Worker flags default to disabled.
- **PC connector:** Limited paired local bridge, not unrestricted desktop automation. Windows logon-task registration and real device operation have not been tested on the Founder's PC.
- **Browser/app automation:** No general browser automation, browser-session control, arbitrary shell or arbitrary desktop-app control.
- **Android:** PWA only. The Android directory explicitly has no Gradle project and no APK.
- **Cloud:** Dockerfile/Compose and CI image build exist. No production host, domain, TLS proxy, live secret provisioning, monitoring or backup restore test has been verified.
- **Voice:** UI/media capture and Gemini integration code exist; real provider sessions and end-to-end voice reliability have not been acceptance-tested.
- **Security:** Route/tool review, login rate limits, live WebSocket/device-origin tests, penetration testing, secret rotation, backup recovery and a complete audit trail remain outstanding.

## Recommended build order

1. Finish the main-line security/schema reconciliation branch and get full CI green. Keep Supabase goal-plan workers disabled until lease renewal and two-worker tests exist.
2. Build the **Developer department**: isolated worktree, exact Founder-approved patch/write, visible diff, test/build execution, independent verification and rollback. Never grant unrestricted shell or PC access as the first implementation.
3. Build the **QA department** as an independent verification gate for Developer and all other departments.
4. Build **Research** as a source-backed workflow with saved evidence, citations, comparison and reusable reports.
5. Build **Business and venture operations** with project, KPI, SOP and reporting data models.
6. Build **Real Estate**, then **Hospitality**, each with their own pages, records, workflows, integrations and approvals.
7. Build **Content and Media** with asset management and human publishing approval.
8. Complete **Personal Productivity** integrations (calendar, email, notifications and mobile sync).
9. Add **Finance** as read-only analysis first; payment execution remains out of scope until separately secured.
10. Build and test the native **Android** client, then perform full end-to-end activation and production hardening.

Every department must have its own data model, page, permission manifest, task workflows, audit events, error/recovery states and automated acceptance tests. A role name or a model-generated report does not count as a completed department.
