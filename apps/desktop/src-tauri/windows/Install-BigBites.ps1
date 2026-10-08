param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDir,

  [Parameter(Mandatory = $true)]
  [string]$ServerSourcePath,

  [string]$LogPath
)

$ErrorActionPreference = "Stop"
$script:pgHbaPath = $null
$script:pgHbaOriginalBytes = $null
$script:postgresServiceName = $null
$script:postgresAuthTemporarilyTrusted = $false

if ([string]::IsNullOrWhiteSpace($LogPath)) {
  $LogPath = Join-Path $env:TEMP (
    "BIG-BITES-POS-setup-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss")
  )
}

try {
  Start-Transcript -Path $LogPath -Append -Force | Out-Null
}
catch {
  [Console]::Error.WriteLine(
    "Could not start setup transcript at '$LogPath': $($_.Exception.Message)"
  )
  exit 1
}

trap {
  Write-Host "BIG BITES POS setup failed: $($_.ToString())"
  [Console]::Error.WriteLine(
    "BIG BITES POS setup failed: $($_.ToString())"
  )
  try {
    Restore-PostgresAuthentication
  }
  catch {
    [Console]::Error.WriteLine(
      "Could not restore PostgreSQL authentication: $($_.Exception.Message)"
    )
  }
  try {
    Stop-Transcript | Out-Null
  }
  catch {
  }
  exit 1
}

$taskName = "BigBitesPosServer"
Write-Host "Install directory: $InstallDir"
Write-Host "Server resources: $ServerSourcePath"
Write-Host "Installer log: $LogPath"

$dataRoot = Join-Path $env:ProgramData "BIG BITES POS"
$programFilesRoot = if ($env:ProgramW6432) {
  $env:ProgramW6432
}
else {
  $env:ProgramFiles
}
$serverDir = Join-Path $dataRoot "server"
$serverLogs = Join-Path $dataRoot "logs"
$envFile = Join-Path $serverDir ".env"


# ============================================================
# FUNCTIONS
# ============================================================

function Invoke-WingetInstall([string]$PackageId, [string]$Override = "") {

  $arguments = @(
    "install",
    "--id", $PackageId,
    "--exact",
    "--silent",
    "--accept-package-agreements",
    "--accept-source-agreements"
  )

  if ($Override) {
    $arguments += @(
      "--override",
      $Override
    )
  }

  & winget @arguments

  if ($LASTEXITCODE -ne 0) {
    throw "winget could not install $PackageId (exit code $LASTEXITCODE)."
  }
}


function Get-PostgresCli {

  $matches = Get-ChildItem `
    (Join-Path $programFilesRoot "PostgreSQL\*\bin\psql.exe") `
    -ErrorAction SilentlyContinue

  return $matches |
    Sort-Object FullName -Descending |
    Select-Object -First 1
}


function New-RandomSecret([int]$ByteCount) {

  $bytes = New-Object byte[] $ByteCount

  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()

  try {
    $generator.GetBytes($bytes)
  }
  finally {
    $generator.Dispose()
  }

  return [Convert]::ToBase64String($bytes).TrimEnd([char[]]"=")
}


