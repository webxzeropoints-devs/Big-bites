param(
  [switch]$AfterReboot,
  [string]$RunId
)

$ErrorActionPreference = "Stop"
$testOutput = "C:\TestOut"
$resultPath = Join-Path $testOutput "installer-sandbox-$RunId.json"
$setupLog = Join-Path $env:TEMP "BIG-BITES-POS-setup.log"
$installerPath = "C:\Installer\Big Bites Restaurant_0.1.0_x64-setup.exe"
$desktopPath = "C:\Program Files\Big Bites Restaurant\desktop.exe"
$postgresServiceName = "bigbites-pos-postgresql-x64-17"
$serverTaskName = "BigBitesPosServer"
$rebootTaskName = "BigBitesSandboxPostRebootValidation"

function Get-BackendReadiness {
  $deadline = (Get-Date).AddMinutes(3)
  do {
    try {
      $health = Invoke-RestMethod `
        -Uri "http://127.0.0.1:3000/health" `
        -TimeoutSec 10 `
        -UseBasicParsing
      if ($health.status -eq "OK" -and $health.database -eq "Connected") {
        return "Ready"
      }
    }
    catch {
      Start-Sleep -Seconds 3
      continue
    }
    Start-Sleep -Seconds 3
  } until ((Get-Date) -gt $deadline)

  return "NotReady"
}

function Write-TestResult($Result) {
  $Result | ConvertTo-Json -Depth 6 |
    Set-Content -LiteralPath $resultPath -Encoding UTF8
}

if ($AfterReboot) {
  try {
    $result = Get-Content -LiteralPath $resultPath -Raw |
      ConvertFrom-Json -ErrorAction Stop
    $service = Get-CimInstance Win32_Service |
      Where-Object { $_.Name -eq $postgresServiceName }
    $task = Get-ScheduledTask -TaskName $serverTaskName -ErrorAction Stop
    $healthStatus = Get-BackendReadiness
    $serviceStatus = if ($service) { [string]$service.State } else { "Missing" }
    $serviceStartMode = if ($service) { [string]$service.StartMode } else { "Missing" }
    $result.postReboot = [ordered]@{
      timestamp = (Get-Date).ToString("o")
      postgresService = $serviceStatus
      postgresStartMode = $serviceStartMode
      backendTaskPresent = ($null -ne $task)
      backendHealth = $healthStatus
      passed = (
        $serviceStatus -eq "Running" -and
        $serviceStartMode -eq "Auto" -and
        $healthStatus -eq "Ready"
      )
    }
    Write-TestResult $result
  }
  catch {
    $failure = [ordered]@{
      runId = $RunId
      postReboot = [ordered]@{
        timestamp = (Get-Date).ToString("o")
        passed = $false
        error = $_.Exception.Message
      }
    }
    Write-TestResult $failure
  }
  finally {
    Unregister-ScheduledTask -TaskName $rebootTaskName -Confirm:$false `
      -ErrorAction SilentlyContinue
  }
  exit
}

if ([string]::IsNullOrWhiteSpace($RunId)) {
  $RunId = Get-Date -Format "yyyyMMdd-HHmmss"
  $resultPath = Join-Path $testOutput "installer-sandbox-$RunId.json"
}

$result = [ordered]@{
  runId = $RunId
  installer = $installerPath
  startedAt = (Get-Date).ToString("o")
  installerExitCode = $null
  setupLogCopied = $false
  postgresService = "NotChecked"
  postgresStartMode = "NotChecked"
  backendTaskPresent = $false
  backendHealth = "NotChecked"
  desktopProcessPresent = $false
  postReboot = $null
  passedInitialChecks = $false
  setupStage = "starting"
  setupElapsedSeconds = 0
}
Write-TestResult $result

try {
  if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
    throw "The installer is missing from C:\Installer."
  }

  $setup = Start-Process `
    -FilePath $installerPath `
    -ArgumentList "/S" `
    -PassThru `
    -ErrorAction Stop
  $setupDeadline = (Get-Date).AddHours(1)
  $setupTimer = [System.Diagnostics.Stopwatch]::StartNew()
  $setupExited = $false
  while (-not $setupExited -and (Get-Date) -lt $setupDeadline) {
    $setupExited = $setup.WaitForExit(15000)
    if (-not $setupExited) {
      $result.setupStage = "installer-running"
      $result.setupElapsedSeconds = [int]$setupTimer.Elapsed.TotalSeconds
      if (Test-Path -LiteralPath $setupLog -PathType Leaf) {
        try {
          Copy-Item -LiteralPath $setupLog `
            -Destination (Join-Path $testOutput "setup-$RunId.log") -Force
          $result.setupLogCopied = $true
        }
        catch {
          $result.setupLogCopyError = $_.Exception.Message
        }
      }
      Write-TestResult $result
    }
  }
  if (-not $setupExited) {
    Stop-Process -Id $setup.Id -Force -ErrorAction SilentlyContinue
    throw "The installer exceeded the one-hour Sandbox test limit."
  }
  $setup.Refresh()
  $result.installerExitCode = $setup.ExitCode
  $result.setupElapsedSeconds = [int]$setupTimer.Elapsed.TotalSeconds
  $result.setupStage = "installer-exited"

  if (Test-Path -LiteralPath $setupLog -PathType Leaf) {
    Copy-Item -LiteralPath $setupLog `
      -Destination (Join-Path $testOutput "setup-$RunId.log") -Force
    $result.setupLogCopied = $true
  }
  if ($setup.ExitCode -ne 0) {
    throw "The installer returned exit code $($setup.ExitCode)."
  }

  $service = Get-CimInstance Win32_Service |
    Where-Object { $_.Name -eq $postgresServiceName }
  $task = Get-ScheduledTask -TaskName $serverTaskName -ErrorAction SilentlyContinue
  $result.postgresService = if ($service) { [string]$service.State } else { "Missing" }
  $result.postgresStartMode = if ($service) { [string]$service.StartMode } else { "Missing" }
  $result.backendTaskPresent = ($null -ne $task)
  $result.backendHealth = Get-BackendReadiness
  $desktopDeadline = (Get-Date).AddSeconds(30)
  do {
    $desktopProcess = Get-Process -Name "desktop" -ErrorAction SilentlyContinue
    if ($desktopProcess) {
      $result.desktopProcessPresent = $true
      break
    }
    Start-Sleep -Seconds 2
  } until ((Get-Date) -gt $desktopDeadline)

  $result.passedInitialChecks = (
    $result.postgresService -eq "Running" -and
    $result.postgresStartMode -eq "Auto" -and
    $result.backendTaskPresent -and
    $result.backendHealth -eq "Ready" -and
    $result.desktopProcessPresent
  )
  Write-TestResult $result
  if (-not $result.passedInitialChecks) {
    throw "One or more initial service, backend health, or desktop checks failed."
  }

  $taskAction = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\TestScripts\Run-BigBitesSandboxTest.ps1 -AfterReboot -RunId $RunId"
  $taskTrigger = New-ScheduledTaskTrigger -AtStartup
  $taskPrincipal = New-ScheduledTaskPrincipal `
    -UserId "SYSTEM" `
    -LogonType ServiceAccount `
    -RunLevel Highest
  Register-ScheduledTask `
    -TaskName $rebootTaskName `
    -Action $taskAction `
    -Trigger $taskTrigger `
    -Principal $taskPrincipal `
    -Force | Out-Null
  Write-Host "Initial checks passed; rebooting the disposable Sandbox for startup validation."
  Restart-Computer -Force
}
catch {
  $result.failure = $_.Exception.Message
  if (Test-Path -LiteralPath $setupLog -PathType Leaf) {
    Copy-Item -LiteralPath $setupLog `
      -Destination (Join-Path $testOutput "setup-$RunId.log") -Force
    $result.setupLogCopied = $true
  }
  Write-TestResult $result
  exit 1
}
