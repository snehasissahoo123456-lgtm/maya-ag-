# Maya — Founder-Controlled AI Operator

Maya is being evolved from the existing web-based Action Engine cockpit into a cloud-coordinated and locally executable AI operator.

## Current repository
- Web cockpit: React/Lit/TypeScript frontend.
- Backend: Node.js, Express, WebSockets.
- AI provider integration: Gemini through a server-side adapter.
- Existing action engine, platform registry, watcher, and task UI are retained as the starting point.

## Current development status
The \`maya/foundation-architecture\` branch adds architecture and task lifecycle foundations, fail-closed authentication, default-deny REST authorization, a session-cookie gate for WebSockets, workspace path containment, honest unsupported-capability responses, and GitHub Actions CI.

The latest verified CI run on the development branch passed dependency installation, TypeScript typechecking, unit tests, and the production build. Founder password sign-in uses server-side environment credentials and an HttpOnly session cookie; Google OAuth and SMS OTP are disabled because verified providers are not configured. Legacy tasks, memories, and persona preferences persist to a local atomic JSON store. The new task control plane uses a separate file-backed repository with serialized writes, restart recovery for interrupted tasks, and authenticated Express endpoints: GET/POST /api/control-plane/tasks and POST /api/control-plane/tasks/:id/execute. Only one low-risk capability is enabled: reading a non-secret text file inside the enrolled workspace; execution returns the file content and SHA-256 evidence. This is a manually invoked, single-instance vertical slice, not a general-purpose worker or scheduler. The capability registry, exact-action approval ledger, task orchestrator, agent manifests, delegation policy, and capability catalog are present. The exact-action approval ledger is now file-backed with atomic replacement, expiry, Founder/task/capability/argument binding, and single-use consumption; authenticated Founder request/decision endpoints are wired. It is still single-instance file storage rather than a database, and no high-risk capabilities are registered. Sessions and audit logs remain in memory; the production database, migrations, background worker, retries, crash-safe side-effect recovery, live agents, PC/VS Code connector, Android app/APK, and external service adapters remain unimplemented. This remains a prototype, not a production autonomous operator.

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