function Invoke-Psql([string]$Sql) {

  & $script:psqlPath `
    -w `
    -h 127.0.0.1 `
    -p 5432 `
    -U postgres `
    -d postgres `
    -v ON_ERROR_STOP=1 `
    -c $Sql

  if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL setup failed. Check the PostgreSQL service and its installer logs."
  }
}

function Restore-PostgresAuthentication {
  if (-not $script:pgHbaOriginalBytes) {
    return
  }

  [System.IO.File]::WriteAllBytes(
    $script:pgHbaPath,
    $script:pgHbaOriginalBytes
  )

  if ($script:postgresAuthTemporarilyTrusted) {
    Restart-Service -Name $script:postgresServiceName -Force
    $service = Get-Service -Name $script:postgresServiceName
    $service.WaitForStatus(
      [System.ServiceProcess.ServiceControllerStatus]::Running,
      [TimeSpan]::FromMinutes(2)
    )
  }

  $script:pgHbaOriginalBytes = $null
  $script:postgresAuthTemporarilyTrusted = $false
}

function Stop-ExistingServer {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task -and $task.State -eq "Running") {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
  }

  $serverPattern = [regex]::Escape($serverDir)
  $getServerProcesses = {
    Get-CimInstance Win32_Process -ErrorAction Stop |
      Where-Object {
        $_.Name -eq "node.exe" -and
        $_.CommandLine -match "dist[\\/]server\.js" -and
        $_.CommandLine -match $serverPattern
      }
  }

  $processes = @(& $getServerProcesses)
  foreach ($process in $processes) {
    Write-Host "Stopping existing BIG BITES POS server process $($process.ProcessId)..."
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
  }

  $deadline = (Get-Date).AddSeconds(15)
  do {
    $remainingProcesses = @(& $getServerProcesses)
    if ($remainingProcesses.Count -eq 0) {
      return
    }
    Start-Sleep -Milliseconds 500
  } until ((Get-Date) -gt $deadline)

  $processIds = ($remainingProcesses | ForEach-Object { $_.ProcessId }) -join ", "
  throw "The existing BIG BITES POS server process(es) $processIds could not be stopped."
}

function Enable-LocalPostgresSetupAccess {
  $instanceRoot = Split-Path (Split-Path $script:psqlPath -Parent) -Parent
  $rootPattern = [regex]::Escape($instanceRoot)
  $service = Get-CimInstance Win32_Service |
    Where-Object {
      $_.Name -like "postgresql*" -and
      $_.PathName -match $rootPattern
    } |
    Sort-Object Name -Descending |
    Select-Object -First 1

  if (-not $service) {
    throw "Could not identify the PostgreSQL service for $instanceRoot."
  }

  $dataDirectoryMatch = [regex]::Match(
    $service.PathName,
    '(?i)(?:-D|--pgdata)\s+(?:"([^"]+)"|([^\s]+))'
  )
  if (-not $dataDirectoryMatch.Success) {
    throw "Could not identify the data directory for PostgreSQL service $($service.Name)."
  }

  $dataDirectory = if ($dataDirectoryMatch.Groups[1].Success) {
    $dataDirectoryMatch.Groups[1].Value
  }
  else {
    $dataDirectoryMatch.Groups[2].Value
  }
  $pgHbaPath = Join-Path $dataDirectory "pg_hba.conf"
  if (-not (Test-Path -LiteralPath $pgHbaPath)) {
    throw "PostgreSQL authentication configuration was not found."
  }

  $script:pgHbaPath = $pgHbaPath
  $script:pgHbaOriginalBytes = [System.IO.File]::ReadAllBytes($pgHbaPath)
  $content = [System.IO.File]::ReadAllText($pgHbaPath).TrimStart([char]0xFEFF)
  $temporaryRule = "host all postgres 127.0.0.1/32 trust$([Environment]::NewLine)"
  [System.IO.File]::WriteAllText(
    $pgHbaPath,
    $temporaryRule + $content,
    (New-Object System.Text.UTF8Encoding($false))
  )
  $script:postgresServiceName = $service.Name
  $script:postgresAuthTemporarilyTrusted = $true

  try {
    if ($service.State -eq "Running") {
      Restart-Service -Name $service.Name -Force
    }
    else {
      Start-Service -Name $service.Name
    }
    $runningService = Get-Service -Name $service.Name
    $runningService.WaitForStatus(
      [System.ServiceProcess.ServiceControllerStatus]::Running,
      [TimeSpan]::FromMinutes(2)
    )

    $pgIsReady = Join-Path (Split-Path $script:psqlPath -Parent) "pg_isready.exe"
    $deadline = (Get-Date).AddMinutes(2)
    do {
      & $pgIsReady -h 127.0.0.1 -p 5432 -t 3 | Out-Null
      if ($LASTEXITCODE -eq 0) {
        return
      }
      Start-Sleep -Seconds 2
    } until ((Get-Date) -gt $deadline)

    throw "PostgreSQL did not become ready for local setup."
  }
  catch {
    Restore-PostgresAuthentication
    throw
  }
}


# ============================================================
# VALIDATION
# ============================================================

$hasBundledServer = Test-Path $ServerSourcePath -and
  (Test-Path (Join-Path $ServerSourcePath "dist\server.js"))

if (-not $hasBundledServer) {
  Write-Warning "The packaged server resources were not found at $ServerSourcePath. Continuing without the bundled local server setup."
}

if (-not (Test-Path (Join-Path $PSScriptRoot "Start-BigBitesServer.ps1"))) {
  throw "The packaged server startup script was not found at $PSScriptRoot."
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  throw "Windows Package Manager (winget) is required. Install the App Installer component and run setup again."
}

if ($hasBundledServer) {
  Stop-ExistingServer
}


if ($hasBundledServer) {

# ============================================================
# CREATE DATA DIRECTORIES
# ============================================================

New-Item `
  -ItemType Directory `
  -Force `
  -Path $dataRoot |
  Out-Null


# Restrict BIG BITES configuration folder
& icacls.exe `
  $dataRoot `
  /inheritance:r `
  /grant:r "SYSTEM:(OI)(CI)F" `
  "Administrators:(OI)(CI)F" `
  /T `
  /C |
  Out-Null

if ($LASTEXITCODE -ne 0) {
  throw "Could not restrict access to the local server configuration."
}


# ============================================================
# INSTALL / FIND NODE.JS
# ============================================================

$nodePath = Join-Path `
  $programFilesRoot `
  "nodejs\node.exe"

if (-not (Test-Path $nodePath)) {

  Write-Host "Node.js not found. Installing Node.js LTS automatically..."

  try {
    Invoke-WingetInstall "OpenJS.NodeJS.LTS"
  }
  catch {
    if ($_.Exception.Message -notmatch "exit code -1978335189") {
      throw
    }

    Write-Host "winget reports that Node.js is already installed; checking for its system executable."
  }

  $nodeInstallDeadline = (Get-Date).AddMinutes(5)
  do {
    if (Test-Path $nodePath) {
      break
    }

    Start-Sleep -Seconds 3
  } until ((Get-Date) -gt $nodeInstallDeadline)
}

if (-not (Test-Path $nodePath)) {
  throw "Node.js installation completed but node.exe was not found."
}

Write-Host "Node.js is ready."


# ============================================================
# INSTALL / FIND POSTGRESQL
# ============================================================

$psql = Get-PostgresCli

$postgresPassword = $null


if (-not $psql) {

  Write-Host "PostgreSQL not found. Installing PostgreSQL automatically..."

  $postgresPassword = `
    (New-RandomSecret 36).
    Replace("+", "A").
    Replace("/", "B")

  $override = `
    "--mode unattended " +
    "--unattendedmodeui none " +
    "--superpassword $postgresPassword " +
    "--serverport 5432 " +
    "--servicename postgresql-x64-17"

  Invoke-WingetInstall `
    "PostgreSQL.PostgreSQL.17" `
    $override

  $deadline = (Get-Date).AddMinutes(5)

  do {

    Start-Sleep -Seconds 3

    $psql = Get-PostgresCli

  } until (
    $psql -or
    (Get-Date) -gt $deadline
  )

  if (-not $psql) {
    throw "PostgreSQL installation completed but psql.exe was not found."
  }

  Write-Host "PostgreSQL installed successfully."
}
else {

  Write-Host "Existing PostgreSQL detected. Using the existing PostgreSQL installation."
}


# ============================================================
# CREATE SERVER / LOG DIRECTORIES
# ============================================================

New-Item `
  -ItemType Directory `
  -Force `
  -Path $serverDir, $serverLogs |
  Out-Null


# ============================================================
# FIX PERMISSIONS
# ============================================================

Write-Host "Configuring BIG BITES POS server permissions..."


& takeown.exe `
  /F $serverDir `
  /R `
  /D Y |
  Out-Null

$serverTakeOwnExitCode = $LASTEXITCODE


& takeown.exe `
  /F $serverLogs `
  /R `
  /D Y |
  Out-Null

$logsTakeOwnExitCode = $LASTEXITCODE


if (
  $serverTakeOwnExitCode -ne 0 -or
  $logsTakeOwnExitCode -ne 0
) {
  throw "Could not take ownership of the BIG BITES POS server folders (server exit code $serverTakeOwnExitCode, logs exit code $logsTakeOwnExitCode)."
}


& icacls.exe `
  $serverDir `
  /reset `
  /T `
  /C |
  Out-Null


$serverResetExitCode = $LASTEXITCODE


& icacls.exe `
  $serverLogs `
  /reset `
  /T `
  /C |
  Out-Null


$logsResetExitCode = $LASTEXITCODE


if (
  $serverResetExitCode -ne 0 -or
  $logsResetExitCode -ne 0
) {
  throw "Could not reset permissions for the BIG BITES POS server folders (server exit code $serverResetExitCode, logs exit code $logsResetExitCode)."
}


& icacls.exe `
  $serverDir `
  /inheritance:r `
  /grant:r "SYSTEM:(OI)(CI)F" `
  "Administrators:(OI)(CI)F" `
  /T `
  /C |
  Out-Null


$serverAclExitCode = $LASTEXITCODE


& icacls.exe `
  $serverLogs `
  /inheritance:r `
  /grant:r "SYSTEM:(OI)(CI)F" `
  "Administrators:(OI)(CI)F" `
  /T `
  /C |
  Out-Null


$logsAclExitCode = $LASTEXITCODE


if (
  $serverAclExitCode -ne 0 -or
  $logsAclExitCode -ne 0
) {
  throw "Could not configure permissions for the BIG BITES POS server folders (server exit code $serverAclExitCode, logs exit code $logsAclExitCode)."
}


& icacls.exe `
  $serverDir `
  /grant:r `
  "*S-1-5-18:F" `
  "*S-1-5-32-544:F" `
  /T `
  /C |
  Out-Null


$serverFilesAclExitCode = $LASTEXITCODE


& icacls.exe `
  $serverLogs `
  /grant:r `
  "*S-1-5-18:F" `
  "*S-1-5-32-544:F" `
  /T `
  /C |
  Out-Null


$logsFilesAclExitCode = $LASTEXITCODE


if (
  $serverFilesAclExitCode -ne 0 -or
  $logsFilesAclExitCode -ne 0
) {
  throw "Could not grant SYSTEM/Administrators access to the BIG BITES POS server files (server exit code $serverFilesAclExitCode, logs exit code $logsFilesAclExitCode)."
}


# ============================================================
# COPY PRODUCTION SERVER
# ============================================================

Write-Host "Copying BIG BITES POS server files..."

foreach (
  $payloadPath in @(
    (Join-Path $serverDir "dist"),
    (Join-Path $serverDir "node_modules"),
    (Join-Path $serverDir "prisma"),
    (Join-Path $serverDir "package.json"),
    (Join-Path $serverDir "prisma.config.ts"),
    (Join-Path $serverDir "src\utils\password.ts")
  )
) {
  if (Test-Path -LiteralPath $payloadPath) {
    Remove-Item -LiteralPath $payloadPath -Recurse -Force
  }
}


Copy-Item `
  (Join-Path $ServerSourcePath "dist") `
  (Join-Path $serverDir "dist") `
  -Recurse `
  -Force


Copy-Item `
  (Join-Path $ServerSourcePath "node_modules") `
  (Join-Path $serverDir "node_modules") `
  -Recurse `
  -Force


Copy-Item `
  (Join-Path $ServerSourcePath "prisma") `
  (Join-Path $serverDir "prisma") `
  -Recurse `
  -Force


Copy-Item `
  (Join-Path $ServerSourcePath "package.json") `
  (Join-Path $serverDir "package.json") `
  -Force


Copy-Item `
  (Join-Path $ServerSourcePath "prisma.config.ts") `
  (Join-Path $serverDir "prisma.config.ts") `
  -Force


New-Item `
  -ItemType Directory `
  -Force `
  -Path (Join-Path $serverDir "src\utils") |
  Out-Null


Copy-Item `
  (Join-Path $ServerSourcePath "src\utils\password.ts") `
  (Join-Path $serverDir "src\utils\password.ts") `
  -Force


# ============================================================
# VERIFY SERVER PACKAGE
# ============================================================

if (
  -not (Test-Path (Join-Path $serverDir "dist\server.js")) -or
  -not (Test-Path (Join-Path $serverDir "node_modules\prisma\build\index.js"))
) {

  throw "The packaged server is incomplete (compiled backend or Prisma runtime missing)."
}


# ============================================================
# CREATE DATABASE CREDENTIALS
# ============================================================

$appPassword = `
  (New-RandomSecret 36).
  Replace("+", "C").
  Replace("/", "D")


$authSecret = New-RandomSecret 48


$databaseUrl = `
  "postgresql://bigbites_app:${appPassword}@127.0.0.1:5432/bigbites?schema=public"


@(
  "DATABASE_URL=$databaseUrl"
  "AUTH_SECRET=$authSecret"
  "NODE_ENV=production"
  "PORT=3000"
  "DISCOVERY_PORT=3001"
) |
  Set-Content `
    -Path $envFile `
    -Encoding ascii


# ============================================================
# CREATE POSTGRES USER / DATABASE
# ============================================================

$script:psqlPath = $psql.FullName

if ($postgresPassword) {
  $env:PGPASSWORD = $postgresPassword
}
else {
  Enable-LocalPostgresSetupAccess
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}


try {

  Invoke-Psql `
    "DO `$`$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bigbites_app') THEN CREATE ROLE bigbites_app LOGIN PASSWORD '$appPassword'; ELSE ALTER ROLE bigbites_app WITH LOGIN PASSWORD '$appPassword'; END IF; END `$`$;"


  $databaseExists = (
    & $psqlPath `
      -w `
      -h 127.0.0.1 `
      -p 5432 `
      -U postgres `
      -d postgres `
      -tAc "SELECT 1 FROM pg_database WHERE datname = 'bigbites'" `
      2>&1
  ) |
    Out-String


  if ($LASTEXITCODE -ne 0) {
    throw "Could not check whether the BIG BITES database exists."
  }


  if ($databaseExists.Trim() -ne "1") {

    Invoke-Psql `
      "CREATE DATABASE bigbites OWNER bigbites_app"
  }

}
finally {

  Restore-PostgresAuthentication
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}


