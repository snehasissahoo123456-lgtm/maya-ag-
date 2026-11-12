# Docker host supervisor attestation core

This module is a host-side policy checker and Ed25519 signer for a dedicated Maya QA worker. Its Docker CLI adapter executes docker inspect with an argument array (no shell), bounds the operation, requires exactly one result, and then verifies the live worker configuration against an explicit host policy. The policy binds the exact container name, immutable image ID, queue/workspace volume sources, workspace ID and baseline commit.

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

This is not yet a running supervisor daemon or an attestation transport. A separately operated host process must call the Docker CLI adapter, load the private key from host-only protected storage, configure the exact expected container/image/volume sources, and publish the signed attestation through a narrowly scoped authenticated channel.

The private key must never be copied into Maya's app or worker containers. Do not mount the Docker socket into either container. The worker must remain disabled until a host daemon, transport, durable nonce consumption, and end-to-end negative tests are deployed and independently verified.

This module does not attest to kernel vulnerabilities, host compromise, storage encryption, or the trustworthiness of the Docker daemon/host OS. Those remain host operational responsibilities.
