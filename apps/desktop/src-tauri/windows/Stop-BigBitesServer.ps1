$ErrorActionPreference = "Stop"
$taskName = "BigBitesPosServer"
$serverDir = Join-Path $env:ProgramData "BIG BITES POS\server"
$startupScript = Join-Path $serverDir "Start-BigBitesServer.ps1"
$legacyServerEntry = [regex]::Escape(
  (Join-Path $serverDir "dist\server.js")
)
$payloadServerEntry = [regex]::Escape(
  (Join-Path $serverDir "payloads")
) + '\\[a-f0-9]{32}\\dist\\server\.js'
$serverEntryPattern = "(?:$legacyServerEntry|$payloadServerEntry)(?:""|[\s]|$)"

$tasks = Get-ScheduledTask -ErrorAction Stop |
  Where-Object { $_.TaskName -eq $taskName -and $_.TaskPath -eq "\" }

foreach ($task in $tasks) {
  $expectedAction = @(
    $task.Actions | Where-Object {
      $_.Execute -match '(?i)(?:^|\\)powershell\.exe$' -and
      $_.Arguments -match [regex]::Escape($startupScript)
    }
  )
  if ($task.Actions.Count -ne 1 -or $expectedAction.Count -ne 1) {
    throw "A task named $taskName exists, but it is not the expected BIG BITES POS startup task. It was left unchanged."
  }
}

foreach ($task in $tasks) {
  if ($task.State -eq "Running") {
    Stop-ScheduledTask -TaskName $taskName -TaskPath "\" -ErrorAction Stop
  }
}

function Get-BigBitesServerProcesses {
  Get-CimInstance Win32_Process -ErrorAction Stop |
    Where-Object {
      $_.Name -eq "node.exe" -and
      $_.CommandLine -match $serverEntryPattern
    }
}

$processes = @(Get-BigBitesServerProcesses)

foreach ($process in $processes) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
}

$deadline = (Get-Date).AddSeconds(15)
do {
  $remainingProcesses = @(Get-BigBitesServerProcesses)

  if ($remainingProcesses.Count -eq 0) {
    break
  }

  Start-Sleep -Milliseconds 500
} until ((Get-Date) -gt $deadline)

if ($remainingProcesses.Count -gt 0) {
  throw "The BIG BITES POS server process could not be stopped."
}

foreach ($task in $tasks) {
  Unregister-ScheduledTask `
    -TaskName $taskName `
    -TaskPath "\" `
    -Confirm:$false `
    -ErrorAction Stop
}
