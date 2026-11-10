param(
  [switch]$RemoveConfig
)

$ErrorActionPreference = "Stop"
$TaskName = "Maya Local Device Bridge"
$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Task) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed Maya bridge logon task."
} else {
  Write-Host "Maya bridge logon task was not installed."
}

if ($RemoveConfig) {
  $ConfigFile = Join-Path $env:LOCALAPPDATA "Maya\bridge-startup.json"
  if (Test-Path $ConfigFile) {
    Remove-Item -LiteralPath $ConfigFile -Force
    Write-Host "Removed bridge startup configuration. The paired device credential file was preserved."
  }
}
