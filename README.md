# Maya — Founder-Controlled AI Operator

Maya is being evolved from the existing web-based Action Engine cockpit into a cloud-coordinated and locally executable AI operator.

## Current repository
- Web cockpit: React/Lit/TypeScript frontend.
- Backend: Node.js, Express, WebSockets.
- AI provider integration: Gemini through a server-side adapter.
- Existing action engine, platform registry, watcher, and task UI are retained as the starting point.

## Current development status
The \`maya/foundation-architecture\` branch adds architecture and task lifecycle foundations, fail-closed authentication, default-deny REST authorization, a session-cookie gate for WebSockets, workspace path containment, honest unsupported-capability responses, and GitHub Actions CI.

The latest CI run verifies dependency installation, typechecking, unit tests, and the production build. This remains a prototype, not an operational autonomous agent. Google OAuth and SMS verification are not configured, so authenticated access is intentionally disabled. The Android directory is documentation only; no APK exists. Real task execution, durable storage, approval-ledger validation, search/notification/deployment adapters, and the PC/VS Code connector remain unimplemented.

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
- [Target architecture](docs/architecture/target-architecture.md)
- [Security baseline](docs/security/security-baseline.md)
- [Implementation roadmap](docs/implementation/roadmap.md)
- [Android runtime plan](android/README.md)

## Release policy
A task is not complete because a model says it is complete. Maya must provide independently verifiable execution evidence. High-risk actions require explicit Founder approval. Cloud availability does not imply that Android can run arbitrary code continuously in the background.
