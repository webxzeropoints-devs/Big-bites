$ErrorActionPreference = "Stop"

$installerPath = "C:\Installer\Big Bites Restaurant_0.1.0_x64-setup.exe"
$resultPath = "C:\TestOut\candidate-validation-result.txt"
$setupLogPath = Join-Path $env:TEMP "BIG-BITES-POS-setup.log"
$serviceName = "bigbites-pos-postgresql-x64-17"
$result = [ordered]@{
  installerExitCode = "not-started"
  postgresqlService = "not-checked"
  backendHealth = "not-checked"
  desktopProcess = "not-checked"
  setupLogPresent = $false
}

[System.IO.File]::WriteAllText(
  $resultPath,
  "status=started`n",
  [System.Text.Encoding]::ASCII
)

try {
  if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
    throw "The candidate installer is missing from the Sandbox mapping."
  }

  $installer = Start-Process `
    -FilePath $installerPath `
    -ArgumentList "/S" `
    -PassThru
  if (-not $installer.WaitForExit(1500000)) {
    $result.installerExitCode = "timed-out"
    throw "The candidate installer did not finish within 25 minutes."
  }
  $result.installerExitCode = $installer.ExitCode
  $result.setupLogPresent = Test-Path -LiteralPath $setupLogPath -PathType Leaf

  if ($installer.ExitCode -ne 0) {
    throw "The candidate installer returned a nonzero exit code."
  }

  $serviceDeadline = (Get-Date).AddMinutes(2)
  do {
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($service -and $service.Status -eq "Running") {
      break
    }
    Start-Sleep -Seconds 2
  } until ((Get-Date) -gt $serviceDeadline)

  if (-not $service) {
    $result.postgresqlService = "missing"
  }
  else {
    $serviceDetails = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
    $result.postgresqlService = "$($service.Status); startMode=$($serviceDetails.StartMode)"
  }

  $healthDeadline = (Get-Date).AddMinutes(2)
  do {
    try {
      $health = Invoke-RestMethod `
        -Uri "http://127.0.0.1:3000/health" `
        -TimeoutSec 3
      if ($health.status -eq "OK" -and $health.database -eq "Connected") {
        $result.backendHealth = "healthy; database=Connected"
        break
      }
    }
    catch {
      $result.backendHealth = "unavailable"
    }
    Start-Sleep -Seconds 2
  } until ((Get-Date) -gt $healthDeadline)

  $result.desktopProcess = if (Get-Process -Name "desktop" -ErrorAction SilentlyContinue) {
    "running"
  }
  else {
    "not-running"
  }
}
catch {
  $result.failure = $_.Exception.Message
}
finally {
  $lines = foreach ($entry in $result.GetEnumerator()) {
    "{0}={1}" -f $entry.Key, $entry.Value
  }
  [System.IO.File]::WriteAllLines(
    $resultPath,
    $lines,
    [System.Text.Encoding]::ASCII
  )
}
