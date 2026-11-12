# Durable host-isolation nonce storage

FileHostIsolationNonceStore implements the nonce-consumer contract required by the signed attestation verifier.

## Guarantees

- Uses exclusive filesystem creation as the atomic first-consumer boundary across processes sharing one local filesystem.
- Persists each nonce as a separate mode-0600 record and calls fsync before returning success.
- Retains consumed nonce records after expiry. A consumed nonce is never reusable.
- Rejects malformed nonces, expired timestamps, and a symlinked storage directory.
- Fails closed on unexpected filesystem errors.

## Deployment constraints

- Store the directory on a persistent, access-controlled local volume owned by the independently operated host supervisor.
- Do not mount this directory into Maya's application or worker containers.
- This is a single-host adapter, not a distributed database. Multi-host deployments require a transactional shared nonce store with a unique constraint or equivalent atomic insert.
- The adapter does not create or prove container isolation. The host supervisor must independently measure the runtime and sign its attestation.

## Wiring

Pass the bound method as the verifier's consumeNonce callback:

    const nonceStore = new FileHostIsolationNonceStore(process.env.MAYA_HOST_NONCE_DIR!);
    const verifier = createSignedHostIsolationVerifier({
      // trusted public key, issuer, workspace binding and attestation source
      consumeNonce: (nonce, expiresAt) => nonceStore.consume(nonce, expiresAt),
    });

Do not point this path at an application-writable directory.
