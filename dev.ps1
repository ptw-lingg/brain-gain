# Starts both BrainGain dev servers in THIS console (no extra windows), output interleaved:
#   backend  — https://localhost:3011 (API), http://localhost:3010 redirects, SCORM content :3012
#   frontend — https://localhost:3013 (Vite, self-signed cert; proxies /api to the backend)
#
# Usage:  .\dev.ps1     (Ctrl+C stops both servers)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# Resolve npm once — a script launched outside a Node-aware shell may not have it on PATH.
$npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCmd) { $npmCmd = Get-Command npm -ErrorAction SilentlyContinue }
if (-not $npmCmd) { throw 'npm not found on PATH — install Node.js or run from a shell where npm works.' }
$npm = $npmCmd.Source
$env:PATH = (Split-Path $npm) + ';' + $env:PATH

foreach ($app in 'backend', 'frontend') {
    if (-not (Test-Path (Join-Path $root "$app\node_modules"))) {
        Write-Host "node_modules missing in $app — running npm install…" -ForegroundColor Yellow
        & $npm --prefix (Join-Path $root $app) install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed in $app" }
    }
}

# APP_ORIGIN lets the SCORM content origin allow framing by the Vite-served app in dev.
# Children inherit the environment at spawn time, so set it only around the backend spawn.
$env:APP_ORIGIN = 'https://localhost:3013'
$backend = Start-Process $npm -ArgumentList 'run', 'dev' -WorkingDirectory "$root\backend" -NoNewWindow -PassThru
$env:APP_ORIGIN = $null
$frontend = Start-Process $npm -ArgumentList 'run', 'dev' -WorkingDirectory "$root\frontend" -NoNewWindow -PassThru

Write-Host ''
Write-Host 'BrainGain dev servers (Ctrl+C stops both):' -ForegroundColor Green
Write-Host '  app  https://localhost:3013  (accept the self-signed cert warning once)'
Write-Host '  api  https://localhost:3011  (SCORM content on :3012)'
Write-Host ''

try {
    Wait-Process -Id $backend.Id, $frontend.Id
} finally {
    # Ctrl+C reaches the children via the shared console; sweep up any survivors (whole tree).
    foreach ($p in $backend, $frontend) {
        if ($p -and -not $p.HasExited) { taskkill /PID $p.Id /T /F 2>$null | Out-Null }
    }
}
