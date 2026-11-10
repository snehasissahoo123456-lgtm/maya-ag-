param(
  [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$StartupConfig = Join-Path $env:LOCALAPPDATA "Maya\bridge-startup.json"
if (Test-Path $StartupConfig) {
  try { $SavedConfig = Get-Content -Raw -Path $StartupConfig | ConvertFrom-Json }
  catch { if ($NonInteractive) { throw "Maya bridge startup configuration is invalid." } }
  if ($SavedConfig) {
    if (-not $env:MAYA_SERVER_URL) { $env:MAYA_SERVER_URL = [string]$SavedConfig.serverUrl }
    if (-not $env:MAYA_WORKSPACE_ROOT) { $env:MAYA_WORKSPACE_ROOT = [string]$SavedConfig.workspaceRoot }
    if (-not $env:MAYA_DEVICE_CREDENTIAL_FILE) { $env:MAYA_DEVICE_CREDENTIAL_FILE = [string]$SavedConfig.credentialsFile }
  }
} elseif ($NonInteractive) {
  throw "Maya bridge startup configuration is missing. Run scripts\Install-Maya-Bridge-Startup.ps1 after pairing the device."
}

$CredentialsFile = if ($env:MAYA_DEVICE_CREDENTIAL_FILE) {
  [System.IO.Path]::GetFullPath($env:MAYA_DEVICE_CREDENTIAL_FILE)
} else {
  Join-Path $HOME ".maya\device-bridge.json"
}

if (-not $env:MAYA_SERVER_URL -and (Test-Path $CredentialsFile)) {
  try {
    $SavedCredentials = Get-Content -Raw -Path $CredentialsFile | ConvertFrom-Json
    if ($SavedCredentials.serverUrl) { $env:MAYA_SERVER_URL = [string]$SavedCredentials.serverUrl }
  } catch {
    if ($NonInteractive) { throw "The saved Maya device credentials are invalid." }
  }
}

if (-not $env:MAYA_SERVER_URL) {
  if ($NonInteractive) { throw "MAYA_SERVER_URL is missing from the startup configuration." }
  $env:MAYA_SERVER_URL = Read-Host "Maya server URL (for example https://your-maya-host)"
}
try { $ParsedServerUrl = [Uri]$env:MAYA_SERVER_URL }
catch { throw "MAYA_SERVER_URL is not a valid URL." }
if ($ParsedServerUrl.Scheme -ne "https" -and -not ($ParsedServerUrl.Scheme -eq "http" -and @("localhost", "127.0.0.1") -contains $ParsedServerUrl.Host)) {
  throw "Remote device bridge connections require HTTPS/WSS. HTTP is allowed only for localhost."
}

if (-not $env:MAYA_WORKSPACE_ROOT) { $env:MAYA_WORKSPACE_ROOT = (Get-Location).Path }
$env:MAYA_WORKSPACE_ROOT = [System.IO.Path]::GetFullPath($env:MAYA_WORKSPACE_ROOT)
if (-not (Test-Path $env:MAYA_WORKSPACE_ROOT -PathType Container)) {
  throw "MAYA_WORKSPACE_ROOT must be an existing directory."
}

if (Test-Path $CredentialsFile) {
  try { $SavedCredentials = Get-Content -Raw -Path $CredentialsFile | ConvertFrom-Json }
  catch { throw "The local Maya device credential file is not valid JSON." }
  if ([string]$SavedCredentials.serverUrl -ne $env:MAYA_SERVER_URL) {
    throw "MAYA_SERVER_URL does not match the server URL saved during device pairing."
  }
} elseif (-not $env:MAYA_PAIRING_CODE) {
  if ($NonInteractive) { throw "This PC is not paired. Run scripts\Start-Maya-Bridge.ps1 manually and complete pairing before installing startup." }
  $env:MAYA_PAIRING_CODE = Read-Host "One-time pairing code from Maya > Devices"
}

Write-Host "Starting Maya local device bridge."
Write-Host "Workspace root: $env:MAYA_WORKSPACE_ROOT"
Write-Host "Direct commands are read-only: system information, directory listing, bounded text search, file reading and Git status."
Write-Host "File replacement, file creation, directory creation and non-overwriting file moves require a separate exact-Founder-approved task."
Write-Host "No shell, permanent deletion, browser control, keystrokes or arbitrary app control is enabled."

if ($NonInteractive) {
  $LogDirectory = Join-Path $env:LOCALAPPDATA "Maya"
  New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
  $LogFile = Join-Path $LogDirectory "bridge.log"
  if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt 10MB) {
    Move-Item -LiteralPath $LogFile -Destination "$LogFile.1" -Force
  }
  node --import tsx local-bridge.ts *>> $LogFile
} else {
  node --import tsx local-bridge.ts
}
