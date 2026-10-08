$ErrorActionPreference = "Stop"
$serverDir = Join-Path $env:ProgramData "BIG BITES POS\server"
$logDir = Join-Path $env:ProgramData "BIG BITES POS\logs"
$nodePath = Join-Path $env:ProgramFiles "nodejs\node.exe"
$serverEntry = Join-Path $serverDir "dist\server.js"
$logPrefix = Join-Path $logDir ("server-" + (Get-Date -Format "yyyyMMdd"))

if (-not (Test-Path -LiteralPath $nodePath)) {
  throw "Node.js was not found at $nodePath."
}

if (-not (Test-Path -LiteralPath $serverEntry)) {
  throw "The BIG BITES POS server entrypoint was not found at $serverEntry."
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$existing = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.Name -eq "node.exe" -and
    $_.CommandLine -match "dist[\\/]server\.js" -and
    $_.CommandLine -match [regex]::Escape($serverDir)
  }

if ($existing) {
  exit 0
}

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

exit 0
