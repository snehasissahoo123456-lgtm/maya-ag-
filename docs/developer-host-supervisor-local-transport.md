# Maya host supervisor local transport

This module provides the authenticated local RPC boundary between the Maya application and a separately operated host supervisor.

## Endpoints

- `GET /health` returns a minimal health response.
- `POST /v1/attestation` accepts exactly a workspace ID and baseline commit. A host-owned resolver must map that pair to a trusted worker container ID. The supervisor inspects that exact container and signs a short-lived attestation.
- `POST /v1/nonces/consume` atomically consumes an attestation nonce through the host-owned durable nonce store. Replays return HTTP 409.

Every endpoint requires a bearer token of at least 32 characters. Comparisons use constant-time byte comparison. Request bodies are capped at 8 KiB; responses are non-cacheable. The server listens on an absolute Unix-domain socket (mode 0600) or a Windows named pipe. It does not expose a TCP listener.

## Trust boundaries

Run this server as a dedicated host-side process, outside the Maya app and worker containers. Load the Ed25519 private key and bearer token from host-protected secret storage. Keep the Docker CLI and Docker socket on the host; never mount the Docker socket or signing key into either container. Mount the local socket only into the Maya app container, with permissions restricted to the app identity. Do not mount it into the developer worker.

The `resolveBinding` callback is security-critical. It must return a container ID only when the workspace ID and baseline commit are present in a host-trusted allowlist or durable host-side job record. It must not accept caller-supplied container IDs or create bindings on demand.

The app needs the matching bearer token, supervisor public key, and a verifier adapter that calls these two endpoints. The private key and nonce directory remain host-only. The server module is a transport library: it is not yet installed as a service, automatically configured by Compose, or wired into Maya's live DeveloperExecutionRuntime. Do not enable the worker based on these tests alone.

## Validation boundary

Tests exercise authenticated Unix-socket requests, trusted-binding rejection, Docker-inspection handoff, socket permissions, and durable nonce replay rejection using a fake Docker inspection runner. They do not prove a real host daemon deployment, production socket mounting, Docker runtime compatibility, or host integrity. End-to-end deployment and negative tests remain mandatory.
