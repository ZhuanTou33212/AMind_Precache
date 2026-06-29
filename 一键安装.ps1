# AMiner 扩展 — 全自动安装（跨机器通用）
# 右键 → 使用 PowerShell 运行

$extDir = "C:\aminer-ext"
$url = "https://annot.aminer.cn/project/label_page_feed/181903?start=1781830800"
$sourceExtDir = Join-Path $PSScriptRoot "extension"
$sourceManifest = Join-Path $sourceExtDir "manifest.json"
$targetManifest = Join-Path $extDir "manifest.json"

# 1. 复制扩展
if (-not (Test-Path $sourceManifest)) {
    Write-Host "[FAIL] 找不到 extension\manifest.json，请先完整解压压缩包后再运行" -ForegroundColor Red
    pause
    exit 1
}
New-Item -ItemType Directory -Force -Path $extDir | Out-Null
Copy-Item -Path (Join-Path $sourceExtDir "*") -Destination $extDir -Recurse -Force
if (-not (Test-Path $targetManifest)) {
    Write-Host "[FAIL] 扩展复制失败：$targetManifest 不存在" -ForegroundColor Red
    pause
    exit 1
}

# 2. 查找浏览器：优先 Chrome（支持命令行加载扩展）
$browser = $null
foreach ($p in @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)) {
    if (Test-Path $p) { $browser = $p; break }
}

if ($browser) {
    Write-Host "[Chrome] 启动中（扩展自动加载）" -ForegroundColor Green
    Write-Host "[INFO] 扩展目录: $extDir" -ForegroundColor Yellow
    Start-Process $browser -ArgumentList "--load-extension=$extDir", "--new-window", $url
} else {
    # 备用：Edge（需手动安装扩展）
    Write-Host "[Edge] Chrome 未安装，转用 Edge" -ForegroundColor Yellow
    $edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    if (-not (Test-Path $edge)) { $edge = "C:\Program Files\Microsoft\Edge\Application\msedge.exe" }
    
    # 第一次：拖入扩展
    Write-Host "首次使用请：edge://extensions/ → 开发人员模式 → 拖入 C:\aminer-ext" -ForegroundColor Yellow
    Write-Host "请确认 C:\aminer-ext 目录下直接能看到 manifest.json，不要拖入上级目录或压缩包" -ForegroundColor Yellow
    Start-Process $edge -ArgumentList "edge://extensions/"
    Start-Sleep 1
    Start-Process $edge -ArgumentList "--new-window", $url
}

Write-Host "[OK] 已完成" -ForegroundColor Green
pause
