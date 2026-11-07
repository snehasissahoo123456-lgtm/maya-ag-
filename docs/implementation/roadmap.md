# Maya Implementation Roadmap

Branch: maya/foundation-architecture
Status: Phase 0 foundation is being established. No Android APK or production deployment is claimed.

## Phase 0 — Baseline and contracts
- [x] Capture target cloud + local architecture.
- [x] Define task states and verification gate in shared TypeScript primitives.
- [ ] Run repository build and lifecycle tests in a real checkout.
- [ ] Map every existing route and tool to authentication/policy requirements.
- [ ] Add repository CI and branch protection after baseline is known.

## Phase 1 — Make the existing server safe
- Replace demo authentication with verified OAuth and secure sessions.
- Add default-deny authorization to HTTP and WebSocket endpoints.
- Replace in-memory task/memory state with durable storage and migrations.
- Add validated task transitions, approvals, idempotency, checkpoints, and audit events.
- Remove or quarantine simulated tools; expose unsupported capability states honestly.
- Fix filesystem root containment and safe command execution.
Exit gate: security tests pass; no route exposes Founder state unauthenticated; tasks survive restart; fake success paths cannot mark tasks complete.

## Phase 2 — Cloud control plane
- Device registry and device-bound credentials.
- Durable task queue, planner, scheduler, policy engine, event stream, and observability.
- AI provider adapter with server-side secrets and configurable quotas.
- Specialist agent registry with task-scoped capabilities and budget limits.
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
