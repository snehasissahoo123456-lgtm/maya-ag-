import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  inspectDockerWorkerAndAttest,
  type DockerHostSupervisorPolicy,
  type DockerInspectRunner,
} from "./developer-docker-host-supervisor.ts";
import type { SignedHostIsolationAttestation } from "./developer-host-isolation-attestation.ts";

export interface HostSupervisorBinding {
  containerId: string;
  workspaceId: string;
  baselineCommit: string;
}

export interface HostSupervisorNonceConsumer {
  consume(nonce: string, expiresAt: string): Promise<boolean>;
}

export interface DockerHostSupervisorServerOptions {
  /** Absolute Unix socket path, or a Windows named-pipe path. */
  socketPath: string;
  /** Shared only by Maya app and host supervisor; never mount it into the worker. */
  authToken: string;
  /** Host-owned policy. The private key must be loaded from host-only storage. */
  policy: Omit<DockerHostSupervisorPolicy, "workspaceId" | "baselineCommit">;
  /** Resolve only bindings already trusted by the host supervisor. */
  resolveBinding(workspaceId: string, baselineCommit: string): Promise<HostSupervisorBinding | null>;
  nonceStore: HostSupervisorNonceConsumer;
  dockerRunner?: DockerInspectRunner;
}

const MAX_BODY_BYTES = 8 * 1024;
const WORKSPACE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$/;
const GIT_SHA = /^[a-f0-9]{40}$/i;
const NONCE = /^[A-Za-z0-9_-]{32,128}$/;

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function authorized(request: IncomingMessage, token: string): boolean {
  const supplied = request.headers.authorization;
  if (typeof supplied !== "string" || !supplied.startsWith("Bearer ")) return false;
  const candidate = Buffer.from(supplied.slice(7), "utf8");
  const expected = Buffer.from(token, "utf8");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large.");
    chunks.push(part);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("A JSON object is required.");
  return parsed as Record<string, unknown>;
}

/**
 * Small authenticated local transport. The Docker socket and signing key stay
 * on the host; the app receives only signed attestations and nonce-consume RPC.
 */
export async function startDockerHostSupervisorServer(
  options: DockerHostSupervisorServerOptions,
): Promise<Server> {
  if (!options || typeof options.socketPath !== "string" || !options.socketPath.trim() ||
      (!options.socketPath.startsWith("\\\\.\\pipe\\") && !path.isAbsolute(options.socketPath)) ||
      typeof options.authToken !== "string" || options.authToken.length < 32 ||
      !options.policy?.privateKeyPem?.trim() || !options.nonceStore ||
      typeof options.nonceStore.consume !== "function" || typeof options.resolveBinding !== "function") {
    throw new Error("Host supervisor transport configuration is incomplete or unsafe.");
  }

  const server = createServer((request, response) => {
    void (async () => {
      if (!authorized(request, options.authToken)) return send(response, 401, { error: "unauthorized" });
      if (request.method === "GET" && request.url === "/health") {
        return send(response, 200, { ok: true, service: "maya-host-supervisor" });
      }
      if (request.method !== "POST") return send(response, 405, { error: "method_not_allowed" });

      let body: Record<string, unknown>;
      try { body = await readJson(request); } catch {
        return send(response, 400, { error: "invalid_request" });
      }

      if (request.url === "/v1/attestation") {
        const { workspaceId, baselineCommit } = body;
        if (typeof workspaceId !== "string" || !WORKSPACE_ID.test(workspaceId) ||
            typeof baselineCommit !== "string" || !GIT_SHA.test(baselineCommit) ||
            Object.keys(body).sort().join(",") !== "baselineCommit,workspaceId") {
          return send(response, 400, { error: "invalid_binding" });
        }
        const binding = await options.resolveBinding(workspaceId, baselineCommit);
        if (!binding || binding.workspaceId !== workspaceId ||
            binding.baselineCommit.toLowerCase() !== baselineCommit.toLowerCase()) {
          return send(response, 403, { error: "untrusted_binding" });
        }
        const policy: DockerHostSupervisorPolicy = {
          ...options.policy,
          workspaceId: binding.workspaceId,
          baselineCommit: binding.baselineCommit,
        };
        const attestation: SignedHostIsolationAttestation = await inspectDockerWorkerAndAttest(
          binding.containerId, policy, options.dockerRunner,
        );
        return send(response, 200, attestation);
      }

      if (request.url === "/v1/nonces/consume") {
        const { nonce, expiresAt } = body;
        if (typeof nonce !== "string" || !NONCE.test(nonce) ||
            typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt)) ||
            Object.keys(body).sort().join(",") !== "expiresAt,nonce") {
          return send(response, 400, { error: "invalid_nonce" });
        }
        const consumed = await options.nonceStore.consume(nonce, expiresAt);
        return send(response, consumed ? 200 : 409, { consumed });
      }

      return send(response, 404, { error: "not_found" });
    })().catch(() => {
      if (!response.headersSent) send(response, 503, { error: "supervisor_unavailable" });
      else response.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.socketPath, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  if (!options.socketPath.startsWith("\\\\.\\pipe\\")) {
    fs.chmodSync(options.socketPath, 0o600);
  }
  return server;
}
