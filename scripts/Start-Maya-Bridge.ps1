$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

if (-not $env:MAYA_SERVER_URL) {
  $env:MAYA_SERVER_URL = Read-Host "Maya server URL (for example https://your-maya-host)"
}
if (-not $env:MAYA_WORKSPACE_ROOT) {
  $env:MAYA_WORKSPACE_ROOT = (Get-Location).Path
}
$Credentials = Join-Path $HOME ".maya\device-bridge.json"
if (-not (Test-Path $Credentials) -and -not $env:MAYA_PAIRING_CODE) {
  $env:MAYA_PAIRING_CODE = Read-Host "One-time pairing code from Maya > Devices"
}

Write-Host "Starting Maya local device bridge."
Write-Host "Workspace root: $env:MAYA_WORKSPACE_ROOT"
Write-Host "Direct commands are read-only. Existing-file replacement is available only through a separate exact-Founder-approved task."
node --import tsx local-bridge.ts
