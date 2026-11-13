# Maya production container deployment

This is a deployment template, not a deployment that has already been run. It builds the existing Node/Vite application, runs it as a non-root user, stores persistent data in a Docker volume, binds the app to localhost, and restarts the container after host or process restarts.

## Requirements

- A Linux host with Docker Engine and Docker Compose v2.
- A domain name and a TLS reverse proxy (Nginx, Caddy, Traefik or a managed proxy).
- A Gemini API key if Gemini-powered reasoning is required.
- Optional Supabase project credentials if using Supabase persistence.

## Configure

1. Copy `.env.example` to `.env`.
2. Set a strong, unique `MAYA_FOUNDER_PASSWORD` and the Founder email.
3. If TLS terminates at a reverse proxy, set `MAYA_ALLOWED_ORIGINS` to the exact public origin (for example `https://maya.example.com`). Do not use a wildcard.
4. Set `GEMINI_API_KEY` on the host only if using Gemini. Do not commit `.env`.
5. For Supabase, apply the repository migrations in timestamp order, review RLS/service-role grants, then set `MAYA_STORAGE_DRIVER=supabase`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`.
6. Start with workers disabled. Verify login, health, task persistence and backups before enabling background work.


## Build and run

```bash
docker compose build
docker compose up -d
docker compose ps
docker compose logs -f maya
curl http://127.0.0.1:3000/api/health
```

The compose file publishes only `127.0.0.1:3000`. Put a TLS reverse proxy in front of it. The proxy must forward HTTP/1.1 WebSocket upgrades for both `/api/live-ws` and `/api/device-bridge`, preserve the `Host` and cookie headers, and use a sufficiently long read timeout. Do not expose port 3000 directly to the public internet.

## Background workers

Workers are opt-in and disabled by default.

- `MAYA_TASK_WORKER_ENABLED=true`: executes registered low-risk workspace reads and exact-Founder-approved replacement of existing server-workspace text files and replacement or exclusive creation of local-device text files in existing directories. Local device writes require the paired device to be online and the local bridge to be running.
- `MAYA_SCHEDULE_WORKER_ENABLED=true`: enqueues due one-time/hourly/24-hour/7-day read-only file jobs. It requires the task worker to be enabled.
- `MAYA_PLAN_WORKER_ENABLED=true`: runs explicitly started Founder-approved goal plans. This worker currently requires file storage and one server instance; do not enable it with Supabase or multiple replicas.

With Supabase storage, schedule jobs use database leases and the task worker uses task leases. The local device bridge registry and active WebSocket connection manager are still process-local/file-backed. Route a paired device's WebSocket, device inventory/command APIs, device-write task creation, and the worker execution to the same app instance (sticky routing). Workers on instances without that device's active socket skip its queued write tasks rather than failing them. Use a single instance until the device registry and message relay are made distributed.

## Persistence and backup

The named volume `maya-data` holds file-backed stores. Back it up consistently and test restoration. Supabase-backed stores require separate database backups and point-in-time recovery. Never place service-role keys in the browser bundle or source control.

## Operational limitations

- `restart: unless-stopped` restarts the container; it does not guarantee host availability, database availability, or 24/7 service-level uptime.
- Add host monitoring, log shipping, alerting, database backup verification and an incident/recovery runbook before relying on Maya for business-critical work.
- No arbitrary shell execution, file writes/deletes, browser session access, payments or external publishing are enabled by this deployment template.
- Android packaging, push notifications, distributed device control, and production penetration testing remain outstanding.
- This deployment has not been executed against a real host or Supabase project. Validate the image and migrations in a staging environment first.


## Optional Developer host-supervisor connection

The app can now attempt a fail-closed Developer runtime preflight when all six `MAYA_DEVELOPER_*` and `MAYA_HOST_*` settings in `.env.example` are supplied. The server connects only to the restricted Unix-domain socket or Windows named pipe exposed by the independently operated Maya host supervisor. It verifies a fresh Ed25519-signed, workspace-bound isolation attestation and consumes its nonce through that supervisor. The app receives only the public verification key and a scoped RPC token; it must never receive the supervisor signing private key or Docker socket.

Leave these settings blank unless the host supervisor is installed, its RPC endpoint is reachable by the Maya server process, and a single enrolled workspace plus pinned baseline record already exists. Missing settings keep the runtime unconfigured. Invalid signatures, stale attestations, replayed nonces, symlinked roots, or mismatched workspace bindings fail closed.

This wiring is a readiness integration only. It does not expose patch-apply or execution routes, start the QA worker, or enable autonomous code changes. The runtime status endpoint continues to report execution and QA as disabled until those separate controls are connected and verified. The current Docker Compose template does not mount a host-supervisor socket; do not mount the Docker daemon socket as a workaround.
