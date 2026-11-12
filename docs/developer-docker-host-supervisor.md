# Docker host supervisor attestation core

This module is a host-side policy checker and Ed25519 signer for a dedicated Maya QA worker. It accepts a Docker Engine inspect object, verifies the live worker configuration against an explicit host policy, and emits the signed payload consumed by the existing attestation verifier.

## Checks

- Running container and exact host-approved image ID.
- Unprivileged node user; Docker network mode none; read-only root filesystem.
- All Linux capabilities dropped, none added; no-new-privileges enabled.
- No privileged mode, host PID/IPC, devices, bind mounts, or extra volumes.
- Only the approved queue and workspace named volumes are mounted.
- /tmp is noexec,nosuid tmpfs.
- PID, memory and CPU limits are present and bounded.
- No credential-like environment variable is present.
- Ed25519-signed, short-lived, workspace/baseline-bound payload with a fresh random nonce.

## Deployment boundary

This is not yet a running supervisor daemon and does not connect to the Docker Engine itself. A separately operated host process must obtain the live inspect object from the local Docker Engine, load the private key from host-only protected storage, configure the exact expected image and volume sources, and publish the signed attestation through a narrowly scoped authenticated channel.

The private key must never be copied into Maya's app or worker containers. Do not mount the Docker socket into either container. The worker must remain disabled until a host daemon, transport, durable nonce consumption, and end-to-end negative tests are deployed and independently verified.

This module does not attest to kernel vulnerabilities, host compromise, storage encryption, or the trustworthiness of the Docker daemon/host OS. Those remain host operational responsibilities.