# ============================================================
# PRISMA MIGRATIONS
# ============================================================

$env:DATABASE_URL = $databaseUrl
$env:AUTH_SECRET = $authSecret
$env:NODE_ENV = "production"


Push-Location $serverDir

try {

  & $nodePath `
    (Join-Path $serverDir "node_modules\prisma\build\index.js") `
    migrate deploy


  if ($LASTEXITCODE -ne 0) {

    throw `
      "Database migrations failed. The existing schema was not altered beyond the project's checked-in migrations."
  }

}
finally {

  Pop-Location

  Remove-Item `
    Env:DATABASE_URL,
    Env:AUTH_SECRET,
    Env:NODE_ENV `
    -ErrorAction SilentlyContinue
}


# ============================================================
# DATABASE SEED
# ============================================================

$env:DATABASE_URL = $databaseUrl

$env:SEED_ADMIN_PASSWORD = "admin123"
$env:SEED_CASHIER_PASSWORD = "cashier123"
$env:SEED_WAITER_PASSWORD = "waiter123"

$seededAccounts = @(
  @{
    username = "admin"
    password = $env:SEED_ADMIN_PASSWORD
    role = "ADMIN"
  },
  @{
    username = "cashier"
    password = $env:SEED_CASHIER_PASSWORD
    role = "CASHIER"
  },
  @{
    username = "waiter"
    password = $env:SEED_WAITER_PASSWORD
    role = "WAITER"
  }
)


Push-Location $serverDir

try {

  & `
    (Join-Path $serverDir "node_modules\.bin\tsx.cmd") `
    "prisma\seed\seed.ts"


  if ($LASTEXITCODE -ne 0) {

    throw `
      "Initial database setup failed while creating the standard tables, products, and user accounts."
  }

}
finally {

  Pop-Location

  Remove-Item `
    Env:DATABASE_URL,
    Env:SEED_ADMIN_PASSWORD,
    Env:SEED_CASHIER_PASSWORD,
    Env:SEED_WAITER_PASSWORD `
    -ErrorAction SilentlyContinue
}


