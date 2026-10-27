$ErrorActionPreference = "Stop"
$serverDir = Join-Path $env:ProgramData "BIG BITES POS\server"
$logDir = Join-Path $env:ProgramData "BIG BITES POS\logs"
$nodePath = Join-Path `
  (Join-Path $serverDir "runtime") `
  "node-3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237\node.exe"
$activePayloadFile = Join-Path $serverDir "active-payload.txt"
$activePayloadId = $null
if (Test-Path -LiteralPath $activePayloadFile -PathType Leaf) {
  $activePayloadId = [System.IO.File]::ReadAllText($activePayloadFile).Trim()
  if ($activePayloadId -notmatch '^[a-f0-9]{32}$') {
    throw "The active BIG BITES POS server payload pointer is invalid."
  }
  $payloadDir = Join-Path (Join-Path $serverDir "payloads") $activePayloadId
}
else {
  $payloadDir = $serverDir
}
$serverEntry = Join-Path $payloadDir "dist\server.js"
$logPrefix = Join-Path $logDir ("server-" + (Get-Date -Format "yyyyMMdd"))
$startupLog = Join-Path $logDir "startup.log"
$env:BIGBITES_ENABLE_PRODUCTION_CATALOG_SYNC = "false"

if (-not (Test-Path -LiteralPath $nodePath)) {
  throw "Node.js was not found at $nodePath."
}

if (-not (Test-Path -LiteralPath $serverEntry)) {
  throw "The BIG BITES POS server entrypoint was not found at $serverEntry."
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Get-BigBitesServerProcess {
  $legacyServerEntry = [regex]::Escape(
    (Join-Path $serverDir "dist\server.js")
  )
  $payloadServerEntry = [regex]::Escape(
    (Join-Path $serverDir "payloads")
  ) + '\\[a-f0-9]{32}\\dist\\server\.js'
  $serverEntryPattern = "(?:$legacyServerEntry|$payloadServerEntry)(?:""|[\s]|$)"
  return Get-CimInstance Win32_Process -ErrorAction Stop |
    Where-Object {
      $_.Name -eq "node.exe" -and
      $_.CommandLine -match $serverEntryPattern
    }
}

$existing = Get-BigBitesServerProcess

if (-not $existing) {
  $stdoutLog = "$logPrefix.out.log"
  $stderrLog = "$logPrefix.err.log"
  $serverEntryArgument = '"{0}"' -f $serverEntry

  $process = Start-Process `
    -FilePath $nodePath `
    -ArgumentList $serverEntryArgument `
    -WorkingDirectory $serverDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru

  if ($null -eq $process) {
    throw "The BIG BITES POS server failed to start in the background."
  }
}

$deadline = (Get-Date).AddSeconds(45)
$healthy = $false

do {
  Start-Sleep -Seconds 2

  $runningServer = Get-BigBitesServerProcess
  if (-not $runningServer) {
    break
  }

  try {
    $health = Invoke-RestMethod `
      -Uri "http://127.0.0.1:3000/health" `
      -TimeoutSec 3
    $healthy = $health.status -eq "OK" -and
      $health.database -eq "Connected"
  }
  catch {
    $healthy = $false
  }
} until ($healthy -or (Get-Date) -gt $deadline)

if (-not $healthy) {
  $message = "BIG BITES POS startup did not reach a healthy API and database. Check the server logs."
  try {
    Add-Content -LiteralPath $startupLog -Value (
      "{0} {1}" -f (Get-Date -Format "o"), $message
    )
  }
  catch {
    throw "$message Startup diagnostics could not be written to the local log."
  }
  throw $message
}
