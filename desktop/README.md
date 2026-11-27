# Maya Windows desktop packaging

This branch adds an Electron shell around the existing Maya production web app and Node/Express backend. It does not expand the agent's tool permissions or turn prototype capabilities into production features.

## Build locally on Windows

Prerequisites: Windows 10/11 x64, Node.js 22+, Bun 1.4.4, and the Visual C++ Build Tools / Windows SDK required by native packaging dependencies.

\`\`\`powershell
bun install --frozen-lockfile
bun run lint
bun run test
bun run build
npm install --omit=dev --no-package-lock
npx --yes electron-builder@26.0.12 --win nsis --x64 --publish never --config electron-builder.yml
\`\`\`

The installer is written to \`release/Maya-Setup-<version>-x64.exe\`.

## First launch

1. Install and launch Maya.
2. Enter the Founder email and a unique password of at least 16 characters.
3. Optionally enter a Gemini API key. Gemini usage may incur Google API charges.
4. Maya stores the configuration encrypted using Electron safeStorage backed by Windows credential protection.
5. The desktop shell starts the existing backend on loopback only and opens the local UI.

The credentials are local to the Windows user profile. The Gemini key is passed to the backend process and is not embedded in the installer or repository. Use the Maya menu to reconfigure the Founder account or API key.

## Data and security

- Application data is stored under Electron's per-user \`userData\` directory.
- The local backend binds to \`127.0.0.1\` when launched by the desktop shell. Docker/server deployments retain their existing default bind address.
- Renderer Node integration is disabled, context isolation and sandboxing are enabled, and the setup page communicates through a narrow preload IPC method.
- Background task, plan and schedule workers remain disabled by default.
- The app does not add arbitrary shell execution, general browser automation, unrestricted desktop control, or unverified integrations.

## CI and publishing

\`.github/workflows/maya-windows.yml\` runs the existing typecheck, test and production build on Windows, creates the NSIS installer, installs it silently, and smoke-tests the packaged backend through the installed Electron runtime. Only after that smoke test succeeds does the workflow upload the EXE artifact and publish a GitHub prerelease for branch pushes.

The workflow's smoke test verifies that the installed executable can launch the packaged backend and that \`/api/health\` returns HTTP 200. It does not constitute full interactive UI, Gemini credential, device-bridge, or end-to-end agent acceptance testing.
