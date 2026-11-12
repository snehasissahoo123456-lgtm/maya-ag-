import { createPublicKey, verify as verifySignature } from "node:crypto";
import type { DeveloperFilesystemIsolation } from "./developer-filesystem-workspace-adapter.ts";

const WORKSPACE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$/;
const GIT_SHA = /^[a-f0-9]{40}$/i;
const NONCE = /^[A-Za-z0-9_-]{32,128}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;

export interface HostIsolationAttestationPayload {
  version: 1;
  issuer: string;
  workspaceId: string;
  baselineCommit: string;
  isolated: boolean;
  networkAccess: boolean;
  secretsMounted: boolean;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
}

export interface SignedHostIsolationAttestation extends HostIsolationAttestationPayload {
  signature: string;
}

export interface HostIsolationBinding {
  workspaceId: string;
  baselineCommit: string;
}

export interface SignedHostIsolationVerifierOptions {
  /** Public Ed25519 key for the independently operated host supervisor. */
  publicKeyPem: string;
  expectedIssuer: string;
  getBinding(): Promise<HostIsolationBinding>;
  getAttestation(): Promise<SignedHostIsolationAttestation>;
  /** Must atomically persist and reject a previously consumed nonce. */
  consumeNonce(nonce: string, expiresAt: string): Promise<boolean>;
  now?: () => Date;
  maxAttestationAgeMs?: number;
  clockSkewMs?: number;
}

const MAX_AGE_MS = 30_000;
const CLOCK_SKEW_MS = 5_000;

export function hostIsolationAttestationSigningBytes(
  payload: HostIsolationAttestationPayload,
): Buffer {
  // Fixed property order is the wire-format canonicalization contract.
  return Buffer.from(JSON.stringify({
    version: payload.version,
    issuer: payload.issuer,
    workspaceId: payload.workspaceId,
    baselineCommit: payload.baselineCommit.toLowerCase(),
    isolated: payload.isolated,
    networkAccess: payload.networkAccess,
    secretsMounted: payload.secretsMounted,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    nonce: payload.nonce,
  }), "utf8");
}

/**
 * Verifies fresh, workspace-bound Ed25519 attestations from an independent host
 * supervisor. A durable atomic nonce consumer is mandatory to prevent replay.
 * This verifies signed claims; it does not itself create OS/container isolation.
 */
export function createSignedHostIsolationVerifier(
  options: SignedHostIsolationVerifierOptions,
): DeveloperFilesystemIsolation {
  if (!options || typeof options.publicKeyPem !== "string" ||
      typeof options.expectedIssuer !== "string" || !options.expectedIssuer.trim() ||
      typeof options.getBinding !== "function" ||
      typeof options.getAttestation !== "function" ||
      typeof options.consumeNonce !== "function") {
    throw new Error("Signed host isolation verification requires a public key, issuer, binding, attestation source and durable nonce consumer.");
  }

  const publicKey = createPublicKey(options.publicKeyPem);
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Host isolation attestation public key must be Ed25519.");
  }
  const maxAgeMs = options.maxAttestationAgeMs ?? MAX_AGE_MS;
  const clockSkewMs = options.clockSkewMs ?? CLOCK_SKEW_MS;
  if (!Number.isInteger(maxAgeMs) || maxAgeMs < 1_000 || maxAgeMs > MAX_AGE_MS ||
      !Number.isInteger(clockSkewMs) || clockSkewMs < 0 || clockSkewMs > 30_000) {
    throw new Error("Host attestation freshness limits are invalid.");
  }

  return {
    async verify() {
      const [binding, attestation] = await Promise.all([
        options.getBinding(),
        options.getAttestation(),
      ]);
      if (!binding || !WORKSPACE_ID.test(binding.workspaceId) ||
          !GIT_SHA.test(binding.baselineCommit)) {
        throw new Error("Trusted host isolation binding is invalid.");
      }
      if (!attestation || typeof attestation !== "object" || Array.isArray(attestation)) {
        throw new Error("Host supervisor returned no signed isolation attestation.");
      }
      const keys = Object.keys(attestation).sort().join(",");
      if (keys !== [
        "baselineCommit", "expiresAt", "isolated", "issuedAt", "issuer",
        "networkAccess", "nonce", "secretsMounted", "signature", "version", "workspaceId",
      ].sort().join(",")) {
        throw new Error("Host isolation attestation contains missing or unexpected fields.");
      }
      const {
        version, issuer, workspaceId, baselineCommit, isolated, networkAccess,
        secretsMounted, issuedAt, expiresAt, nonce, signature,
      } = attestation;
      if (version !== 1 || issuer !== options.expectedIssuer ||
          workspaceId !== binding.workspaceId ||
          typeof baselineCommit !== "string" ||
          baselineCommit.toLowerCase() !== binding.baselineCommit.toLowerCase() ||
          !GIT_SHA.test(baselineCommit) ||
          typeof isolated !== "boolean" || typeof networkAccess !== "boolean" ||
          typeof secretsMounted !== "boolean" ||
          typeof issuedAt !== "string" || typeof expiresAt !== "string" ||
          !NONCE.test(nonce) || typeof signature !== "string" || !SIGNATURE.test(signature)) {
        throw new Error("Host isolation attestation identity, binding or claim fields are invalid.");
      }

      const payload: HostIsolationAttestationPayload = {
        version, issuer, workspaceId, baselineCommit, isolated, networkAccess,
        secretsMounted, issuedAt, expiresAt, nonce,
      };
      const signatureBytes = Buffer.from(signature, "base64url");
      if (signatureBytes.toString("base64url") !== signature ||
          !verifySignature(null, hostIsolationAttestationSigningBytes(payload), publicKey, signatureBytes)) {
        throw new Error("Host isolation attestation signature is invalid.");
      }

      const issued = Date.parse(issuedAt);
      const expires = Date.parse(expiresAt);
      const now = (options.now?.() ?? new Date()).getTime();
      if (!Number.isFinite(issued) || !Number.isFinite(expires) ||
          issued > now + clockSkewMs || expires <= now ||
          expires <= issued || expires - issued > maxAgeMs ||
          now - issued > maxAgeMs + clockSkewMs) {
        throw new Error("Host isolation attestation is expired, stale or outside the allowed clock window.");
      }
      if (!await options.consumeNonce(nonce, expiresAt)) {
        throw new Error("Host isolation attestation nonce was already used or could not be persisted.");
      }
      return { isolated, networkAccess, secretsMounted };
    },
  };
}
