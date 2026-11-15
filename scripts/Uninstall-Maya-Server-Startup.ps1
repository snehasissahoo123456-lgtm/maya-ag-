param([switch]$RemoveLogs)

$ErrorActionPreference = "Stop"
$TaskName = "Maya Personal Agent Server"
$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Task) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed Maya server logon task."
} else {
  Write-Host "Maya server logon task was not installed."
}
if ($RemoveLogs) {
  $LogDirectory = Join-Path $env:LOCALAPPDATA "Maya\server-logs"
  if (Test-Path $LogDirectory) { Remove-Item -LiteralPath $LogDirectory -Recurse -Force }
}
