# Maya — Founder-Controlled AI Operator

Maya is being evolved from the existing web-based Action Engine cockpit into a cloud-coordinated and locally executable AI operator.

## Current repository
- Web cockpit: React/Lit/TypeScript frontend.
- Backend: Node.js, Express, WebSockets.
- AI provider integration: Gemini through a server-side adapter.
- Existing action engine, platform registry, watcher, and task UI are retained as the starting point.

## Current development status
The active development branch is `maya/csrf-origin-protection` and the consolidated work is in [draft PR #37](https://github.com/snehasissahoo123456-lgtm/maya-ag-/pull/37).

Implemented and tested foundations include:
- Founder password authentication using server-side credentials, HttpOnly SameSite cookies, persisted SHA-256 session-token hashes, expiry, and persisted logout revocation. Sessions are single-instance local storage.
- Default-deny REST authentication, session-cookie checks for the WebSocket relay, and same-origin Origin/Referer checks for cookie-authenticated state-changing requests. Reverse-proxy deployments must set `MAYA_ALLOWED_ORIGINS`.
- File-backed task and exact-action approval stores, bounded redacted audit history, and one enabled low-risk capability: reading a non-secret text file inside the enrolled workspace with SHA-256 evidence.
- Founder-scoped Gemini chat history persistence through the configured conversation repository. File storage is the default. A server-only Supabase adapter and migration are included; the migration has not been applied to a live Supabase project.
- Specialist-agent manifests and delegation-policy templates. These are not live autonomous agents.

Maya is still a prototype, not a production autonomous operator. Verified Google OAuth and SMS OTP are not configured. Shared transactional storage for sessions, tasks, approvals and audit events; durable multi-instance workers; retry/idempotency recovery; complete route/tool authorization; PC/VS Code connector; Android app/APK; live multi-agent execution; and external-service integrations remain unfinished. A Gemini API key is not configured in this repository session, so live model calls and persisted chat behavior against the Gemini service have not been verified here.

## Run locally
Requirements: a supported Node.js runtime and dependencies installed from the repository lockfile.

\`\`\`bash
bun install --frozen-lockfile
bun run dev
\`\`\`

Set \`GEMINI_API_KEY\` in a local, untracked environment file only if using Gemini. Never commit API keys or real OAuth secrets.

## Commands
\`\`\`bash
bun run lint
bun run test
bun run build
\`\`\`

## Read next
- [Product and capability contract](docs/product/agent-capability-contract.md)
- [Target architecture](docs/architecture/target-architecture.md)
- [Security baseline](docs/security/security-baseline.md)
- [Implementation roadmap](docs/implementation/roadmap.md)
- [Android runtime plan](android/README.md)

## Release policy
A task is not complete because a model says it is complete. Maya must provide independently verifiable execution evidence. High-risk actions require explicit Founder approval. Cloud availability does not imply that Android can run arbitrary code continuously in the background.
