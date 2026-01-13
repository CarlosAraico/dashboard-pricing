param(
  [int]$Port = 8000,
  [string]$Root = (Get-Location).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Read-only: solo GET/HEAD
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()

Write-Host "Serving (READ-ONLY) from: $Root"
Write-Host "Open: http://localhost:$Port"
Write-Host "CTRL+C to stop"

function Get-ContentType([string]$path) {
  switch -regex ($path.ToLowerInvariant()) {
    '\.html$' { 'text/html; charset=utf-8' }
    '\.js$'   { 'application/javascript; charset=utf-8' }
    '\.json$' { 'application/json; charset=utf-8' }
    '\.css$'  { 'text/css; charset=utf-8' }
    '\.png$'  { 'image/png' }
    '\.jpg$'  { 'image/jpeg' }
    '\.jpeg$' { 'image/jpeg' }
    '\.svg$'  { 'image/svg+xml' }
    '\.txt$'  { 'text/plain; charset=utf-8' }
    default   { 'application/octet-stream' }
  }
}

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response

    if ($req.HttpMethod -ne "GET" -and $req.HttpMethod -ne "HEAD") {
      $res.StatusCode = 405
      $bytes = [Text.Encoding]::UTF8.GetBytes("READ_ONLY_MODE: only GET/HEAD allowed")
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      $res.Close()
      continue
    }

    $rel = $req.Url.AbsolutePath.TrimStart("/") -replace '/', '\'
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = "index.html" }

    $full = Join-Path $Root $rel

    # Evita path traversal
    $fullResolved = (Resolve-Path -LiteralPath $full -ErrorAction SilentlyContinue)
    if (-not $fullResolved) {
      $res.StatusCode = 404
      $bytes = [Text.Encoding]::UTF8.GetBytes("404 Not Found")
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      $res.Close()
      continue
    }

    $fullResolved = $fullResolved.Path
    if (-not $fullResolved.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
      $res.StatusCode = 403
      $bytes = [Text.Encoding]::UTF8.GetBytes("403 Forbidden")
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      $res.Close()
      continue
    }

    if ((Get-Item -LiteralPath $fullResolved).PSIsContainer) {
      $fullResolved = Join-Path $fullResolved "index.html"
    }

    if (-not (Test-Path -LiteralPath $fullResolved)) {
      $res.StatusCode = 404
      $bytes = [Text.Encoding]::UTF8.GetBytes("404 Not Found")
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      $res.Close()
      continue
    }

    $bytes = [IO.File]::ReadAllBytes($fullResolved)
    $res.ContentType = Get-ContentType $fullResolved
    $res.StatusCode = 200

    if ($req.HttpMethod -eq "GET") {
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    $res.Close()
  }
}
finally {
  $listener.Stop()
  $listener.Close()
}
