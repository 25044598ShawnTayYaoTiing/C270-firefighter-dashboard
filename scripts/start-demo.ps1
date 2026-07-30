$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$envPath = Join-Path $projectRoot '.env'
$nodeModulesPath = Join-Path $projectRoot 'node_modules'

if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
  throw '.env not found. Copy .env.example and configure the required values first.'
}

if (-not (Test-Path -LiteralPath $nodeModulesPath -PathType Container)) {
  throw 'node_modules not found. Run npm install first.'
}

$projectLine = Get-Content -LiteralPath $envPath |
  Where-Object { $_ -match '^\s*GOOGLE_CLOUD_PROJECT\s*=\s*\S+' } |
  Select-Object -First 1

if (-not $projectLine) {
  Write-Warning 'GOOGLE_CLOUD_PROJECT is not configured. Manual transcript entry will still work, but Google Speech-to-Text will not.'
}

Set-Location -LiteralPath $projectRoot
Start-Process -FilePath 'powershell.exe' -ArgumentList @(
  '-NoExit',
  '-ExecutionPolicy', 'Bypass',
  '-Command', "Set-Location -LiteralPath '$projectRoot'; npm start"
)
Start-Process 'http://localhost:3000'

Write-Host 'Dashboard started at http://localhost:3000'
Write-Host 'Google Speech-to-Text uses Application Default Credentials configured for the backend environment.'
