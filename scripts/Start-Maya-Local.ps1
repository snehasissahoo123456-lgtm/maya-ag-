param(
  [switch]$EnableWorkers,
  [switch]$EnableSchedules,
  [ValidateRange(1024, 65535)]
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

if ($EnableSchedules -and -not $EnableWorkers) {
  throw "Scheduled jobs require -EnableWorkers. Start both explicitly with -EnableWorkers -EnableSchedules."
}

$EnvFile = Join-Path $RepoRoot ".env"
if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
  throw "Missing .env. First run: Copy-Item .env.example .env, then set MAYA_FOUNDER_PASSWORD and GEMINI_API_KEY locally."
}

function Get-ConfiguredValue {
  param([Parameter(Mandatory = $true)][string]$Name)

  $processValue = [Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not [string]::IsNullOrWhiteSpace($processValue)) {
    return $processValue.Trim()
  }

  foreach ($line in Get-Content -LiteralPath $EnvFile) {
    if ($line -match ("^\s*" + [regex]::Escape($Name) + "\s*=\s*(.*?)\s*$")) {
      $value = $Matches[1].Trim()
      if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      return $value.Trim()
    }
  }
  return ""
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is missing. Install Node.js 22 or newer, then reopen PowerShell."
}
$nodeVersion = (& node --version).Trim()
if ($nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) {
  throw "Maya requires Node.js 22 or newer. Detected: $nodeVersion"
}
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  throw "Bun is missing. Install Bun, then reopen PowerShell."
}
if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot "node_modules") -PathType Container)) {
  throw "Dependencies are not installed. Run: bun install --frozen-lockfile"
}

$founderPassword = Get-ConfiguredValue -Name "MAYA_FOUNDER_PASSWORD"
if ([string]::IsNullOrWhiteSpace($founderPassword)) {
  throw "MAYA_FOUNDER_PASSWORD is empty. Set a strong local Founder password in .env. The value is never printed."
}
$geminiKey = Get-ConfiguredValue -Name "GEMINI_API_KEY"
if ([string]::IsNullOrWhiteSpace($geminiKey)) {
  $geminiKey = Get-ConfiguredValue -Name "API_KEY"
}
if ([string]::IsNullOrWhiteSpace($geminiKey)) {
  throw "Gemini is not configured. Set GEMINI_API_KEY in .env. The value is never printed."
}

$storageDriver = Get-ConfiguredValue -Name "MAYA_STORAGE_DRIVER"
if ([string]::IsNullOrWhiteSpace($storageDriver)) { $storageDriver = "file" }
if ($EnableWorkers -and $storageDriver.ToLowerInvariant() -ne "file") {
  throw "The combined local task + goal-plan worker profile requires MAYA_STORAGE_DRIVER=file. The plan worker is not approved for Supabase/multi-instance operation yet."
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  throw "Port $Port is already in use. Stop the existing Maya process or rerun with -Port and an available port."
}

$env:PORT = [string]$Port
$env:MAYA_TASK_WORKER_ENABLED = if ($EnableWorkers) { "true" } else { "false" }
$env:MAYA_PLAN_WORKER_ENABLED = if ($EnableWorkers) { "true" } else { "false" }
$env:MAYA_SCHEDULE_WORKER_ENABLED = if ($EnableSchedules) { "true" } else { "false" }

Write-Host ""
Write-Host "Maya local Founder runtime preflight passed."
Write-Host "URL: http://localhost:$Port"
Write-Host "Storage: $storageDriver"
Write-Host "Task worker: $($env:MAYA_TASK_WORKER_ENABLED)"
Write-Host "Goal-plan worker: $($env:MAYA_PLAN_WORKER_ENABLED)"
Write-Host "Read-only schedule worker: $($env:MAYA_SCHEDULE_WORKER_ENABLED)"
Write-Host "Gemini credential: configured (value hidden)"
Write-Host ""
Write-Host "High-risk actions still require exact Founder approval. This does not enable arbitrary shell, browser control, unrestricted PC access, deployment, or 24/7 hosting."
Write-Host "Press Ctrl+C to stop Maya."
Write-Host ""

& bun run dev
if ($LASTEXITCODE -ne 0) {
  throw "Maya exited with code $LASTEXITCODE. Review the server output above."
}
