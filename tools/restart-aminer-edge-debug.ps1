$EdgePath = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$EdgeProfile = 'D:\Download\annot-aminer-hotkeys-edge-profile-2'
$HotkeysExtension = 'D:\Download\annot-aminer-hotkeys-extension'
$CacheExtension = 'D:\Download\aminer-desktop\extension'
$StartUrl = 'https://annot.aminer.cn/project/label_page_feed/181903?start=1781830800'

$running = Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" |
  Where-Object { $_.CommandLine -like "*$EdgeProfile*" }

foreach ($process in $running) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 2

$extensionList = "$HotkeysExtension,$CacheExtension"
$arguments = "--remote-debugging-port=9222 --user-data-dir=$EdgeProfile --disable-extensions-except=$extensionList --load-extension=$extensionList --disable-background-mode --no-first-run --new-window $StartUrl"
Start-Process -FilePath $EdgePath -ArgumentList $arguments -WorkingDirectory (Split-Path -Parent $EdgePath)

[pscustomobject]@{
  StoppedProcessIds = @($running | ForEach-Object { $_.ProcessId })
  Started = $true
  Arguments = $arguments
} | ConvertTo-Json -Depth 3
