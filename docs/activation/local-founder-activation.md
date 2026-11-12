# Local Founder activation (Windows)

This is the fastest supported local path for starting the current Maya prototype. It does not deploy Maya or grant unrestricted computer control.

## 1. Prepare local secrets

From the repository root in PowerShell:

```powershell
Copy-Item .env.example .env
notepad .env
```

Set:
- `MAYA_FOUNDER_EMAIL` to the Founder login email.
- `MAYA_FOUNDER_PASSWORD` to a strong, unique local password.
- `GEMINI_API_KEY` to the server-side Gemini API key.

Keep `.env` local. Never commit it, paste secrets into GitHub issues/PRs, or put the Gemini key in browser code. The launcher checks that the values exist but never prints them.

## 2. Install and start

Use Node.js 22+ and Bun. From the repository root:

```powershell
bun install --frozen-lockfile
.\scripts\Start-Maya-Local.ps1
```

Open [http://localhost:3000](http://localhost:3000) and sign in with the Founder email/password configured above.

## 3. Opt in to bounded background execution

After reviewing the local single-instance boundary, start Maya with:

```powershell
.\scripts\Start-Maya-Local.ps1 -EnableWorkers
```

This explicitly enables the existing task worker and approved goal-plan worker. The launcher refuses this combined profile unless `MAYA_STORAGE_DRIVER=file`. The workers execute only registered/allowlisted capabilities; state-changing steps still pause for exact Founder approval. The goal-plan worker is not enabled for Supabase or multi-instance hosting.

To additionally enable recurring **read-only workspace-file** schedules:

```powershell
.\scripts\Start-Maya-Local.ps1 -EnableWorkers -EnableSchedules
```

Do not enable schedules unless you have created and reviewed the schedules in Maya. They do not run arbitrary prompts or general automation.

## 4. Verify the runtime

Check [http://localhost:3000/api/health](http://localhost:3000/api/health). Confirm `status` is `ok` and inspect the reported `taskWorker`, `goalPlanWorker`, and `scheduleWorker` states. A healthy HTTP response alone does not prove Gemini requests, database migrations, local-device pairing, or task execution work; test each required path separately.

## 5. Connect the local PC (optional)

The PC connector is a separate process and requires Founder pairing in Maya's Devices workspace. After pairing, run:

```powershell
.\scripts\Start-Maya-Bridge.ps1
```

Direct device commands are bounded/read-only. Local file mutations require a separate exact Founder-approved task. The connector does not provide arbitrary shell, browser, keystroke, screenshot, or remote-desktop access.

## Current activation boundaries

- This is a local, single-instance development runtime, not a managed 24/7 service.
- File-backed state is not a production transactional database.
- Live Supabase migrations and multi-instance concurrency are not verified by this launcher.
- The Developer change workflow stores proposals; it does not itself apply patches or run the isolated sandbox worker.
- Android runtime, production hosting/monitoring, signed connector updates, and security acceptance testing remain separate release work.
- Stop the server with Ctrl+C. Worker flags are process-local and are not written back to `.env`.
