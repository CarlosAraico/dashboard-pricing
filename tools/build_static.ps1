[CmdletBinding()]
param(
  [string]$OutDir = "dist",
  [switch]$Clean
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $root "..")
$dist = Join-Path $root $OutDir

if ($Clean -and (Test-Path -LiteralPath $dist)) {
  Remove-Item -LiteralPath $dist -Recurse -Force
}

New-Item -ItemType Directory -Path $dist -Force | Out-Null

$items = @(
  "index.html",
  "app.js",
  "modules",
  "exports"
)

foreach ($item in $items) {
  $src = Join-Path $root $item
  if (-not (Test-Path -LiteralPath $src)) { continue }
  $dest = Join-Path $dist $item
  if ((Get-Item -LiteralPath $src).PSIsContainer) {
    Copy-Item -LiteralPath $src -Destination $dest -Recurse -Force
  } else {
    Copy-Item -LiteralPath $src -Destination $dest -Force
  }
}

Write-Host "OK: build en $dist"
