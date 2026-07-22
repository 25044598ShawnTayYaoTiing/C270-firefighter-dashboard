$ErrorActionPreference = "Stop"

# Configure this path if RealtimeSTT is installed somewhere else.
$RealtimeSttPath = "C:\Users\goati\Downloads\RealtimeSTT"

$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$EnvPath = Join-Path $ProjectRoot ".env"
$NodeModulesPath = Join-Path $ProjectRoot "node_modules"
$DashboardUrl = "http://localhost:3000"
$RealtimeSttUrl = "http://127.0.0.1:8010"
$RealtimeVenvPath = Join-Path $RealtimeSttPath ".venv-fastapi"
$RealtimeActivatePath = Join-Path $RealtimeVenvPath "Scripts\Activate.ps1"
$RealtimeServerPath = Join-Path $RealtimeSttPath "example_fastapi_server\server.py"

function Write-Status {
  param([string]$Message)
  Write-Host "[demo] $Message" -ForegroundColor Cyan
}

function Write-WarningMessage {
  param([string]$Message)
  Write-Host "[warning] $Message" -ForegroundColor Yellow
}

function Write-ErrorMessage {
  param([string]$Message)
  Write-Host "[error] $Message" -ForegroundColor Red
}

function ConvertTo-PowerShellSingleQuotedString {
  param([string]$Value)
  return "'$($Value -replace "'", "''")'"
}

function Get-DotEnvValue {
  param(
    [string]$Path,
    [string]$Name
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  $line = Get-Content -LiteralPath $Path |
    Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } |
    Select-Object -First 1

  if (-not $line) {
    return $null
  }

  $value = ($line -split "=", 2)[1].Trim()
  return $value.Trim('"').Trim("'")
}

function Test-TcpPort {
  param(
    [string]$HostName,
    [int]$Port,
    [int]$TimeoutMilliseconds = 1500
  )

  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $connection = $client.BeginConnect($HostName, $Port, $null, $null)
    $connected = $connection.AsyncWaitHandle.WaitOne($TimeoutMilliseconds, $false)

    if ($connected) {
      $client.EndConnect($connection)
    }

    $client.Close()
    return $connected
  }
  catch {
    return $false
  }
}

function Test-HttpEndpoint {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 2
  )

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSeconds
    return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
  }
  catch {
    return $false
  }
}

function Start-PowerShellWindow {
  param(
    [string]$Title,
    [string]$Command
  )

  $windowTitle = ConvertTo-PowerShellSingleQuotedString -Value $Title
  $windowCommand = "[Console]::Title = $windowTitle; $Command"

  Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    $windowCommand
  )
}

Set-Location -LiteralPath $ProjectRoot

Write-Status "Checking dashboard prerequisites..."

if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) {
  Write-ErrorMessage ".env not found. Create .env in the dashboard project root before starting the demo."
  Read-Host "Press Enter to close"
  exit 1
}

if (-not (Test-Path -LiteralPath $NodeModulesPath -PathType Container)) {
  Write-ErrorMessage "node_modules not found. Run npm install first."
  Read-Host "Press Enter to close"
  exit 1
}

$dbHost = Get-DotEnvValue -Path $EnvPath -Name "DB_HOST"
$dbPortText = Get-DotEnvValue -Path $EnvPath -Name "DB_PORT"
$dbPort = 3306

if ([int]::TryParse($dbPortText, [ref]$dbPort) -eq $false) {
  $dbPort = 3306
}

if (-not $dbHost) {
  $dbHost = "localhost"
}

Write-Status "Checking MySQL at $dbHost`:$dbPort..."

if (Test-TcpPort -HostName $dbHost -Port $dbPort) {
  Write-Status "MySQL appears reachable."
}
else {
  Write-WarningMessage "MySQL does not appear reachable at $dbHost`:$dbPort. Start MySQL before using dashboard CRUD features."
}

$geminiApiKey = Get-DotEnvValue -Path $EnvPath -Name "GEMINI_API_KEY"
$geminiModel = Get-DotEnvValue -Path $EnvPath -Name "GEMINI_MODEL"

Write-Status "Checking Gemini AI configuration..."

if ($geminiApiKey -and $geminiModel) {
  Write-Status "Gemini AI is configured with model '$geminiModel'."
}
else {
  if (-not $geminiApiKey) {
    Write-WarningMessage "GEMINI_API_KEY is not configured. AI cleanup/report generation will use manual fallback responses."
  }

  if (-not $geminiModel) {
    Write-WarningMessage "GEMINI_MODEL is not configured. Set it to a supported Flash model such as gemini-3.5-flash-lite."
  }
}

Write-Status "Starting dashboard..."
$projectRootArgument = ConvertTo-PowerShellSingleQuotedString -Value $ProjectRoot
Start-PowerShellWindow -Title "Firefighter Dashboard" -Command "Set-Location -LiteralPath $projectRootArgument; npm start"

Write-Status "Opening dashboard in browser..."
Start-Process $DashboardUrl

$realtimeReady = $true

if (-not (Test-Path -LiteralPath $RealtimeSttPath -PathType Container)) {
  Write-WarningMessage "RealtimeSTT folder not found at '$RealtimeSttPath'. Update `$RealtimeSttPath near the top of scripts/start-demo.ps1."
  $realtimeReady = $false
}

if ($realtimeReady -and -not (Test-Path -LiteralPath $RealtimeVenvPath -PathType Container)) {
  Write-WarningMessage "RealtimeSTT virtual environment not found at '$RealtimeVenvPath'. Create it with: python -m venv .venv-fastapi"
  $realtimeReady = $false
}

if ($realtimeReady -and -not (Test-Path -LiteralPath $RealtimeActivatePath -PathType Leaf)) {
  Write-WarningMessage "RealtimeSTT activation script not found at '$RealtimeActivatePath'. Confirm the .venv-fastapi setup completed successfully."
  $realtimeReady = $false
}

if ($realtimeReady -and -not (Test-Path -LiteralPath $RealtimeServerPath -PathType Leaf)) {
  Write-WarningMessage "RealtimeSTT FastAPI server not found at '$RealtimeServerPath'. Confirm example_fastapi_server\server.py exists."
  $realtimeReady = $false
}

if ($realtimeReady) {
  Write-Status "Starting RealtimeSTT..."
  $realtimePathArgument = ConvertTo-PowerShellSingleQuotedString -Value $RealtimeSttPath
  $realtimeActivateArgument = ConvertTo-PowerShellSingleQuotedString -Value $RealtimeActivatePath
  Start-PowerShellWindow -Title "RealtimeSTT FastAPI" -Command "Set-Location -LiteralPath $realtimePathArgument; & $realtimeActivateArgument; python example_fastapi_server\server.py --host 127.0.0.1 --port 8010 --engine faster_whisper --model medium.en --realtime-model tiny.en --language en"
}
else {
  Write-WarningMessage "RealtimeSTT was not started because setup is incomplete."
}

$displayGeminiModel = if ($geminiModel) { $geminiModel } else { "not configured" }

Write-Host ""
Write-Status "Demo services started."
Write-Host "Dashboard:   $DashboardUrl"
Write-Host "RealtimeSTT: $RealtimeSttUrl"
Write-Host "AI Service:  Gemini AI"
Write-Host "AI Model:    $displayGeminiModel"
Write-Host ""
Write-Host "Close the separate PowerShell windows to stop the dashboard and RealtimeSTT."
Read-Host "Press Enter to close this launcher"
