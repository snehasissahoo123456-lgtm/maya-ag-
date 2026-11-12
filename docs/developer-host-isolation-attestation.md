# Signed host isolation attestation

`createSignedHostIsolationVerifier` adapts a signed host-supervisor attestation to the `DeveloperFilesystemIsolation` interface.

## Trust model

- The supervisor signs a fixed, versioned payload with an Ed25519 private key.
- Maya receives only the public key. The signing key must remain outside the Maya application and sandbox containers.
- The attestation binds the workspace ID and immutable baseline commit to three claims: isolated, network access, and secrets mounted.
- The verifier checks the issuer, exact payload fields, signature, workspace/baseline binding, freshness window, expiry and nonce.
- A durable, atomic nonce consumer is mandatory. If nonce persistence is unavailable or a nonce was used already, verification fails closed.

## Integration contract

The host integration must supply:
1. A trusted binding lookup for the workspace ID and baseline commit.
2. A fresh attestation fetched from the independently operated host supervisor.
3. An atomic durable nonce consumer that rejects duplicate nonces until expiry.
4. The supervisor's Ed25519 public key and expected issuer.

The supervisor must measure actual runtime properties from a trusted host boundary. It must not sign claims copied from application-supplied environment variables, Compose labels, or request parameters.

## Important limitation

This module verifies the authenticity and freshness of supervisor claims. It does not create isolation, inspect the container runtime, prevent the host from lying, or implement the supervisor service. Until a separately trusted supervisor is deployed and its measurement path is reviewed, Maya must remain blocked from applying Developer patches. The verifier is not wired into the server or enabled by this change.
