[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("farmer", "buyer", "transporter", "coordinator", "control-room")]
  [string]$Target
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$launcherDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$repositoryRoot = (Resolve-Path (Join-Path $launcherDirectory "..")).Path
$productApiHealthUrl = "http://localhost:3001/health"
$websiteUrl = "http://localhost:3000"
$controlRoomUrl = "http://localhost:3002"
$startupTimeoutSeconds = 120

$participantTargets = @{
  farmer = "farmer-ana"
  buyer = "buyer-hotel"
  transporter = "transporter-daniel"
  coordinator = "coordinator-maya"
}

function Assert-CommandAvailable {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$InstallMessage
  )

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is not available. $InstallMessage"
  }
}

function Assert-NodeVersion {
  $rawVersion = (& node --version).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Node.js could not report its version. Reinstall Node.js 20.18 or newer."
  }

  try {
    $nodeVersion = [version]$rawVersion.TrimStart("v")
  } catch {
    throw "Could not understand the installed Node.js version '$rawVersion'."
  }

  if ($nodeVersion -lt [version]"20.18.0") {
    throw "Harvest needs Node.js 20.18 or newer. The installed version is $rawVersion."
  }
}

function Test-TcpPort {
  param([Parameter(Mandatory = $true)][int]$Port)

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $connection = $client.ConnectAsync("127.0.0.1", $Port)
    if (-not $connection.Wait(500)) {
      return $false
    }
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Test-ProductApi {
  try {
    $health = Invoke-RestMethod -Uri $productApiHealthUrl -TimeoutSec 2
    return $health.status -eq "ok" -and $health.service -eq "harvest-product-api"
  } catch {
    return $false
  }
}

function Test-HarvestPage {
  param([Parameter(Mandatory = $true)][string]$Url)

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
    return $response.StatusCode -ge 200 -and
      $response.StatusCode -lt 400 -and
      $response.Content -match "Harvest"
  } catch {
    return $false
  }
}

function Assert-DockerRunning {
  $dockerVersion = & docker info --format "{{.ServerVersion}}" 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Docker Desktop is not running. Start Docker Desktop, wait until it is ready, and click the launcher again. Docker said: $dockerVersion"
  }
}

function Install-DependenciesIfMissing {
  if (Test-Path (Join-Path $repositoryRoot "node_modules")) {
    return
  }

  Write-Host "Installing Harvest dependencies for the first launch..." -ForegroundColor Cyan
  Push-Location $repositoryRoot
  try {
    & npm install
    if ($LASTEXITCODE -ne 0) {
      throw "npm install failed with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
}

function Start-NpmWindow {
  param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string]$Command
  )

  $commandLine = "title $Title && cd /d `"$repositoryRoot`" && $Command"
  Start-Process -FilePath $env:ComSpec -ArgumentList @("/d", "/k", $commandLine) | Out-Null
}

function Open-DefaultBrowser {
  param([Parameter(Mandatory = $true)][string]$Url)

  $explorerPath = Join-Path $env:WINDIR "explorer.exe"
  if (-not (Test-Path $explorerPath)) {
    throw "Harvest is ready at $Url, but Windows Explorer is unavailable. Open this address manually."
  }

  try {
    Start-Process -FilePath $explorerPath -ArgumentList @($Url) -ErrorAction Stop | Out-Null
  } catch {
    throw "Harvest is ready at $Url, but Windows could not open the registered default browser. Set a default app for HTTP links or open this address manually. Windows said: $($_.Exception.Message)"
  }
}

function Wait-UntilReady {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$ReadyCheck,
    [Parameter(Mandatory = $true)][string]$Description
  )

  $deadline = (Get-Date).AddSeconds($startupTimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (& $ReadyCheck) {
      return
    }
    Start-Sleep -Seconds 1
  }

  throw "$Description did not become ready within $startupTimeoutSeconds seconds. Check the visible Harvest server window for the exact error."
}

function Ensure-ProductStack {
  $apiReady = Test-ProductApi
  $websiteReady = Test-HarvestPage -Url $websiteUrl

  if ($apiReady -and $websiteReady) {
    Write-Host "Reusing the running Harvest Product API and website." -ForegroundColor Green
    return
  }

  if ((Test-TcpPort -Port 3001) -and -not $apiReady) {
    throw "Port 3001 is already in use, but it is not a healthy Harvest Product API. Stop the process using that port and try again."
  }
  if ((Test-TcpPort -Port 3000) -and -not $websiteReady) {
    throw "Port 3000 is already in use, but it is not the Harvest website. Stop the process using that port and try again."
  }
  if ($apiReady -or $websiteReady) {
    throw "Only part of Harvest is running. Stop the existing Harvest development terminal with Ctrl+C, close it, and click the launcher again so the API and website start together."
  }

  Assert-DockerRunning
  Install-DependenciesIfMissing
  Write-Host "Starting the Product API and website in a separate terminal..." -ForegroundColor Cyan
  Start-NpmWindow -Title "Harvest development server" -Command "npm run dev"
  Wait-UntilReady -Description "The Harvest Product API and website" -ReadyCheck {
    (Test-ProductApi) -and (Test-HarvestPage -Url $websiteUrl)
  }
}

function Ensure-ControlRoom {
  if (Test-HarvestPage -Url $controlRoomUrl) {
    Write-Host "Reusing the running Harvest simulation control room." -ForegroundColor Green
    return
  }

  if (Test-TcpPort -Port 3002) {
    throw "Port 3002 is already in use, but it is not the Harvest simulation control room. Stop the process using that port and try again."
  }

  Install-DependenciesIfMissing
  Write-Host "Starting the simulation control room in a separate terminal..." -ForegroundColor Cyan
  Start-NpmWindow -Title "Harvest simulation control room" -Command "npm run control-room"
  Wait-UntilReady -Description "The Harvest simulation control room" -ReadyCheck {
    Test-HarvestPage -Url $controlRoomUrl
  }
}

try {
  Assert-CommandAvailable -Name "node" -InstallMessage "Install Node.js 20.18 or newer, then try again."
  Assert-CommandAvailable -Name "npm" -InstallMessage "Install Node.js 20.18 or newer, which includes npm, then try again."
  Assert-CommandAvailable -Name "docker" -InstallMessage "Install Docker Desktop with Docker Compose, then try again."
  Assert-NodeVersion

  Set-Location $repositoryRoot
  Ensure-ProductStack

  if ($Target -eq "control-room") {
    Ensure-ControlRoom
    Write-Host "Opening the Harvest simulation control room..." -ForegroundColor Green
    Open-DefaultBrowser -Url $controlRoomUrl
  } else {
    $persona = $participantTargets[$Target]
    $encodedPersona = [uri]::EscapeDataString($persona)
    $participantUrl = "$websiteUrl/#harvest_demo_persona=$encodedPersona"
    Write-Host "Opening the $Target workspace..." -ForegroundColor Green
    Open-DefaultBrowser -Url $participantUrl
  }
} catch {
  Write-Host ""
  Write-Host "Harvest could not be opened." -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Yellow
  exit 1
}
