# Maya — Target Architecture

Status: foundation design; implementation is incremental.
Objective: one Founder-controlled agent platform with cloud orchestration and local execution on enrolled PCs and Android devices.

## Product boundary
Maya is an agent operating platform, not an unrestricted remote-control tool. It accepts Founder instructions, researches and plans work, selects approved capabilities, delegates bounded tasks to specialist agents, executes through connected runtimes, verifies outcomes, and reports evidence.

The cloud service is the coordination and durable-state layer. Local runtimes are the execution layer for resources that must remain on a user's PC or Android device. A device is never trusted merely because it has connected before.

## Logical architecture
1. Founder experience: existing web cockpit, later native Android app, and desktop interface. All use the same identity and task APIs.
2. Identity and policy: verified Founder authentication, device identity, roles, capability scopes, approval rules, session expiry, and revocation.
3. Control plane: task intake, planner, task state machine, scheduler, delegation, event stream, and audit log.
4. AI provider gateway: Gemini and optional local model adapters. Provider keys stay server-side or in the local runtime secret store, never in browser or APK bundles.
5. Specialist agent registry: versioned definitions with purpose, allowed tools, input/output schemas, resource limits, owner task, and lifecycle. Agents cannot grant themselves privileges.
6. Tool registry: typed tools with schemas, authorization checks, risk classification, timeout, idempotency strategy, and verifiable result.
7. Durable data: PostgreSQL for users, devices, tasks, approvals, agent definitions, and audit events; object storage for explicitly saved artifacts; local encrypted cache for offline work.
8. Local connectors: Windows/macOS/Linux PC connector, Android personal app, and Android dedicated-device/kiosk profile.
9. Observability: structured logs, task traces, device heartbeats, provider usage, cost limits, and alerting.

## Execution contract
Every tool invocation carries task ID, Founder ID, device ID if local, capability name, validated arguments, policy decision, approval reference where required, idempotency key, timeout, and correlation ID.

A tool result distinguishes succeeded, failed, denied, timed_out, and not_supported. Success includes independently checkable evidence. A chat response or simulated payload is not evidence.

Task completion is permitted only after the task reaches verifying and supplies non-empty verification evidence. High/critical-risk actions require a persisted Founder approval bound to the exact action arguments.

## Device profiles
### Personal Android profile
- Standard app; do not enroll the everyday phone as kiosk/device owner.
- Explicit runtime permissions for microphone, camera, notifications, and accessibility features.
- Device-bound credentials, revocation, encrypted cache, push notifications, and WorkManager for deferrable work.
- No claim of unrestricted access to other apps or Android internals.

### Dedicated Android kiosk profile
- Separate spare device, provisioned as a fully managed dedicated device only after explicit setup and factory-reset warning.
- Device Policy Controller / managed provisioning, Lock Task allowlist, Maya launcher, health reporting, and owner recovery.
- Kiosk restricts the user experience; it does not bypass Android permission or privacy boundaries.

### PC profile
- Separately installed local connector with explicit folder/workspace allowlists.
- VS Code integration through a documented extension or local protocol, not an unauthenticated terminal endpoint.
- Shell commands run in a restricted workspace with timeouts, environment filtering, and approval for destructive or privileged operations.

## Always-on expectation
The cloud control plane can remain available independently of the phone. Android cannot guarantee arbitrary continuous background execution. Use push notifications, WorkManager, permitted foreground services, checkpoints, and reconnect/recovery. Describe offline and background limitations in the UI.

## Security invariants
- Default deny; least privilege; separate Founder, service, agent, and device identities.
- No API keys, OTPs, or bearer tokens in source control, logs, browser bundles, or model prompts.
- High-risk actions require explicit, scoped, expiring approval.
- Every action is auditable; logs redact secrets and sensitive payloads.
- Device loss supports immediate credential revocation.
- Agent-generated code and tools are untrusted until reviewed, sandboxed, tested, and explicitly enabled.
- No self-modification or production deployment without policy checks and approval.
