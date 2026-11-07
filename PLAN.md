# PLAN.md — Maya Founder-Controlled AI Operator

## Current verified repository state
The original repository is a web-based Action Engine cockpit built with TypeScript, Node.js, Express, WebSockets, and a React/Lit frontend. It includes Gemini integration, task and memory UI, tool definitions, and platform/watcher services.

The current implementation is a prototype, not a production autonomous operator. Some execution and platform-health paths are simulated; authentication contains demo behavior; task and memory state is held in process memory; and route authorization and filesystem containment require a complete review.

## Current development branch
\`maya/foundation-architecture\`

## Foundation work added
- Target cloud + local architecture.
- Security baseline and threat model.
- Phased implementation roadmap.
- Shared TypeScript task lifecycle with explicit approval and verification evidence gates.
- Unit tests for the task lifecycle.
- Android runtime plan distinguishing everyday personal use from a separate dedicated kiosk device.
- Project README, test command, and local secret/build-artifact ignore rules.

## Next milestones
1. **Security remediation:** verified Founder authentication, secure sessions, default-deny HTTP/WebSocket authorization, scoped device identity, filesystem containment, secret handling.
2. **Durable control plane:** database migrations, persistent task/approval/audit state, retries, idempotency, recovery.
3. **Real tool execution:** replace simulated operations with restricted, observable, verifiable adapters.
4. **PC/VS Code connector:** explicit workspace enrollment, sandboxed command runner, Git operations, tests, evidence capture.
5. **Android personal app:** native Kotlin/Compose app, secure device enrollment, push, offline queue, supported background work.
6. **Dedicated kiosk profile:** device-owner provisioning and Lock Task Mode on separate spare hardware only.
7. **Specialist agents:** bounded agent manifests, task-scoped delegation, resource budgets, approval policy, auditability.

## Release gates
Do not call Maya operational until builds and tests have actually run, authentication and authorization tests pass, tasks survive restarts, simulated success paths are removed or clearly quarantined, local execution is sandboxed, and connected-device actions produce independently verifiable evidence.

See [the detailed roadmap](docs/implementation/roadmap.md), [target architecture](docs/architecture/target-architecture.md), and [security baseline](docs/security/security-baseline.md).
