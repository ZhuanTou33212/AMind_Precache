$PreferencesPath = 'D:\Download\annot-aminer-hotkeys-edge-profile-2\Default\Preferences'
$ids = @(
  'hefggjfakpmmmbjghkjkjedhingicknd',
  'lchagicpidoebnahigbimmidlcmgefnc'
)

$preferences = Get-Content -LiteralPath $PreferencesPath -Raw -Encoding UTF8 | ConvertFrom-Json
$preferences.extensions.settings.PSObject.Properties |
  Where-Object { $ids -contains $_.Name } |
  ForEach-Object {
    [pscustomobject]@{
      id = $_.Name
      path = $_.Value.path
      manifestVersion = $_.Value.manifest.version
      location = $_.Value.location
      state = $_.Value.state
    }
  } |
  ConvertTo-Json -Depth 5
