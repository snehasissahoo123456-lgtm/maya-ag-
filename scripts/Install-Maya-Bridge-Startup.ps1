$ErrorActionPreference = "Stop"

$TaskName = "Maya Local Device Bridge"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$StartScript = Join-Path $PSScriptRoot "Start-Maya-Bridge.ps1"
if (-not (Test-Path $StartScript)) { throw "Start-Maya-Bridge.ps1 was not found." }

$CredentialsFile = if ($env:MAYA_DEVICE_CREDENTIAL_FILE) {
  [System.IO.Path]::GetFullPath($env:MAYA_DEVICE_CREDENTIAL_FILE)
} else {
  Join-Path $HOME ".maya\device-bridge.json"
}
if (-not (Test-Path $CredentialsFile)) {
  throw "Maya is not paired on this PC yet. Run scripts\Start-Maya-Bridge.ps1 manually, complete the one-time pairing, then run this installer."
}

try { $Credentials = Get-Content -Raw -Path $CredentialsFile | ConvertFrom-Json }
catch { throw "The local Maya device credential file is not valid JSON." }
if (-not $Credentials.serverUrl -or -not $Credentials.deviceId -or -not $Credentials.founderId -or -not $Credentials.token) {
  throw "The local Maya device credential file is incomplete."
}

$ServerUrl = if ($env:MAYA_SERVER_URL) { $env:MAYA_SERVER_URL } else { [string]$Credentials.serverUrl }
try { $ParsedServerUrl = [Uri]$ServerUrl }
catch { throw "MAYA_SERVER_URL is not a valid URL." }
if ($ParsedServerUrl.Scheme -ne "https" -and -not ($ParsedServerUrl.Scheme -eq "http" -and @("localhost", "127.0.0.1") -contains $ParsedServerUrl.Host)) {
  throw "Remote bridge startup requires HTTPS/WSS. HTTP is allowed only for localhost."
}
if ([string]$Credentials.serverUrl -ne $ServerUrl) {
  throw "MAYA_SERVER_URL does not match the server URL saved during device pairing."
}

$WorkspaceRoot = if ($env:MAYA_WORKSPACE_ROOT) { [System.IO.Path]::GetFullPath($env:MAYA_WORKSPACE_ROOT) } else { $RepoRoot }
if (-not (Test-Path $WorkspaceRoot -PathType Container)) { throw "MAYA_WORKSPACE_ROOT must be an existing directory." }

$ConfigDirectory = Join-Path $env:LOCALAPPDATA "Maya"
$ConfigFile = Join-Path $ConfigDirectory "bridge-startup.json"
New-Item -ItemType Directory -Path $ConfigDirectory -Force | Out-Null
$Config = [ordered]@{
  serverUrl = $ServerUrl
  workspaceRoot = $WorkspaceRoot
  credentialsFile = $CredentialsFile
}
$Config | ConvertTo-Json -Depth 4 | Set-Content -Path $ConfigFile -Encoding UTF8

$PowerShellCommand = Get-Command powershell.exe -ErrorAction SilentlyContinue
if (-not $PowerShellCommand) { $PowerShellCommand = Get-Command pwsh.exe -ErrorAction Stop }
$PowerShellExe = $PowerShellCommand.Source
if (-not $PowerShellExe -or -not (Test-Path $PowerShellExe -PathType Leaf)) {
  throw "A supported Windows PowerShell executable could not be resolved."
}
$NodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $NodeCommand) { $NodeCommand = Get-Command node -ErrorAction SilentlyContinue }
if (-not $NodeCommand) { throw "Node.js is required. Install Node.js and verify that node is on PATH before installing bridge startup." }
if (-not (Test-Path (Join-Path $RepoRoot "node_modules\\tsx\\package.json"))) {
  throw "Maya dependencies are missing. Run bun install (or npm install) in the repository before installing bridge startup."
}
$Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $StartScript + '" -NonInteractive'
$Action = New-ScheduledTaskAction -Execute $PowerShellExe -Argument $Arguments
$CurrentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentUser
$Principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description "Starts the paired Maya local device bridge at this user's logon. Runs as the current user with limited privileges." -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Host "Maya bridge startup is installed for the current Windows user."
Write-Host "Task: $TaskName"
Write-Host "Workspace root: $WorkspaceRoot"
Write-Host "Runs only while this user is logged in; it does not run as SYSTEM or with elevated privileges."
Write-Host "Logs: $(Join-Path $ConfigDirectory 'bridge.log')"
Write-Host "Remove it with scripts\Uninstall-Maya-Bridge-Startup.ps1."
