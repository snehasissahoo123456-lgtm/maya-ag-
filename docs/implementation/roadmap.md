# Maya Implementation Roadmap

Branch: maya/persistent-founder-sessions
Status: Foundation is merged. Persistent single-instance Founder session storage is implemented on this branch and awaits CI verification. No Android APK or production deployment is claimed.

## Phase 0 — Baseline and contracts
- [x] Replace the legacy sign-in mockup with a focused Founder password screen backed by the server-issued HttpOnly session cookie; hide unconfigured Google/SMS paths and remove misleading security claims.
- [x] Capture target cloud + local architecture.
- [x] Define task states and verification gate in shared TypeScript primitives.
- [x] Run repository typecheck, unit tests, and production build in GitHub Actions.
- [ ] Complete route and tool policy mapping, including WebSocket upgrade and every tool adapter.
- [x] Add a production-server HTTP integration test for the authenticated task API and real read-only capability.
- [x] Add repository CI. Branch protection remains unconfigured.

## Phase 1 — Make the existing server safe
- [x] Persist Founder sessions as SHA-256 token hashes with atomic file replacement, restrictive permissions, expiry validation, and persisted revocation (single-instance only; not a distributed session database).
- Integrate verified Google OAuth/SMS identity providers, secure session issuance, HttpOnly cookie lifecycle, CSRF/origin controls, and revocation.
- Complete route/tool authorization mapping and add security acceptance tests.
- [x] Add a single-instance file-backed task repository for the new control plane, with serialized writes, corrupt-store fail-closed behavior, interrupted-task recovery, and rollback when durable writes fail. This is not a multi-instance database.
- [x] Persist the exact-action approval ledger to a single-instance file store and expose authenticated Founder request/decision endpoints. No high-risk capability is enabled.
- [x] Implement one read-only workspace-file execution adapter with path containment, secret-file blocking, size limit, and SHA-256 evidence.
- Extend workspace containment to every future file and command adapter; unrestricted shell execution remains disabled.
Exit gate: partial evidence exists for the task API and its read-only capability. Still required: comprehensive route/tool authorization tests, CSRF/origin protection, durable audit storage, and security acceptance testing. Session persistence is local and single-instance; production multi-instance deployment still needs a transactional shared store. No general-purpose worker or privileged action is enabled.

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
