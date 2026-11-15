param(
  [switch]$InstallStartupTask,
  [switch]$NoStart,
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion.Major -lt 7) { throw "Run this script with PowerShell 7 or newer (pwsh)." }
if ($ValidateOnly) { Write-Host "Maya activation script syntax is valid."; exit 0 }
if ($InstallStartupTask -and $NoStart) { throw "Do not combine -InstallStartupTask and -NoStart." }

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot
$EnvFile = Join-Path $RepoRoot ".env"
$ExampleFile = Join-Path $RepoRoot ".env.example"
if (-not (Test-Path $EnvFile)) {
  if (-not (Test-Path $ExampleFile)) { throw ".env.example was not found." }
  Copy-Item -LiteralPath $ExampleFile -Destination $EnvFile
  Write-Host "Created .env from .env.example. Existing secret values will be preserved."
}
$script:EnvLines = [System.Collections.Generic.List[string]]::new()
Get-Content -LiteralPath $EnvFile | ForEach-Object { $script:EnvLines.Add([string]$_) }

function Get-EnvValue([string]$Key) {
  $Pattern = '^\s*' + [regex]::Escape($Key) + '\s*='
  $Line = $script:EnvLines | Where-Object { $_ -match $Pattern } | Select-Object -Last 1
  if (-not $Line) { return "" }
  $Raw = $Line.Substring($Line.IndexOf("=") + 1).Trim()
  if ($Raw.Length -ge 2 -and $Raw.StartsWith('"') -and $Raw.EndsWith('"')) {
    try { return [string](ConvertFrom-Json -InputObject $Raw) } catch { return $Raw.Trim('"') }
  }
  if ($Raw.Length -ge 2 -and $Raw.StartsWith("'") -and $Raw.EndsWith("'")) { return $Raw.Substring(1, $Raw.Length - 2) }
  return $Raw
}

function Set-EnvValue([string]$Key, [string]$Value) {
  if ($Value.Contains([char]10) -or $Value.Contains([char]13)) { throw "$Key cannot contain a newline." }
  if ($Value -match '^[A-Za-z0-9_./:@+-]+$') {
    $Encoded = $Value
  } else {
    $Escaped = $Value.Replace('\', '\\').Replace('"', '\"')
    $Encoded = '"' + $Escaped + '"'
  }
  $Pattern = '^\s*' + [regex]::Escape($Key) + '\s*='
  $Indices = @()
  for ($Index = 0; $Index -lt $script:EnvLines.Count; $Index++) {
    if ($script:EnvLines[$Index] -match $Pattern) { $Indices += $Index }
  }
  if ($Indices.Count -eq 0) {
    $script:EnvLines.Add("$Key=$Encoded")
  } else {
    $script:EnvLines[$Indices[0]] = "$Key=$Encoded"
    for ($Index = $Indices.Count - 1; $Index -ge 1; $Index--) { $script:EnvLines.RemoveAt($Indices[$Index]) }
  }
}

function Read-Secret([string]$Prompt, [int]$MinimumLength) {
  $Secure = Read-Host $Prompt -AsSecureString
  $Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { $Plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer) }
  if ([string]::IsNullOrWhiteSpace($Plain) -or $Plain.Length -lt $MinimumLength) {
    throw "The supplied secret must contain at least $MinimumLength characters."
  }
  return $Plain
}

$NodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $NodeCommand) { $NodeCommand = Get-Command node -ErrorAction Stop }
$NodeVersionText = (& $NodeCommand.Source --version).Trim()
if ($NodeVersionText -notmatch '^v(\d+)\.(\d+)\.(\d+)' ) {
  throw "Could not parse Node.js version: $NodeVersionText."
}
$NodeVersion = [version]("$($Matches[1]).$($Matches[2]).$($Matches[3])")
if ($NodeVersion -lt [version]'22.9.0') {
  throw "Maya requires Node.js 22.9.0 or newer for the env-file-if-exists runtime flag. Detected $NodeVersionText."
}
$BunCommand = Get-Command bun.exe -ErrorAction SilentlyContinue
if (-not $BunCommand) { $BunCommand = Get-Command bun -ErrorAction SilentlyContinue }
if (-not $BunCommand) { throw "Bun is required. Install it with: powershell -c 'irm bun.sh/install.ps1 | iex' and reopen PowerShell." }
$BunVersion = (& $BunCommand.Source --version).Trim()
if ([version]($BunVersion -replace '^v', '') -lt [version]'1.4.4') { throw "Maya requires Bun 1.4.4 or newer. Detected $BunVersion." }

