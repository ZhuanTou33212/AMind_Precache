$EdgeProfile = 'D:\Download\annot-aminer-hotkeys-edge-profile-2'
$ProjectRoot = 'D:\Download\aminer-desktop'

$edgeProcesses = Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" |
  Where-Object { $_.CommandLine -like "*$EdgeProfile*" }

$desktopProcesses = Get-CimInstance Win32_Process -Filter "Name = 'aminer-desktop.exe'" |
  Where-Object {
    $_.ExecutablePath -like "$ProjectRoot*" -or
    $_.CommandLine -like "*$ProjectRoot*"
  }

foreach ($process in $edgeProcesses) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

foreach ($process in $desktopProcesses) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

[pscustomobject]@{
  StoppedEdgeProcessIds = @($edgeProcesses | ForEach-Object { $_.ProcessId })
  StoppedDesktopProcessIds = @($desktopProcesses | ForEach-Object { $_.ProcessId })
} | ConvertTo-Json -Depth 3
