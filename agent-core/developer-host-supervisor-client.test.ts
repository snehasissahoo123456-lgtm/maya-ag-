import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSignedHostIsolationVerifier } from "./developer-host-isolation-attestation.ts";
import { FileHostIsolationNonceStore } from "./developer-host-isolation-nonce-store.ts";
import { createHostSupervisorClient } from "./developer-host-supervisor-client.ts";
import { startDockerHostSupervisorServer } from "./developer-host-supervisor-server.ts";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const token = "client-test-token-with-at-least-thirty-two-characters";
const workspaceId = "workspace-client-123";
const baselineCommit = "c".repeat(40);

function inspection() {
  return {
    Name: "/maya-developer-sandbox-client",
    Image: "sha256:" + "d".repeat(64),
    State: { Running: true, Status: "running" },
    Config: { User: "node", Env: ["NODE_ENV=test"] },
    HostConfig: {
      NetworkMode: "none", ReadonlyRootfs: true, Privileged: false, PidMode: "", IpcMode: "",
      CapAdd: [], CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges:true"], Devices: [], Binds: [],
      PidsLimit: 128, Memory: 2 * 1024 * 1024 * 1024, NanoCpus: 2_000_000_000,
      Tmpfs: { "/tmp": "rw,noexec,nosuid,size=134217728" },
    },
    Mounts: [
      { Type: "volume", Source: "/host/maya-queue", Destination: "/developer-queue", RW: true },
      { Type: "volume", Source: "/host/maya-workspaces", Destination: "/developer-workspaces", RW: true },
    ],
  };
}

test("Maya client completes signed attestation verification and host-side nonce consumption over local RPC", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-supervisor-client-"));
  const socketPath = path.join(directory, "supervisor.sock");
  const server = await startDockerHostSupervisorServer({
    socketPath,
    authToken: token,
    policy: {
      issuer: "maya-host-supervisor-client-test",
      privateKeyPem,
      expectedContainerName: "maya-developer-sandbox-client",
      expectedImageId: "sha256:" + "d".repeat(64),
      expectedQueueVolumeSource: "/host/maya-queue",
      expectedWorkspaceVolumeSource: "/host/maya-workspaces",
    },
    resolveBinding: async (workspace, baseline) => ({
      containerId: "e".repeat(64), workspaceId: workspace, baselineCommit: baseline,
    }),
    nonceStore: new FileHostIsolationNonceStore(path.join(directory, "nonces")),
    dockerRunner: async () => JSON.stringify([inspection()]),
  });

  try {
    const client = createHostSupervisorClient({ socketPath, authToken: token });
    const verifier = createSignedHostIsolationVerifier({
      publicKeyPem,
      expectedIssuer: "maya-host-supervisor-client-test",
      getBinding: async () => ({ workspaceId, baselineCommit }),
      getAttestation: () => client.getAttestation({ workspaceId, baselineCommit }),
      consumeNonce: (nonce, expiresAt) => client.consumeNonce(nonce, expiresAt),
    });
    assert.deepEqual(await verifier.verify(), {
      isolated: true, networkAccess: false, secretsMounted: false,
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Maya host supervisor client rejects invalid configuration and failed RPC responses", async () => {
  assert.throws(() => createHostSupervisorClient({
    socketPath: "/tmp/maya.sock", authToken: "short",
  }), /requires a socket path/);
  const client = createHostSupervisorClient({
    socketPath: "/tmp/maya-supervisor-socket-that-does-not-exist.sock",
    authToken: token,
    timeoutMs: 500,
  });
  await assert.rejects(
    client.getAttestation({ workspaceId, baselineCommit }),
  );
});
