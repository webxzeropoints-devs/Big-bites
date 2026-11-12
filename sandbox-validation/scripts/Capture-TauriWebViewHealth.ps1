$ErrorActionPreference = "Stop"

if ($env:USERNAME -ne "WDAGUtilityAccount") {
  throw "Refusing to run outside Windows Sandbox. Run this diagnostic in the affected Sandbox PowerShell window."
}

$appPath = "C:\Program Files\Big Bites Restaurant\desktop.exe"
$outputPath = Join-Path `
  "C:\TestOut" `
  ("tauri-webview-health-{0}.json" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$debugPort = 9222
$result = [ordered]@{
  capturedAt = (Get-Date).ToString("o")
  computerName = $env:COMPUTERNAME
  userName = $env:USERNAME
  installedAppPath = $appPath
  powershellHealth = $null
  backendTask = $null
  postgresServices = @()
  webview = $null
  networkFailures = @()
  logs = @()
}
$script:networkFailures = New-Object System.Collections.ArrayList

function Add-RedactedLogTail([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return
  }

  $lines = @(
    Get-Content -LiteralPath $Path -Tail 35 -ErrorAction Stop |
      ForEach-Object {
        $_ `
          -replace '(?i)(postgres(?:ql)?://)[^\s]+', '$1[REDACTED]' `
          -replace '(?i)(password|AUTH_SECRET|DATABASE_URL)\s*[=:]\s*[^;\s]+', '$1=[REDACTED]'
      }
  )
  $result.logs += [ordered]@{
    path = $Path
    tail = $lines
  }
}

function Invoke-CdpCommand(
  [System.Net.WebSockets.ClientWebSocket]$Socket,
  [int]$Id,
  [string]$Method,
  [hashtable]$Parameters
) {
  $message = @{
    id = $Id
    method = $Method
    params = $Parameters
  } | ConvertTo-Json -Depth 10 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($message)
  $sendSegment = [System.ArraySegment[byte]]::new($bytes)
  $sendToken = [System.Threading.CancellationToken]::None
  $Socket.SendAsync(
    $sendSegment,
    [System.Net.WebSockets.WebSocketMessageType]::Text,
    $true,
    $sendToken
  ).GetAwaiter().GetResult() | Out-Null

  while ($true) {
    $buffer = New-Object byte[] 32768
    $receiveSegment = [System.ArraySegment[byte]]::new($buffer)
    $messageStream = New-Object System.IO.MemoryStream
    do {
      $receiveResult = $Socket.ReceiveAsync(
        $receiveSegment,
        $sendToken
      ).GetAwaiter().GetResult()
      if (
        $receiveResult.MessageType -eq
        [System.Net.WebSockets.WebSocketMessageType]::Close
      ) {
        throw "The WebView2 DevTools connection closed before returning a response."
      }
      $messageStream.Write($buffer, 0, $receiveResult.Count)
    } while (-not $receiveResult.EndOfMessage)

    $responseJson = [System.Text.Encoding]::UTF8.GetString(
      $messageStream.ToArray()
    )
    $messageStream.Dispose()
    $response = $responseJson | ConvertFrom-Json -ErrorAction Stop
    if ($response.method -eq "Network.loadingFailed") {
      [void]$script:networkFailures.Add($response.params)
    }
    if ($response.id -eq $Id) {
      return $response
    }
  }
}

try {
  if (-not (Test-Path -LiteralPath $appPath -PathType Leaf)) {
    throw "The installed desktop executable was not found at the expected path."
  }

  try {
    $health = Invoke-RestMethod `
      -Uri "http://127.0.0.1:3000/health" `
      -TimeoutSec 5 `
      -UseBasicParsing
    $result.powershellHealth = [ordered]@{
      status = $health.status
      database = $health.database
    }
  }
  catch {
    $result.powershellHealth = [ordered]@{
      errorType = $_.Exception.GetType().Name
      error = $_.Exception.Message
    }
  }

  $task = Get-ScheduledTask `
    -TaskName "BigBitesPosServer" `
    -ErrorAction SilentlyContinue
  if ($task) {
    $taskInfo = Get-ScheduledTaskInfo `
      -TaskName "BigBitesPosServer" `
      -ErrorAction SilentlyContinue
    $result.backendTask = [ordered]@{
      state = [string]$task.State
      lastRunTime = if ($taskInfo) { $taskInfo.LastRunTime.ToString("o") } else { $null }
      lastTaskResult = if ($taskInfo) { $taskInfo.LastTaskResult } else { $null }
      action = @(
        $task.Actions | ForEach-Object {
          @{
            executable = $_.Execute
            arguments = $_.Arguments
            workingDirectory = $_.WorkingDirectory
          }
        }
      )
    }
  }
  else {
    $result.backendTask = "Not found"
  }

  $result.postgresServices = @(
    Get-CimInstance Win32_Service -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match "(?i)postgresql|bigbites" } |
      ForEach-Object {
        @{
          name = $_.Name
          state = $_.State
          startMode = $_.StartMode
        }
      }
  )

  $listeners = @(
    Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue |
      Select-Object LocalAddress, LocalPort, OwningProcess
  )
  $result.loopbackListeners = $listeners

  $runningDesktopProcesses = @(
    Get-CimInstance Win32_Process -Filter "Name='desktop.exe'" `
      -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath -ieq $appPath }
  )
  foreach ($process in $runningDesktopProcesses) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
  }

  $portAvailable = $true
  $tcpClient = New-Object System.Net.Sockets.TcpClient
  try {
    $connect = $tcpClient.BeginConnect("127.0.0.1", $debugPort, $null, $null)
    if ($connect.AsyncWaitHandle.WaitOne(500)) {
      try {
        $tcpClient.EndConnect($connect)
        $portAvailable = $false
      }
      catch {
      }
    }
  }
  finally {
    $tcpClient.Dispose()
  }
  if (-not $portAvailable) {
    throw "The local WebView2 diagnostic port 9222 is already in use; no other process was changed."
  }

  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS =
    "--remote-debugging-port=$debugPort --remote-allow-origins=http://localhost"
  Start-Process -FilePath $appPath -ErrorAction Stop | Out-Null

  $deadline = (Get-Date).AddSeconds(45)
  $targets = @()
  do {
    Start-Sleep -Seconds 1
    try {
      $targets = @(
        Invoke-RestMethod `
          -Uri "http://127.0.0.1:$debugPort/json/list" `
          -TimeoutSec 2 `
          -UseBasicParsing
      )
    }
    catch {
      $targets = @()
    }
    $pageTarget = $targets |
      Where-Object {
        $_.type -eq "page" -and
        $_.webSocketDebuggerUrl -match "^ws://127\.0\.0\.1:$debugPort/"
      } |
      Select-Object -First 1
  } until ($pageTarget -or (Get-Date) -gt $deadline)

  if (-not $pageTarget) {
    throw "WebView2 remote debugging did not become available. The app was launched with a loopback-only diagnostic port."
  }

  $socket = New-Object System.Net.WebSockets.ClientWebSocket
  $socket.Options.SetRequestHeader("Origin", "http://localhost")
  $connectTimeout = New-Object System.Threading.CancellationTokenSource
  $connectTimeout.CancelAfter(10000)
  $socket.ConnectAsync(
    [Uri]$pageTarget.webSocketDebuggerUrl,
    $connectTimeout.Token
  ).GetAwaiter().GetResult()

  try {
    $networkEnabled = Invoke-CdpCommand `
      -Socket $socket `
      -Id 1 `
      -Method "Network.enable" `
      -Parameters @{}
    if ($networkEnabled.error) {
      throw "DevTools could not enable network diagnostics."
    }

    $expression = @'
(async () => {
  const started = performance.now();
  const result = {
    pageOrigin: location.origin,
    pageUrl: location.href,
    requestUrl: "http://127.0.0.1:3000/health"
  };
  try {
    const response = await fetch(result.requestUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store"
    });
    result.httpStatus = response.status;
    result.responseBody = await response.text();
    result.ok = response.ok;
  } catch (error) {
    result.ok = false;
    result.errorName = error && error.name ? error.name : "Error";
    result.errorMessage = error && error.message ? error.message : String(error);
    result.errorStack = error && error.stack ? error.stack : null;
  }
  result.elapsedMilliseconds = Math.round(performance.now() - started);
  return JSON.stringify(result);
})()
'@
    $evaluation = Invoke-CdpCommand `
      -Socket $socket `
      -Id 2 `
      -Method "Runtime.evaluate" `
      -Parameters @{
        expression = $expression
        awaitPromise = $true
        returnByValue = $true
      }
    if ($evaluation.error) {
      throw "DevTools could not evaluate the health request in the Tauri WebView."
    }

    $result.webview = $evaluation.result.result.value |
      ConvertFrom-Json -ErrorAction Stop
    if ($evaluation.result.exceptionDetails) {
      $result.webviewEvaluationError =
        $evaluation.result.exceptionDetails.text
    }
    $result.networkFailures = @($script:networkFailures.ToArray())
  }
  finally {
    if ($socket.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
      $socket.CloseAsync(
        [System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure,
        "Diagnostic complete",
        [System.Threading.CancellationToken]::None
      ).GetAwaiter().GetResult() | Out-Null
    }
    $socket.Dispose()
    $connectTimeout.Dispose()
  }
}
catch {
  $result.diagnosticError = $_.Exception.Message
}
finally {
  Add-RedactedLogTail `
    (Join-Path $env:TEMP "BIG-BITES-POS-setup.log")
  Add-RedactedLogTail "C:\ProgramData\BIG BITES POS\logs\startup.log"
  $latestServerError = Get-ChildItem `
    -LiteralPath "C:\ProgramData\BIG BITES POS\logs" `
    -Filter "server-*.err.log" `
    -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($latestServerError) {
    Add-RedactedLogTail $latestServerError.FullName
  }

  $result | ConvertTo-Json -Depth 10 |
    Set-Content -LiteralPath $outputPath -Encoding UTF8
  Write-Output "Diagnostic written to C:\TestOut\$([System.IO.Path]::GetFileName($outputPath))"
}
