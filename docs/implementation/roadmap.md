# Maya Implementation Roadmap

Branch: maya/foundation-architecture
Status: Foundation and first security-hardening pass are implemented. Latest CI validates install, typecheck, tests, and production build. No Android APK or production deployment is claimed.

## Phase 0 — Baseline and contracts
- [x] Capture target cloud + local architecture.
- [x] Define task states and verification gate in shared TypeScript primitives.
- [x] Run repository typecheck, unit tests, and production build in GitHub Actions.
- [ ] Complete route and tool policy mapping, including WebSocket upgrade and every tool adapter.
- [x] Add repository CI. Branch protection remains unconfigured.

## Phase 1 — Make the existing server safe
- Integrate verified Google OAuth/SMS identity providers, secure session issuance, HttpOnly cookie lifecycle, CSRF/origin controls, and revocation.
- Complete route/tool authorization mapping and add security acceptance tests.
- Replace in-memory task/memory state with durable storage and migrations.
- Add a persisted, server-validated approval ledger bound to exact action arguments and targets.
- Implement real, sandboxed execution adapters; unsupported actions currently fail closed.
- Extend workspace containment to every future file and command adapter; unrestricted shell execution remains disabled.
Exit gate: security tests pass; no route exposes Founder state unauthenticated; tasks survive restart; fake success paths cannot mark tasks complete.

## Phase 2 — Cloud control plane
- Device registry and device-bound credentials.
- Durable task queue, planner, scheduler, policy engine, event stream, and observability.
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
