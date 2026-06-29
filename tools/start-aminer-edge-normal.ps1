$ShortcutPath = 'C:\Users\1\Desktop\AMiner Annot Hotkeys.lnk'
$EdgeProfile = 'D:\Download\annot-aminer-hotkeys-edge-profile-2'

$running = Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" |
  Where-Object { $_.CommandLine -like "*$EdgeProfile*" }

foreach ($process in $running) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 2
Start-Process -FilePath $ShortcutPath

[pscustomobject]@{
  StoppedProcessIds = @($running | ForEach-Object { $_.ProcessId })
  StartedShortcut = $ShortcutPath
} | ConvertTo-Json -Depth 3
