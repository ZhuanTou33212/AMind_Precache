$profileNeedle = 'annot-aminer-hotkeys-edge-profile-2'
$csv = wmic process where "name='msedge.exe'" get ProcessId,CommandLine /format:csv
$pids = @()
foreach ($line in $csv) {
  if ($line -like "*$profileNeedle*") {
    $parts = $line.Split(',')
    $pidValue = 0
    if ([int]::TryParse($parts[-1], [ref]$pidValue) -and $pidValue -gt 0) {
      $pids += $pidValue
    }
  }
}
foreach ($pidValue in $pids) {
  Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
}
[pscustomobject]@{ Stopped = $pids } | ConvertTo-Json -Compress
