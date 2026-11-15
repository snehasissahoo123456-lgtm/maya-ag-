# Maya runtime activation runbook

This runbook activates the code that is already present in this repository. It does not manufacture credentials, link third-party accounts, or prove that a remote deployment is online.

## 1. Local Windows activation

Requirements:
- Windows 10/11
- PowerShell 7 or newer (`pwsh`)
- Node.js 22 or newer
- Bun 1.4.4 or newer
- A Gemini API key
- A unique Founder password of at least 16 characters

From the repository root, run:

```powershell
pwsh -NoProfile -File .\scripts\Activate-Maya.ps1 -InstallStartupTask
```

The script:
1. Creates `.env` from `.env.example` if needed, preserving existing values.
2. Prompts securely for missing Founder/Gemini credentials.
3. Enables the bounded task, goal-plan and schedule workers.
4. Restricts the local `.env` file to the current user, SYSTEM and Administrators.
5. Installs locked dependencies, runs the complete test suite and builds the production bundle.
6. Installs a current-user, limited-privilege Windows logon task for the Maya server.

To configure and verify without starting the server:

```powershell
pwsh -NoProfile -File .\scripts\Activate-Maya.ps1 -NoStart
```

To start the server in the current PowerShell session after activation:

```powershell
pwsh -NoProfile -File .\scripts\Start-Maya-Server.ps1
```

Remove the logon task with:

```powershell
pwsh -NoProfile -File .\scripts\Uninstall-Maya-Server-Startup.ps1
```

The logon task runs only while this Windows user is logged in. The PC must be powered on. This is not 24/7 cloud hosting.

## 2. Storage modes

### Local single-instance mode

The activation script defaults to `MAYA_STORAGE_DRIVER=file`. This is suitable for a single local Maya server process. Do not run multiple replicas with file storage; file-backed task and plan state is not a distributed database.

### Supabase shared mode

Before selecting `MAYA_STORAGE_DRIVER=supabase`:
1. Install the Supabase CLI and authenticate.
2. Link this repository to the intended Supabase project with `supabase link`.
3. Set or enter `SUPABASE_URL` and the server-only `SUPABASE_SERVICE_ROLE_KEY`.
4. Run the activation script and explicitly type `APPLY` when it asks to apply pending migrations.

The script runs `supabase db push` only after that explicit confirmation. Never expose the service-role key to browser code, commit it, or paste it into source files.

## 3. Verify runtime readiness

Sign in as the Founder, then request:

```text
GET /api/system/readiness
```

The response reports:
- Gemini and Founder authentication configuration
- Persistent task storage reachability and storage mode
- Task, goal-plan and schedule worker enabled/running state
- Developer runtime readiness and its blockers
- Whether file storage imposes a single-instance restriction

A successful HTTP response is a readiness report, not a claim that every Maya capability is active. Resolve each returned blocker. The endpoint deliberately does not expose secrets.

## 4. Local PC bridge and Developer runtime

The server's task workers do not automatically install the separate local PC bridge or unrestricted desktop control.

To pair a Windows device, start the bridge manually and complete the one-time pairing in Maya:

```powershell
pwsh -NoProfile -File .\scripts\Start-Maya-Bridge.ps1
```

After successful pairing, install the limited-privilege bridge logon task:

```powershell
pwsh -NoProfile -File .\scripts\Install-Maya-Bridge-Startup.ps1
```

The bridge remains bounded to its documented device operations. Developer host-supervisor configuration and the isolated sandbox QA worker are separate readiness gates. Do not assume they are active merely because the web server is running.

The optional sandbox service can be started with:

```powershell
docker compose --profile developer-sandbox up -d
```

It runs isolated test work with no network, host mounts or credentials. Its live heartbeat must be checked separately.

## 5. Cloud operation

For an always-on deployment:
- Use Supabase shared storage and apply every repository migration.
- Deploy the server to a persistent cloud host.
- Set `NODE_ENV=production`, `GEMINI_API_KEY`, Founder credentials, Supabase URL/service key and the worker flags in the deployment's secret/environment manager.
- Set `MAYA_TASK_WORKER_ENABLED=true`, `MAYA_PLAN_WORKER_ENABLED=true` and `MAYA_SCHEDULE_WORKER_ENABLED=true`.
- Terminate HTTPS at a trusted reverse proxy and configure `MAYA_ALLOWED_ORIGINS` for the exact browser origins.
- Keep one active worker set per configured Founder/storage domain and monitor `/api/health` and the authenticated `/api/system/readiness` report.
- Configure persistent backups and test restoration before relying on the service.

The local Windows logon task is not a substitute for cloud deployment. It stops when the PC is off or the user is logged out.

## 6. Integrations not activated by this runbook

This runbook does not connect Gmail, Calendar, payment providers, external business systems or third-party OAuth accounts. Those need their own connector implementation, OAuth consent, credentials and end-to-end verification. It also does not claim voice calling, unrestricted browser/desktop control, or live 24/7 uptime.
