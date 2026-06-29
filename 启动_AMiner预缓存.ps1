# AMiner 预缓存系统启动脚本
# 无需配置 URL——Edge 自动恢复上次会话，扩展动态获取当前页面地址

$ProfileDir = Join-Path $PSScriptRoot 'edge-profile'
$ExtensionDir = Join-Path $PSScriptRoot 'extension'
$ExePath = Join-Path $PSScriptRoot 'aminer-desktop.exe'
$EdgePath = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

if (!(Test-Path -LiteralPath $ExePath)) { throw "找不到 aminer-desktop.exe" }
if (!(Test-Path -LiteralPath $ExtensionDir)) { throw "找不到 extension 目录" }
if (!(Test-Path -LiteralPath $EdgePath)) {
  $EdgePath = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
}
if (!(Test-Path -LiteralPath $EdgePath)) { throw '找不到 Microsoft Edge' }

Get-Process msedge,aminer-desktop -ErrorAction SilentlyContinue | Stop-Process -Force

Start-Process -FilePath $ExePath -WorkingDirectory $PSScriptRoot
Start-Sleep 2

New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null

$edgeArgs = @(
  "--user-data-dir=$ProfileDir",
  "--load-extension=$ExtensionDir",
  '--disable-background-mode',
  '--no-first-run',
  '--new-window',
  '--remote-debugging-port=9224'
)

Start-Process -FilePath $EdgePath -ArgumentList $edgeArgs