# ============================================================
# WINDOWS FIREWALL
# ============================================================

foreach (
  $rule in @(
    "BIG BITES POS API TCP 3000",
    "BIG BITES POS Discovery UDP 3001"
  )
) {

  Get-NetFirewallRule `
    -DisplayName $rule `
    -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule
}


New-NetFirewallRule `
  -DisplayName "BIG BITES POS API TCP 3000" `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 3000 `
  -Profile Any `
  -RemoteAddress LocalSubnet |
  Out-Null


New-NetFirewallRule `
  -DisplayName "BIG BITES POS Discovery UDP 3001" `
  -Direction Inbound `
  -Action Allow `
  -Protocol UDP `
  -LocalPort 3001 `
  -Profile Any `
  -RemoteAddress LocalSubnet |
  Out-Null


# ============================================================
# COPY SERVER STARTUP SCRIPT
# ============================================================

$startScript = `
  Join-Path $serverDir "Start-BigBitesServer.ps1"

$startSource = `
  Join-Path $PSScriptRoot "Start-BigBitesServer.ps1"


if (Test-Path $startSource) {

  Copy-Item `
    $startSource `
    $startScript `
    -Force

}
else {

  throw "The packaged server startup script was not found."
}


# ============================================================
# CREATE WINDOWS STARTUP TASK
# ============================================================

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`"" `
  -WorkingDirectory $serverDir


