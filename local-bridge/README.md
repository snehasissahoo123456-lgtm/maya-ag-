# Maya local device bridge

This connector gives Maya a **read-only** view of one explicitly selected local workspace. It does not expose a remote shell, write/delete operations, browser sessions, keystrokes, screenshots, or arbitrary application control.

## First pairing

1. Run the Maya server with authentication configured.
2. Sign in as Founder and create a one-time pairing code in the Devices workspace/API.
3. On the Windows PC, open PowerShell in this repository and run `scripts/Start-Maya-Bridge.ps1`.
4. Enter the Maya server URL and the one-time pairing code when prompted.
5. The bridge stores the device credential file locally at `%USERPROFILE%\.maya\device-bridge.json`; the server stores only the device-token hash.

Subsequent starts reuse the saved device credential. Delete that file and revoke the device in Maya to pair again.

## Workspace scope

By default, the bridge exposes the directory from which the PowerShell script was started (the repository root). Set `MAYA_WORKSPACE_ROOT` to a narrower directory before starting if required. Sensitive paths such as `.env`, `.git`, `node_modules`, `.maya`, keys, certificates and credential files are blocked. Symbolic links are not followed.

## Available commands

- `system.info`
- `workspace.list`
- `workspace.read_file` (regular text files up to 50 KB)

The server accepts no other device command. The connector requires WSS for remote servers; plain WS is accepted only for localhost development. Keep the pairing code private and do not commit the credential file.
