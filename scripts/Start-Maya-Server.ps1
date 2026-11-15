param()

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$EnvFile = Join-Path $RepoRoot ".env"
$ServerBundle = Join-Path $RepoRoot "dist/server.cjs"
if (-not (Test-Path $EnvFile -PathType Leaf)) { throw "Maya .env is missing. Run scripts\Activate-Maya.ps1 first." }
if (-not (Test-Path $ServerBundle -PathType Leaf)) { throw "Maya production bundle is missing. Run scripts\Activate-Maya.ps1 to build it." }

$NodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $NodeCommand) { $NodeCommand = Get-Command node -ErrorAction Stop }
$NodeVersionText = (& $NodeCommand.Source --version).Trim()
if ($NodeVersionText -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) {
  throw "Maya requires Node.js 22 or newer. Detected $NodeVersionText."
}

$LogDirectory = Join-Path $env:LOCALAPPDATA "Maya\server-logs"
New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
$LogFile = Join-Path $LogDirectory "maya-server.log"
if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt 10MB) {
  Move-Item -LiteralPath $LogFile -Destination "$LogFile.1" -Force
}

Write-Host "Starting Maya server as the current Windows user (limited privileges)."
Write-Host "Logs: $LogFile"
Write-Host "This local startup task runs only while this Windows user is logged in."
node --env-file-if-exists=.env dist/server.cjs *>> $LogFile
