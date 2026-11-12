import http from "node:http";
import type {
  HostIsolationBinding,
  SignedHostIsolationAttestation,
} from "./developer-host-isolation-attestation.ts";

export interface HostSupervisorClientOptions {
  /** Unix-domain socket or Windows named pipe shared with the host service. */
  socketPath: string;
  authToken: string;
  timeoutMs?: number;
}

const MAX_RESPONSE_BYTES = 16 * 1024;

function requestJson<T>(
  options: HostSupervisorClientOptions,
  route: string,
  body: unknown,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request({
      socketPath: options.socketPath,
      path: route,
      method: "POST",
      timeout: options.timeoutMs ?? 5_000,
      headers: {
        authorization: "Bearer " + options.authToken,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
        accept: "application/json",
      },
    }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", chunk => {
        const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += part.length;
        if (size > MAX_RESPONSE_BYTES) {
          response.destroy(new Error("Host supervisor response exceeded the size limit."));
          return;
        }
        chunks.push(part);
      });
      response.on("end", () => {
        const status = response.statusCode ?? 0;
        let parsed: unknown;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch {
          reject(new Error("Host supervisor returned invalid JSON."));
          return;
        }
        if (status < 200 || status >= 300) {
          reject(new Error(`Host supervisor request failed with HTTP ${status}.`));
          return;
        }
        resolve(parsed as T);
      });
    });
    request.on("timeout", () => request.destroy(new Error("Host supervisor request timed out.")));
    request.on("error", reject);
    request.end(payload);
  });
}

/**
 * Creates the app-side RPC adapter consumed by createSignedHostIsolationVerifier.
 * The app receives no Docker socket, signing private key, or nonce-store path.
 */
export function createHostSupervisorClient(options: HostSupervisorClientOptions) {
  if (!options || typeof options.socketPath !== "string" || !options.socketPath.trim() ||
      typeof options.authToken !== "string" || options.authToken.length < 32 ||
      (options.timeoutMs !== undefined &&
        (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 30_000))) {
    throw new Error("Host supervisor client requires a socket path, a 32-character token and a valid timeout.");
  }

  return {
    async getAttestation(binding: HostIsolationBinding): Promise<SignedHostIsolationAttestation> {
      const result = await requestJson<unknown>(options, "/v1/attestation", binding);
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new Error("Host supervisor returned no attestation object.");
      }
      return result as SignedHostIsolationAttestation;
    },

    async consumeNonce(nonce: string, expiresAt: string): Promise<boolean> {
      const result = await requestJson<{ consumed?: unknown }>(
        options,
        "/v1/nonces/consume",
        { nonce, expiresAt },
      );
      if (typeof result?.consumed !== "boolean") {
        throw new Error("Host supervisor returned an invalid nonce-consumption response.");
      }
      return result.consumed;
    },
  };
}