$FounderEmail = Get-EnvValue "MAYA_FOUNDER_EMAIL"
if ([string]::IsNullOrWhiteSpace($FounderEmail)) {
  $FounderEmail = Read-Host "Founder login email"
  if ($FounderEmail -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') { throw "A valid Founder email address is required." }
  Set-EnvValue "MAYA_FOUNDER_EMAIL" $FounderEmail
}
$FounderPassword = Get-EnvValue "MAYA_FOUNDER_PASSWORD"
if ($FounderPassword.Length -lt 16) {
  $FounderPassword = Read-Secret "Set a unique Founder password (minimum 16 characters)" 16
  Set-EnvValue "MAYA_FOUNDER_PASSWORD" $FounderPassword
}
$GeminiKey = Get-EnvValue "GEMINI_API_KEY"
if ([string]::IsNullOrWhiteSpace($GeminiKey)) {
  $GeminiKey = Read-Secret "Gemini API key" 20
  Set-EnvValue "GEMINI_API_KEY" $GeminiKey
}

$StorageDriver = (Get-EnvValue "MAYA_STORAGE_DRIVER").Trim().ToLowerInvariant()
if ([string]::IsNullOrWhiteSpace($StorageDriver)) { $StorageDriver = "file" }
if (@("file", "supabase") -notcontains $StorageDriver) { throw "MAYA_STORAGE_DRIVER must be file or supabase." }
Set-EnvValue "MAYA_STORAGE_DRIVER" $StorageDriver
if ($StorageDriver -eq "supabase") {
  $SupabaseUrl = Get-EnvValue "SUPABASE_URL"
  if ([string]::IsNullOrWhiteSpace($SupabaseUrl)) {
    $SupabaseUrl = Read-Host "Supabase project URL (HTTPS)"
    Set-EnvValue "SUPABASE_URL" $SupabaseUrl
  }
  try { $ParsedSupabaseUrl = [Uri]$SupabaseUrl } catch { throw "SUPABASE_URL is invalid." }
  if ($ParsedSupabaseUrl.Scheme -ne "https") { throw "SUPABASE_URL must use HTTPS." }
  $ServiceRoleKey = Get-EnvValue "SUPABASE_SERVICE_ROLE_KEY"
  if ([string]::IsNullOrWhiteSpace($ServiceRoleKey)) {
    $ServiceRoleKey = Read-Secret "Supabase service-role key (server-only; never expose it to the browser)" 20
    Set-EnvValue "SUPABASE_SERVICE_ROLE_KEY" $ServiceRoleKey
  }
  $SupabaseCommand = Get-Command supabase.exe -ErrorAction SilentlyContinue
  if (-not $SupabaseCommand) { $SupabaseCommand = Get-Command supabase -ErrorAction SilentlyContinue }
  if (-not $SupabaseCommand) { throw "Supabase CLI is required for Supabase storage. Install it, run supabase link, then rerun activation." }
  $Confirmation = Read-Host "Apply pending repository migrations to the linked Supabase project? Type APPLY"
  if ($Confirmation -cne "APPLY") { throw "Supabase migrations were not applied; activation stopped." }
  & $SupabaseCommand.Source db push
  if ($LASTEXITCODE -ne 0) { throw "Supabase migration deployment failed. Maya workers were not activated." }
} else {
  Write-Warning "File storage is single-instance only. Do not run multiple Maya server replicas with this storage driver."
}

Set-EnvValue "NODE_ENV" "production"
Set-EnvValue "MAYA_TASK_WORKER_ENABLED" "true"
Set-EnvValue "MAYA_TASK_WORKER_POLL_MS" "3000"
Set-EnvValue "MAYA_TASK_WORKER_LEASE_MS" "60000"
Set-EnvValue "MAYA_PLAN_WORKER_ENABLED" "true"
Set-EnvValue "MAYA_PLAN_WORKER_POLL_MS" "3000"
Set-EnvValue "MAYA_SCHEDULE_WORKER_ENABLED" "true"
Set-EnvValue "MAYA_SCHEDULE_WORKER_POLL_MS" "3000"
$script:EnvLines | Set-Content -LiteralPath $EnvFile -Encoding utf8NoBOM

$Identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls $EnvFile /inheritance:r /grant:r "$($Identity):(M)" "NT AUTHORITY\SYSTEM:(F)" "BUILTIN\Administrators:(F)" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not restrict .env file permissions to the current user, SYSTEM and Administrators." }

Write-Host "Running locked dependency installation, full tests and production build."
& $BunCommand.Source install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "Locked dependency installation failed." }
& $BunCommand.Source run test
if ($LASTEXITCODE -ne 0) { throw "The test suite failed. Maya was not started." }
& $BunCommand.Source run build
if ($LASTEXITCODE -ne 0) { throw "The production build failed. Maya was not started." }

if ($StorageDriver -eq "file") {
  Write-Warning "Maya is configured for local single-instance operation. It will not remain online when this PC is off."
}
if ([string]::IsNullOrWhiteSpace((Get-EnvValue "MAYA_HOST_SUPERVISOR_SOCKET")) -or [string]::IsNullOrWhiteSpace((Get-EnvValue "MAYA_HOST_SUPERVISOR_TOKEN"))) {
  Write-Warning "The secure local Developer host supervisor is not configured. Pair/install the separate Maya device bridge before expecting PC operations."
}

if ($InstallStartupTask) {
  & (Join-Path $PSScriptRoot "Install-Maya-Server-Startup.ps1")
} elseif (-not $NoStart) {
  & (Join-Path $PSScriptRoot "Start-Maya-Server.ps1")
}
