# Maya Security Baseline and Threat Model

This is the minimum security baseline before Maya is exposed to real accounts, devices, files, or external services.

## Assets
Founder identity and sessions; provider API keys; connected-platform OAuth tokens; device credentials; task instructions and memory; local files and source code; generated artifacts; approvals; audit history.

## Trust boundaries
- Browser/mobile UI to cloud API.
- Cloud API to database and AI provider.
- Cloud control plane to local PC/Android connectors.
- Planner/model output to tool execution.
- Parent agent to specialist agents.
- Kiosk device to other Android apps and OS services.

Treat model output, repository content, web pages, files, plugin responses, and sub-agent messages as untrusted input.

## Required controls
### Authentication and sessions
- Remove seeded Founder sessions, hard-coded tokens, demo OTPs, and OTP disclosure in API responses.
- Verify Google OAuth ID tokens server-side against issuer, audience, expiry, and nonce/state.
- Use cryptographically secure random values for session/device credentials; store only hashes where applicable.
- Add expiry, rotation, logout/revocation, rate limits, and transport-appropriate CSRF/origin protections.
- A phone number alone or client-supplied email/name must never establish Founder identity.

### Authorization
- Default deny on every API route and WebSocket upgrade.
- Enforce Founder/device identity and capability scope server-side; never trust role fields from request bodies.
- Bind approval to exact tool name, normalized arguments, target device, expiry, and task ID.
- Separate personal-phone and kiosk-device scopes.

### Tool execution
- Use allowlisted tools, schema validation, argument size limits, timeouts, concurrency limits, and idempotency keys.
- No arbitrary shell or browser automation without an enrolled local connector and explicit workspace/capability grants.
- Destructive operations, external communications, financial actions, account/security changes, and production deployments require explicit approval.
- Verify effects independently; never convert a planned or simulated result into success.

### Files and secrets
- Resolve paths against configured workspace roots and reject traversal, symlink escapes, and unapproved roots.
- Redact secrets from logs and model context.
- Keep secrets in deployment secret stores or OS secure storage; .env must be ignored and .env.example must contain placeholders only.
- Encrypt sensitive local data and rotate/revoke device credentials.

### Agents and memory
- Sub-agents receive only task-scoped tools and data; no implicit privilege inheritance.
- Agent creation requires a registered manifest, owner task, bounded budget, tool allowlist, expiry/review, and audit event.
- Memory writes are typed, source-attributed, retention-aware, and deletable through an explicit workflow.
- External content cannot issue instructions to the agent or alter system policy.

### Availability and recovery
- Persist tasks and approvals before acknowledging them.
- Use retry limits, dead-letter handling, checkpoints, and idempotent resume.
- A disconnected device is offline, not assumed healthy.
- Provide device revocation, emergency stop, backups, and documented kiosk recovery.

## Initial release blockers from the repository review
The current code contains a seeded Founder session, client-supplied identity login paths, a demo OTP returned to callers, an always-accepted test OTP, in-memory task/memory arrays, and simulated tool outcomes. The server needs a route-by-route authorization review and filesystem path-containment review. These are not production-safe and must be addressed before connecting personal accounts or enabling remote execution.

## Security acceptance tests
1. Unauthenticated requests cannot read or mutate Founder data.
2. A device credential cannot access another device's scope.
3. Expired/revoked credentials fail on HTTP and WebSocket routes.
4. High-risk actions cannot execute without a matching, unexpired approval.
5. Traversal and symlink escape attempts are denied.
6. Secrets do not appear in API responses, browser bundles, logs, or committed files.
7. Simulated adapters cannot produce production completed tasks.
8. A lost device can be revoked without access to that device.
