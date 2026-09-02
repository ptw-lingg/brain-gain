# Starts the BrainGain dev servers, each in its own terminal window:
#   backend  — https://localhost:3101 (API), http://localhost:3100 redirects, SCORM content :3102
#   frontend — https://localhost:5273 (Vite, self-signed cert; proxies /api to the backend)
#
# Usage:  .\dev.ps1
# APP_ORIGIN is set on the backend so SCORM playback works against the Vite-served app in dev.

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

foreach ($app in 'backend', 'frontend') {
    if (-not (Test-Path (Join-Path $root "$app\node_modules"))) {
        Write-Host "node_modules missing in $app — running npm install…" -ForegroundColor Yellow
        npm --prefix (Join-Path $root $app) install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed in $app" }
    }
}

# Prefer PowerShell 7 for the spawned windows; fall back to Windows PowerShell.
$shell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { 'pwsh' } else { 'powershell' }

Start-Process $shell -ArgumentList '-NoExit', '-Command', @"
`$Host.UI.RawUI.WindowTitle = 'BrainGain backend — https://localhost:3101'
`$env:APP_ORIGIN = 'https://localhost:5273'
Set-Location '$root\backend'
npm run dev
"@

Start-Process $shell -ArgumentList '-NoExit', '-Command', @"
`$Host.UI.RawUI.WindowTitle = 'BrainGain frontend — https://localhost:5273'
Set-Location '$root\frontend'
npm run dev
"@

Write-Host ''
Write-Host 'BrainGain dev servers starting in two windows:' -ForegroundColor Green
Write-Host '  app      https://localhost:5273  (accept the self-signed cert warning once)'
Write-Host '  api      https://localhost:3101  (SCORM content on :3102)'
