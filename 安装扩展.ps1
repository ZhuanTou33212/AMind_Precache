# AMiner 浏览器扩展 — 跨机器一键安装脚本
# 用法：右键 → 使用 PowerShell 运行

$ErrorActionPreference = "Stop"

# 配置
$ExtensionDir = Join-Path $PSScriptRoot "extension"
$ManifestPath = Join-Path $ExtensionDir "manifest.json"
$EdgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

if (-not (Test-Path $EdgePath)) {
    $EdgePath = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
}

Write-Host "=== AMiner 扩展安装 ===" -ForegroundColor Cyan

# 1. 检查扩展文件
if (-not (Test-Path $ManifestPath)) {
    Write-Host "[FAIL] 找不到 extension\manifest.json，请确保扩展文件夹完整" -ForegroundColor Red
    pause
    exit 1
}
Write-Host "[OK] 扩展文件检查通过" -ForegroundColor Green

# 2. 确认扩展 ID
$manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$extName = $manifest.name
Write-Host "[INFO] 扩展名称: $extName" -ForegroundColor Yellow

# 3. 打开 Edge 扩展页面
Write-Host "[INFO] 正在打开 Edge 扩展管理页面..." -ForegroundColor Yellow
Start-Process $EdgePath -ArgumentList "edge://extensions/"

# 4. 指令
Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  请手动完成以下操作：" -ForegroundColor White
Write-Host ""
Write-Host "  1. 开启右侧「开发人员模式」开关" -ForegroundColor Yellow
Write-Host ""
Write-Host "  2. 将以下文件夹拖入浏览器窗口：" -ForegroundColor Yellow
Write-Host "     $ExtensionDir" -ForegroundColor Green
Write-Host ""
Write-Host "  3. 确认扩展已加载（应显示 AMiner Realtime Monitor Bridge）" -ForegroundColor Yellow
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""
pause
