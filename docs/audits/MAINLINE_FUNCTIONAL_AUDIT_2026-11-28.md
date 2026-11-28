# Maya Mainline Functional Audit — 2026-11-28

## Scope and method

Audited the merged `main` snapshot at commit `047c3cf2014186ca663cddc48776c8c57d241968` (merge of PR #103), the repository README, `AGENTS.md`, the Master Operating Scope, product capability contract, target architecture, implementation roadmap, activation runbook, package scripts, and Electron desktop entry/smoke-test files.

This is a source-level audit. It is not a local Windows interactive acceptance test. No source files, user data, secrets, or runtime configuration were changed during this audit.

## Verified repository state

- PR #103 is merged into `main`; the merge commit is `047c3cf2014186ca663cddc48776c8c57d241968`.
- The post-merge `Maya CI` run #1600 for that exact main commit completed successfully.
- The Windows installer workflow for PR #103 completed successfully. Its steps included typecheck/build, packaging, installer existence check, silent install, packaged-backend smoke test, artifact upload, and prerelease publication.
- The packaged smoke test proves that the installed Electron executable can launch the bundled Node backend and that `/api/health` returns HTTP 200. It does not prove full interactive UI, Founder authentication, Gemini connectivity, PC pairing, autonomous task execution, or end-to-end agent behavior.
- The repository's own README describes Maya as a bounded prototype pending live credentials, migrations, host-supervisor/QA runtime, external OAuth, cloud deployment, backup/restore, monitoring, and end-to-end acceptance.

## Functional baseline

### Desktop shell

Present in `main`:
- Electron desktop shell around the existing production frontend and Express backend.
- First-launch Founder email/password and optional Gemini-key setup.
- Electron `safeStorage` encryption for the desktop configuration.
- Backend launched on loopback at `127.0.0.1:3210`.
- Renderer Node integration disabled, context isolation and sandbox enabled, and a narrow preload IPC surface.
- Application data rooted in Electron's per-user `userData` directory.
- Task, plan, and schedule workers explicitly forced off by the desktop launcher.

Not proven by the CI smoke test:
- Interactive first-launch and returning-user flows.
- Founder sign-in and session lifecycle from the packaged UI.
- Gemini authenticated request and actual model response.
- Data persistence across app upgrades, uninstall/reinstall, and recovery.
- Voice interaction, PC bridge pairing, or any broad desktop-control capability.

### Agent/task platform

The codebase contains a substantial agent-core and test surface: task lifecycle/orchestration, capability registry, approval ledger, task worker, goal planner/executor, memory repositories/retrieval, CEO orchestration/run storage, specialist runtime/concurrency, schedule worker, developer change-control/execution/QA modules, device bridge, and file/Supabase repository adapters.

Presence of modules and tests is not equivalent to an operational end-to-end feature. The README and roadmap explicitly identify important runtime gates. In particular:
- Default desktop startup disables task, plan, and schedule workers.
- Local file-backed storage is single-instance; it is not a distributed transactional database.
- Supabase requires real project credentials and migrations.
- The separate PC bridge, Developer host supervisor, and isolated QA worker have separate pairing/health gates.
- External OAuth providers and third-party integrations are not activated by the installer.
- 24/7 availability requires an always-on host; a local Windows logon task stops when the PC is off or the user is logged out.

### Security and founder control

The repository's stated contracts require default-deny authorization, least privilege, task-scoped agents, exact-action approvals for high-risk operations, secret redaction, workspace containment, auditability, revocation, and evidence-gated completion.

The desktop package does not grant unrestricted shell execution, general browser automation, or unrestricted PC control. These must not be represented as available.

## Priority gaps before claiming Maya is fully functional

1. **Packaged interactive acceptance:** automate or document a real Windows UI acceptance path covering first launch, secure configuration, Founder login, dashboard load, logout/restart, and persistent state.
2. **Runtime readiness gate:** run the packaged app's authenticated `/api/system/readiness` check and capture the actual result. Resolve configuration blockers rather than treating HTTP health as readiness.
3. **Provider verification:** test a real Gemini request only after the Founder supplies/configures a valid key; verify the returned provider/model metadata and record usage/cost behavior. Do not invent credentials or incur unapproved paid usage.
4. **Memory acceptance:** verify conversation persistence, memory retrieval, provenance, Founder isolation, restart behavior, and backup/restore. The roadmap identifies file-backed persistence and missing transactional/encryption/backup work as limitations.
5. **Task execution acceptance:** prove a complete low-risk task lifecycle from authenticated task creation through worker execution and independent evidence. Keep workers disabled until the Founder explicitly activates them and readiness checks pass.
6. **Device/Developer runtime:** separately enroll the Founder PC, verify device revocation and workspace containment, and verify host-supervisor plus isolated QA-worker health before enabling Developer execution.
7. **Security acceptance:** complete route/tool authorization mapping, session lifecycle/revocation, CSRF/origin checks, secret scanning/redaction, path/symlink escape tests, and exact-action approval tests.
8. **Release reliability:** verify upgrades, persistent user-data preservation, clean uninstall behavior, crash/restart handling, and artifact checksum/signature policy.

## Recommended implementation order

- **Gate A — packaged Founder acceptance:** add Windows UI-level smoke/acceptance coverage and a documented manual acceptance checklist. No new privileged capabilities.
- **Gate B — readiness and memory:** make the dashboard surface authenticated readiness blockers and verify persistence/recovery with tests.
- **Gate C — bounded task activation:** expose explicit Founder-controlled worker activation with clear risk/capability inventory; require readiness and approval checks.
- **Gate D — PC Developer execution:** complete host isolation and independent QA evidence before enabling any write/command execution.
- **Gate E — learning/research loop:** implement scheduled research as proposals with sources, provenance, review, and approval-gated adoption; do not allow self-modification or permission expansion.
- **Gate F — always-on deployment:** only after shared durable storage, backups/restore, monitoring, HTTPS, secret management, and operational acceptance exist.

## Safety constraints retained

- No direct changes to `main`.
- No deletion, replacement, or movement of existing code/data.
- No enabling workers, new privileges, external publishing, deployment, purchases, or destructive operations without explicit Founder approval.
- All implementation must occur on a dedicated branch, with tests and evidence, then a reviewable PR. Do not merge automatically.
- Prefer free/local-first development. Do not introduce paid services or paid API usage without approval.
- Never claim a feature is operational based solely on code presence, green CI, a dashboard label, or a model response.

## Conclusion

The Windows installer pipeline is verified and the merged `main` CI is green. Maya is installable and its packaged backend starts successfully. The available evidence does **not** establish that the complete autonomous organization, continuous learning, full memory, broad computer control, or 24/7 operation is active. The next engineering milestone is packaged Founder-level end-to-end acceptance and runtime readiness, followed by carefully gated activation of existing bounded capabilities.