$trigger = New-ScheduledTaskTrigger `
  -AtStartup


$principal = New-ScheduledTaskPrincipal `
  -UserId "SYSTEM" `
  -LogonType ServiceAccount `
  -RunLevel Highest


$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)


Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Force |
  Out-Null


# ============================================================
# START SERVER IN BACKGROUND VIA SCHEDULED TASK
# ============================================================

Write-Host "Starting BIG BITES POS server in the background..."

Start-ScheduledTask -TaskName $taskName -ErrorAction Stop

# ============================================================
# HEALTH CHECK
# ============================================================

$deadline = (Get-Date).AddSeconds(45)

$healthy = $false


do {

  Start-Sleep -Seconds 2

  try {

    $health = `
      Invoke-RestMethod `
        -Uri "http://127.0.0.1:3000/health" `
        -TimeoutSec 3


    $healthy = `
      $health.status -eq "OK" -and
      $health.database -eq "Connected"

  }
  catch {

    $healthy = $false
  }

}
until (
  $healthy -or
  (Get-Date) -gt $deadline
)


if (-not $healthy) {

  throw `
    "The server did not become healthy. Check $serverLogs for startup errors."
}

foreach ($account in $seededAccounts) {
  try {
    $login = Invoke-RestMethod `
      -Method Post `
      -Uri "http://127.0.0.1:3000/api/auth/login" `
      -ContentType "application/json" `
      -Body (@{
        username = $account.username
        password = $account.password
      } | ConvertTo-Json -Compress) `
      -TimeoutSec 5

    if (-not $login.token -or $login.user.role -ne $account.role) {
      throw "Unexpected login response."
    }
  }
  catch {
    throw "The seeded $($account.role) account failed its authentication check."
  }
}


