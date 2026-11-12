import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  createSignedHostIsolationVerifier,
  hostIsolationAttestationSigningBytes,
  type HostIsolationAttestationPayload,
  type SignedHostIsolationAttestation,
} from "./developer-host-isolation-attestation.ts";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const workspaceId = "workspace-12345678";
const baselineCommit = "a".repeat(40);
const now = new Date("2026-11-12T12:00:00.000Z");

function signed(overrides: Partial<HostIsolationAttestationPayload> = {}): SignedHostIsolationAttestation {
  const payload: HostIsolationAttestationPayload = {
    version: 1,
    issuer: "maya-host-supervisor",
    workspaceId,
    baselineCommit,
    isolated: true,
    networkAccess: false,
    secretsMounted: false,
    issuedAt: new Date(now.getTime() - 1_000).toISOString(),
    expiresAt: new Date(now.getTime() + 10_000).toISOString(),
    nonce: "nonce_abcdefghijklmnopqrstuvwxyz123456",
    ...overrides,
  };
  return {
    ...payload,
    signature: sign(null, hostIsolationAttestationSigningBytes(payload), privateKey).toString("base64url"),
  };
}

function verifier(attestation: SignedHostIsolationAttestation, consumeNonce = async () => true) {
  return createSignedHostIsolationVerifier({
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    expectedIssuer: "maya-host-supervisor",
    getBinding: async () => ({ workspaceId, baselineCommit }),
    getAttestation: async () => attestation,
    consumeNonce,
    now: () => now,
  });
}

test("accepts a fresh, correctly signed, workspace-bound attestation", async () => {
  const result = await verifier(signed()).verify();
  assert.deepEqual(result, { isolated: true, networkAccess: false, secretsMounted: false });
});

test("rejects a signature changed after signing", async () => {
  const attestation = signed({ networkAccess: true });
  attestation.networkAccess = false;
  await assert.rejects(verifier(attestation).verify(), /signature is invalid/);
});

test("rejects an attestation for a different workspace or baseline", async () => {
  const attestation = signed({ workspaceId: "workspace-other123" });
  await assert.rejects(verifier(attestation).verify(), /binding or claim fields are invalid/);
});

test("rejects expired and stale attestations", async () => {
  const attestation = signed({
    issuedAt: new Date(now.getTime() - 60_000).toISOString(),
    expiresAt: new Date(now.getTime() - 1_000).toISOString(),
  });
  await assert.rejects(verifier(attestation).verify(), /expired, stale/);
});

test("rejects a replayed or unpersisted nonce", async () => {
  const attestation = signed();
  await assert.rejects(verifier(attestation, async () => false).verify(), /nonce was already used/);
});

test("rejects an attestation with additional fields", async () => {
  const attestation = { ...signed(), dockerSocketMounted: true } as SignedHostIsolationAttestation;
  await assert.rejects(verifier(attestation).verify(), /unexpected fields/);
});

test("requires an Ed25519 public key and a durable nonce consumer", () => {
  assert.throws(() => createSignedHostIsolationVerifier({
    publicKeyPem: "not a key",
    expectedIssuer: "maya-host-supervisor",
    getBinding: async () => ({ workspaceId, baselineCommit }),
    getAttestation: async () => signed(),
    consumeNonce: async () => true,
  }));
});
