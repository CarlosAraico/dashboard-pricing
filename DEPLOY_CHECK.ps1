[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$required = @(
  "index.html",
  "app.js",
  "exports/derived_jan_may_2025_2026.json"
)

$missing = @()
foreach ($rel in $required) {
  $path = Join-Path $root $rel
  if (-not (Test-Path -LiteralPath $path)) { $missing += $rel }
}

if ($missing.Count -gt 0) {
  Write-Host "ERROR: Faltan archivos requeridos:" -ForegroundColor Red
  $missing | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
  exit 1
}

# Verifica DATA_URL
$app = Get-Content (Join-Path $root "app.js") -Raw
if ($app -notmatch 'DATA_URL\s*=\s*["\'']\.\/exports\/derived_jan_may_2025_2026\.json["\'']') {
  Write-Host "ERROR: app.js no apunta a ./exports/derived_jan_may_2025_2026.json" -ForegroundColor Red
  exit 1
}

# Verifica READ_ONLY_MODE
if ($app -notmatch 'READ_ONLY_MODE\s*=\s*true') {
  Write-Host "ERROR: READ_ONLY_MODE no está en true en app.js" -ForegroundColor Red
  exit 1
}

Write-Host "OK: listo para Cloudflare Pages (read-only)." -ForegroundColor Green