# ============================================================
# LAN DISCOVERY TEST
# ============================================================

$udp = New-Object System.Net.Sockets.UdpClient

try {

  $udp.EnableBroadcast = $true

  $udp.Client.ReceiveTimeout = 6000


  $discoveryRequest = `
    [Text.Encoding]::UTF8.GetBytes(
      "BIGBITES_POS_DISCOVERY_V1"
    )


  [void]$udp.Send(
    $discoveryRequest,
    $discoveryRequest.Length,
    [System.Net.IPAddress]::Broadcast,
    3001
  )


  $remote = `
    New-Object System.Net.IPEndPoint(
      [System.Net.IPAddress]::Any,
      0
    )


  $discovery = `
    [Text.Encoding]::UTF8.GetString(
      $udp.Receive([ref]$remote)
    ) |
    ConvertFrom-Json


  if (
    $discovery.service -ne "big-bites-pos" -or
    $discovery.port -ne 3000 -or
    $discovery.host -notmatch '^\d{1,3}(\.\d{1,3}){3}$'
  ) {

    throw `
      "The POS server returned an invalid LAN discovery response."
  }


  $lanHealth = `
    Invoke-RestMethod `
      -Uri "http://$($discovery.host):3000/health" `
      -TimeoutSec 5


  if (
    $lanHealth.status -ne "OK" -or
    $lanHealth.database -ne "Connected"
  ) {

    throw `
      "The POS server was discovered, but the LAN API health check failed."
  }

}
catch {

  throw `
    "The local server is healthy, but LAN discovery/API validation failed: $($_.Exception.Message)"
}
finally {

  $udp.Dispose()
}


}
else {
  Write-Host "Skipping local BIG BITES POS server setup because no bundled server resources were found."
}

# ============================================================
# CREATE DESKTOP SHORTCUT
# ============================================================

$shortcutPath = `
  Join-Path `
    ([Environment]::GetFolderPath("CommonDesktopDirectory")) `
    "BIG BITES POS.lnk"


$shortcut = `
  (New-Object -ComObject WScript.Shell).
  CreateShortcut($shortcutPath)


$shortcut.TargetPath = `
  Join-Path $InstallDir "desktop.exe"


$shortcut.WorkingDirectory = `
  $InstallDir


$shortcut.Save()


# ============================================================
# SUCCESS
# ============================================================

Stop-Transcript | Out-Null
exit 0