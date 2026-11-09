# PLAN.md — Maya Founder-Controlled AI Operator

## Current verified repository state
The original repository is a web-based Action Engine cockpit built with TypeScript, Node.js, Express, WebSockets, and a React/Lit frontend. It includes Gemini integration, task and memory UI, tool definitions, and platform/watcher services.

The current implementation is a prototype, not a production autonomous operator. Demo authentication and fabricated success responses have been removed; REST routes now default-deny without a verified session; WebSocket access requires a session cookie; and workspace file reads/listings are path-contained. Founder password sign-in uses a server-configured email/password, timing-safe password comparison, rate limiting, and an HttpOnly SameSite cookie. Founder sessions are now persisted for a single server instance using SHA-256 token hashes, atomic local JSON replacement, restrictive file permissions, expiry checks, and persisted revocation; raw bearer tokens are not written to disk. Google OAuth and SMS verification are not configured. Tasks, memories, persona preferences, task records, and approvals use local file stores; sessions, task state, approvals, and audit history use single-instance local stores rather than a transactional multi-instance database; audit events are redacted and bounded.

## Current development branch
\`maya/persistent-founder-sessions\`

## Foundation work added
- Persistent Founder session recovery and revocation using SHA-256 token hashes (single-instance file store; raw tokens are not persisted).
- Durable bounded audit history with atomic file replacement and sensitive-field/content redaction (single-instance only).
- Initial server-only Supabase conversation schema migration with owner immutability and adapter tests; live chat integration remains pending.
- Target cloud + local architecture.
- Security baseline and threat model.
- Phased implementation roadmap.
- Shared TypeScript task lifecycle with high-risk approval enforcement and verification evidence gates.
- Authentication and task lifecycle regression tests.
- GitHub Actions CI; latest validated commit passed locked install, typecheck, tests, and production build.
- Removed simulated task completion and fabricated tool/test/deployment/notification/search success; unsupported actions now fail explicitly.
- Workspace file read/list operations are contained to the server workspace.
- Android runtime plan distinguishing everyday personal use from a separate dedicated kiosk device.
- Project README, test command, and local secret/build-artifact ignore rules.

## Next milestones
1. **Security remediation:** verified Founder authentication, secure sessions, default-deny HTTP/WebSocket authorization, scoped device identity, filesystem containment, secret handling, and complete route/tool authorization.
2. **Durable control plane:** database migrations, persistent task/approval/audit state, retries, idempotency, recovery.
3. **Real tool execution:** replace simulated operations with restricted, observable, verifiable adapters.
4. **PC/VS Code connector:** explicit workspace enrollment, sandboxed command runner, Git operations, tests, evidence capture.
5. **Android personal app:** native Kotlin/Compose app, secure device enrollment, push, offline queue, supported background work.
6. **Dedicated kiosk profile:** device-owner provisioning and Lock Task Mode on separate spare hardware only.
7. **Specialist agents:** bounded agent manifests, task-scoped delegation, resource budgets, approval policy, auditability.

## Release gates
Do not call Maya operational until builds and tests have actually run, authentication and authorization tests pass, tasks survive restarts, simulated success paths are removed or clearly quarantined, local execution is sandboxed, and connected-device actions produce independently verifiable evidence.

See [the detailed roadmap](docs/implementation/roadmap.md), [target architecture](docs/architecture/target-architecture.md), and [security baseline](docs/security/security-baseline.md).
