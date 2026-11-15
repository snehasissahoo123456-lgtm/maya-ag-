$ErrorActionPreference = "Stop"
$TaskName = "Maya Personal Agent Server"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$StartScript = Join-Path $PSScriptRoot "Start-Maya-Server.ps1"
if (-not (Test-Path $StartScript -PathType Leaf)) { throw "Start-Maya-Server.ps1 was not found." }
if (-not (Test-Path (Join-Path $RepoRoot ".env") -PathType Leaf)) { throw "Maya .env is missing. Run scripts\Activate-Maya.ps1 first." }
if (-not (Test-Path (Join-Path $RepoRoot "dist\server.cjs") -PathType Leaf)) { throw "Maya production bundle is missing. Run scripts\Activate-Maya.ps1 first." }

$PowerShellCommand = Get-Command pwsh.exe -ErrorAction SilentlyContinue
if (-not $PowerShellCommand) { $PowerShellCommand = Get-Command powershell.exe -ErrorAction Stop }
$PowerShellExe = $PowerShellCommand.Source
if (-not $PowerShellExe -or -not (Test-Path $PowerShellExe -PathType Leaf)) { throw "A supported PowerShell executable could not be resolved." }

$Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $StartScript + '"'
$Action = New-ScheduledTaskAction -Execute $PowerShellExe -Argument $Arguments -WorkingDirectory $RepoRoot
$CurrentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentUser
$Principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description "Starts the Maya server at this user's logon. Runs as the current user with limited privileges." -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "Maya server startup is installed and started for the current Windows user."
Write-Host "Task: $TaskName"
Write-Host "Logs: $(Join-Path $env:LOCALAPPDATA 'Maya\server-logs\maya-server.log')"
Write-Host "This is logon startup, not cloud hosting. The PC must be on and this user must be logged in."
