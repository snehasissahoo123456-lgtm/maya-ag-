import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileHostIsolationNonceStore } from "./developer-host-isolation-nonce-store.ts";
import { startDockerHostSupervisorServer } from "./developer-host-supervisor-server.ts";

const { privateKey } = generateKeyPairSync("ed25519");
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const token = "test-only-supervisor-token-with-at-least-32-characters";

function inspection() {
  return {
    Name: "/maya-developer-sandbox-1",
    Image: "sha256:" + "b".repeat(64),
    State: { Running: true, Status: "running" },
    Config: { User: "node", Env: ["NODE_ENV=test"] },
    HostConfig: {
      NetworkMode: "none", ReadonlyRootfs: true, Privileged: false, PidMode: "", IpcMode: "",
      CapAdd: [], CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges:true"], Devices: [], Binds: [],
      PidsLimit: 128, Memory: 2 * 1024 * 1024 * 1024, NanoCpus: 2_000_000_000,
      Tmpfs: { "/tmp": "rw,noexec,nosuid,size=134217728" },
    },
    Mounts: [
      { Type: "volume", Source: "/var/lib/docker/volumes/maya-queue/_data", Destination: "/developer-queue", RW: true },
      { Type: "volume", Source: "/var/lib/docker/volumes/maya-workspaces/_data", Destination: "/developer-workspaces", RW: true },
    ],
  };
}

function request(socketPath: string, route: string, method = "POST", body?: unknown, auth = token) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const req = http.request({
      socketPath, path: route, method,
      headers: {
        ...(auth ? { authorization: "Bearer " + auth } : {}),
        ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
      },
    }, response => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        try { resolve({ status: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); }
        catch (error) { reject(error); }
      });
    });
    req.on("error", reject);
    req.end(payload);
  });
}

test("host supervisor transport authenticates callers and returns signed live-inspection attestations", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-host-supervisor-"));
  const socketPath = path.join(directory, "supervisor.sock");
  const server = await startDockerHostSupervisorServer({
    socketPath,
    authToken: token,
    policy: {
      issuer: "maya-host-supervisor-test",
      privateKeyPem,
      expectedContainerName: "maya-developer-sandbox-1",
      expectedImageId: "sha256:" + "b".repeat(64),
      expectedQueueVolumeSource: "/var/lib/docker/volumes/maya-queue/_data",
      expectedWorkspaceVolumeSource: "/var/lib/docker/volumes/maya-workspaces/_data",
    },
    resolveBinding: async (workspaceId, baselineCommit) => ({
      containerId: "a".repeat(64), workspaceId, baselineCommit,
    }),
    nonceStore: new FileHostIsolationNonceStore(path.join(directory, "nonces")),
    dockerRunner: async () => JSON.stringify([inspection()]),
  });

  try {
    assert.equal((await request(socketPath, "/health", "GET", undefined, "wrong-token")).status, 401);
    const result = await request(socketPath, "/v1/attestation", "POST", {
      workspaceId: "workspace-123456", baselineCommit: "a".repeat(40),
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.isolated, true);
    assert.equal(typeof result.body.signature, "string");
    assert.equal(fs.statSync(socketPath).mode & 0o777, 0o600);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("host supervisor refuses untrusted workspace bindings and consumes each nonce once", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-host-supervisor-"));
  const socketPath = path.join(directory, "supervisor.sock");
  const nonceStore = new FileHostIsolationNonceStore(path.join(directory, "nonces"));
  const server = await startDockerHostSupervisorServer({
    socketPath,
    authToken: token,
    policy: {
      issuer: "maya-host-supervisor-test", privateKeyPem,
      expectedContainerName: "maya-developer-sandbox-1",
      expectedImageId: "sha256:" + "b".repeat(64),
      expectedQueueVolumeSource: "/var/lib/docker/volumes/maya-queue/_data",
      expectedWorkspaceVolumeSource: "/var/lib/docker/volumes/maya-workspaces/_data",
    },
    resolveBinding: async () => null,
    nonceStore,
    dockerRunner: async () => JSON.stringify([inspection()]),
  });

  try {
    const denied = await request(socketPath, "/v1/attestation", "POST", {
      workspaceId: "workspace-123456", baselineCommit: "a".repeat(40),
    });
    assert.equal(denied.status, 403);
    const nonce = "n".repeat(43);
    const expiresAt = new Date(Date.now() + 10_000).toISOString();
    const first = await request(socketPath, "/v1/nonces/consume", "POST", { nonce, expiresAt });
    const replay = await request(socketPath, "/v1/nonces/consume", "POST", { nonce, expiresAt });
    assert.equal(first.status, 200);
    assert.equal(first.body.consumed, true);
    assert.equal(replay.status, 409);
    assert.equal(replay.body.consumed, false);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
