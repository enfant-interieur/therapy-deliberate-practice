param(
  [string]$OutputDir,
  [string]$Tag,
  [string]$Version
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path "$PSScriptRoot\..\.."
$TauriConf = Join-Path $RepoRoot "services\local-runtime-suite\desktop\src-tauri\tauri.conf.json"

if (-not (Test-Path $TauriConf)) {
  throw "tauri.conf.json not found at $TauriConf"
}

$tauriData = Get-Content $TauriConf | ConvertFrom-Json
if (-not $Version) {
  $Version = $tauriData.version
}
$ProductName = $tauriData.productName

if (-not $OutputDir) {
  $Tag = if ($Tag) { $Tag } else { "v$Version" }
  $OutputDir = Join-Path $RepoRoot "dist\release\$Tag\windows"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command rustup -ErrorAction SilentlyContinue) {
  rustup toolchain install 1.84.0 | Out-Null
  rustup default 1.84.0 | Out-Null
} else {
  throw "rustup is required on the Windows builder."
}

if (Get-Command fnm -ErrorAction SilentlyContinue) {
  fnm install 20.19.0 | Out-Null
  fnm use 20.19.0 | Out-Null
}

Set-Location $RepoRoot
npm ci
npm run tauri:build -w services/local-runtime-suite/desktop -- --bundles msi,nsis

$bundleDir = Join-Path $RepoRoot "services\local-runtime-suite\desktop\src-tauri\target\release\bundle"

if ($env:WINDOWS_CODESIGN_CERT_B64) {
  if (-not $env:WINDOWS_CODESIGN_CERT_PASSWORD) {
    throw "WINDOWS_CODESIGN_CERT_PASSWORD must be set when WINDOWS_CODESIGN_CERT_B64 is provided."
  }
  $pfxPath = Join-Path $env:TEMP "windows-codesign.pfx"
  [System.IO.File]::WriteAllBytes($pfxPath, [System.Convert]::FromBase64String($env:WINDOWS_CODESIGN_CERT_B64))
  $securePwd = ConvertTo-SecureString $env:WINDOWS_CODESIGN_CERT_PASSWORD -AsPlainText -Force
  Import-PfxCertificate -FilePath $pfxPath -CertStoreLocation Cert:\CurrentUser\My -Password $securePwd | Out-Null
}

$signTargets = Get-ChildItem $bundleDir -Recurse -Include *.exe,*.msi
if ($signTargets -and $env:WINDOWS_CODESIGN_SUBJECT) {
  if (-not (Get-Command signtool.exe -ErrorAction SilentlyContinue)) {
    throw "signtool.exe is required for Windows signing. Install Windows SDK.";
  }
  foreach ($file in $signTargets) {
    signtool.exe sign /n "$env:WINDOWS_CODESIGN_SUBJECT" /tr http://timestamp.digicert.com /td sha256 /fd sha256 "$($file.FullName)"
  }
}

$arch = "x64"
$msi = Get-ChildItem (Join-Path $bundleDir "msi") -Filter *.msi -Recurse | Select-Object -First 1
$nsis = Get-ChildItem (Join-Path $bundleDir "nsis") -Filter *.exe -Recurse | Select-Object -First 1

if ($msi) {
  Copy-Item $msi.FullName (Join-Path $OutputDir ("{0}_{1}_{2}.msi" -f $ProductName, $Version, $arch)) -Force
}

if ($nsis) {
  Copy-Item $nsis.FullName (Join-Path $OutputDir ("{0}_{1}_{2}_setup.exe" -f $ProductName, $Version, $arch)) -Force
}

Write-Output "Windows artifacts written to $OutputDir"
