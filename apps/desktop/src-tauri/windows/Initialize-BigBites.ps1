param()

$ErrorActionPreference = "Stop"

if (-not [Environment]::UserInteractive) {
  throw "Run this setup from an interactive Windows session."
}

$serverDir = Join-Path $env:ProgramData "BIG BITES POS\server"
$envFile = Join-Path $serverDir ".env"
$nodePath = Join-Path `
  (Join-Path $serverDir "runtime") `
  "node-3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237\node.exe"
$tsxPath = Join-Path $serverDir "node_modules\.bin\tsx.cmd"
$seedPath = Join-Path $serverDir "prisma\seed\seed.ts"
$menuImportReportPath = Join-Path `
  $serverDir `
  ("menu-import-report-{0}.json" -f [Guid]::NewGuid().ToString("N"))

foreach ($requiredPath in @($envFile, $nodePath, $tsxPath, $seedPath)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Required setup resource was not found: $requiredPath"
  }
}

$databaseLine = Get-Content -LiteralPath $envFile |
  Where-Object { $_ -match '^DATABASE_URL=' } |
  Select-Object -First 1
if (-not $databaseLine) {
  throw "The local database configuration was not found."
}

$databaseUrl = ($databaseLine -split '=', 2)[1].Trim().Trim('"').Trim("'")
try {
  $databaseUri = [uri]$databaseUrl
  $userInfo = $databaseUri.UserInfo -split ':', 2
  $databaseRole = [uri]::UnescapeDataString($userInfo[0])
  $databaseName = [uri]::UnescapeDataString($databaseUri.AbsolutePath.TrimStart('/'))
  $schemaParameters = @(
    [regex]::Matches($databaseUri.Query.TrimStart('?'), '(?:^|&)schema=([^&]*)') |
      ForEach-Object { [uri]::UnescapeDataString($_.Groups[1].Value) }
  )
}
catch {
  throw "The configured database URL is invalid."
}
if (
  $databaseUri.Scheme -ne "postgresql" -or
  $databaseUri.Host -notin @("localhost", "127.0.0.1", "::1") -or
  $databaseUri.Port -ne 5432 -or
  $userInfo.Count -ne 2 -or
  [string]::IsNullOrEmpty($userInfo[1]) -or
  $databaseRole -ne "bigbites_client_delivery_app" -or
  $databaseName -ne "bigbites_client_local_delivery_20261027" -or
  $databaseUri.Query -cne "?schema=public" -or
  $schemaParameters.Count -ne 1 -or
  $schemaParameters[0] -ne "public"
) {
  throw "Initialization requires the exact local bigbites_client_local_delivery_20261027 database, bigbites_client_delivery_app role, port 5432, and public schema. The configured database was not contacted."
}

$confirmation = Read-Host `
  "This creates accounts and initial menu data only in an empty local database. Type INITIALIZE EMPTY POS to continue"
if ($confirmation -cne "INITIALIZE EMPTY POS") {
  Write-Host "Initialization cancelled; no database changes were made."
  exit 0
}

$menuConfirmation = Read-Host `
  "Initial menu creation is separate and create-only. Type ADD INITIAL MENU to confirm"
if ($menuConfirmation -cne "ADD INITIAL MENU") {
  Write-Host "Initialization cancelled; no database changes were made."
  exit 0
}

function Read-Account([string]$Role) {
  $name = Read-Host "$Role account display name"
  $username = Read-Host "$Role account username"
  $securePassword = Read-Host "$Role account password (minimum 12 characters)" -AsSecureString

  $passwordPointer = [IntPtr]::Zero
  try {
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR(
      $securePassword
    )
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
      $passwordPointer
    )
  }
  finally {
    if ($passwordPointer -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    $securePassword.Dispose()
  }

  return @{
    name = $name
    username = $username
    password = $password
    role = $Role
  }
}

$accounts = @(
  (Read-Account "ADMIN"),
  (Read-Account "CASHIER"),
  (Read-Account "WAITER")
)

$payloadJson = $null
$payloadBase64 = $null
$exitCode = 1
$previousDatabaseUrl = $env:DATABASE_URL
$previousBootstrapFlag = $env:BIGBITES_INSTALL_BOOTSTRAP
$previousMenuImportReportPath = $env:BIGBITES_MENU_IMPORT_REPORT

try {
  $payloadJson = @{
    confirmInitialMenu = $true
    accounts = $accounts
  } | ConvertTo-Json -Depth 5 -Compress
  $payloadBase64 = [Convert]::ToBase64String(
    [Text.Encoding]::UTF8.GetBytes($payloadJson)
  )

  $env:DATABASE_URL = $databaseUrl
  $env:BIGBITES_INSTALL_BOOTSTRAP = "CREATE_EMPTY_DATABASE"
  $env:BIGBITES_MENU_IMPORT_REPORT = $menuImportReportPath
  Push-Location $serverDir
  try {
    $payloadBase64 | & $tsxPath $seedPath
    $exitCode = $LASTEXITCODE
  }
  finally {
    Pop-Location
  }
}
finally {
  $env:DATABASE_URL = $previousDatabaseUrl
  $env:BIGBITES_INSTALL_BOOTSTRAP = $previousBootstrapFlag
  $env:BIGBITES_MENU_IMPORT_REPORT = $previousMenuImportReportPath
  Remove-Variable payloadJson, payloadBase64 -ErrorAction SilentlyContinue
  Remove-Variable accounts -ErrorAction SilentlyContinue
  Remove-Variable password -ErrorAction SilentlyContinue
}

if ($exitCode -ne 0) {
  throw "Initialization failed or the database was not empty. No passwords were written to the setup log."
}

Write-Host "Initial accounts and menu were created. Passwords were not displayed or logged."
Write-Host "Menu import report saved to $menuImportReportPath."
