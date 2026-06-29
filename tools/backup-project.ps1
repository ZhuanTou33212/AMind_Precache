$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$BackupDir = Join-Path $Root "_backups"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Stage = Join-Path $Root "_backup_stage"
$ZipPath = Join-Path $BackupDir ("aminer-desktop-before-label-system-" + $Stamp + ".zip")

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

if (Test-Path -LiteralPath $Stage) {
  $ResolvedStage = (Resolve-Path -LiteralPath $Stage).Path
  if (!$ResolvedStage.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove stage outside workspace: $ResolvedStage"
  }
  Remove-Item -LiteralPath $ResolvedStage -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

$Exclude = @(".git", "_backups", "_backup_stage")
Get-ChildItem -LiteralPath $Root -Force | Where-Object {
  $Exclude -notcontains $_.Name
} | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $Stage -Recurse -Force
}

Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $ZipPath -Force
Remove-Item -LiteralPath $Stage -Recurse -Force

Get-Item -LiteralPath $ZipPath | Select-Object FullName,Length,LastWriteTime
