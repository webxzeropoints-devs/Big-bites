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
$script:postgresServiceName = "bigbites-pos-postgresql-x64-17"
$script:postgresAuthTemporarilyTrusted = $false
$script:serverStopped = $false
$script:activationAttempted = $false
$script:previousServerRestartSafe = $false
$script:previousPayloadId = $null
$script:activePayloadId = $null
$script:candidatePayloadPath = $null
$script:previousPgConnectTimeout = $env:PGCONNECT_TIMEOUT
$script:previousPgOptions = $env:PGOPTIONS
$script:localPgTimeoutsConfigured = $false
$script:repairLocalDatabaseUrlOnRetry = $false

function Set-LocalPostgresOperationTimeouts {
  if ($script:localPgTimeoutsConfigured) {
    return
  }
  $env:PGCONNECT_TIMEOUT = "15"
  $env:PGOPTIONS = "-c statement_timeout=300000 -c lock_timeout=30000"
  $script:localPgTimeoutsConfigured = $true
  Write-Host "Local PostgreSQL commands have bounded connection, statement, and lock waits."
}

function Restore-LocalPostgresOperationTimeouts {
  if (-not $script:localPgTimeoutsConfigured) {
    return
  }
  if ($null -eq $script:previousPgConnectTimeout) {
    Remove-Item Env:PGCONNECT_TIMEOUT -ErrorAction SilentlyContinue
  }
  else {
    $env:PGCONNECT_TIMEOUT = $script:previousPgConnectTimeout
  }
  if ($null -eq $script:previousPgOptions) {
    Remove-Item Env:PGOPTIONS -ErrorAction SilentlyContinue
  }
  else {
    $env:PGOPTIONS = $script:previousPgOptions
  }
  $script:localPgTimeoutsConfigured = $false
}

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
  Restore-LocalPostgresOperationTimeouts
  try {
    Restore-PreviousServerAfterFailure
  }
  catch {
    [Console]::Error.WriteLine(
      "Previous server recovery failed: $($_.Exception.Message)"
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
$databaseName = "bigbites_client_local"
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
$installStatePath = Join-Path $dataRoot "installation-state.json"
$existingEnvironment = @{}
$hasExistingEnvironment = $false
$installState = $null
$isResumingInstall = $false

if (Test-Path -LiteralPath $installStatePath -PathType Leaf) {
  try {
    $savedInstallState = Get-Content -LiteralPath $installStatePath -Raw |
      ConvertFrom-Json -ErrorAction Stop
    if (
      $savedInstallState.version -ne 1 -or
      $savedInstallState.attemptId -notmatch '^[a-f0-9]{32}$' -or
      $savedInstallState.status -notin @("in-progress", "completed")
    ) {
      throw "The saved installation state is not recognized."
    }
    $installState = @{
      version = 1
      attemptId = [string]$savedInstallState.attemptId
      status = [string]$savedInstallState.status
      roleCreationStarted = [bool]$savedInstallState.roleCreationStarted
      roleCreatedByAttempt = [bool]$savedInstallState.roleCreatedByAttempt
      databaseCreationStarted = [bool]$savedInstallState.databaseCreationStarted
      databaseCreatedByAttempt = [bool]$savedInstallState.databaseCreatedByAttempt
    }
    $isResumingInstall = $installState.status -eq "in-progress"
  }
  catch {
    throw "The saved installation state could not be read safely. Preserve it and follow the local recovery instructions before retrying."
  }
}

try {
  $environmentLines = [System.IO.File]::ReadAllLines($envFile)
  $hasExistingEnvironment = $true
}
catch [System.IO.FileNotFoundException] {
  $environmentLines = @()
}
catch [System.IO.DirectoryNotFoundException] {
  $environmentLines = @()
}
catch {
  throw "The existing local server configuration could not be read. Setup stopped before changing the installation."
}

foreach ($line in $environmentLines) {
  if ($line -match '^\s*([^#=\s]+)\s*=\s*(.*)$') {
    $existingEnvironment[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
  }
}

if (
  $installState -and
  -not $hasExistingEnvironment -and
  (
    $installState.status -eq "completed" -or
    $installState.roleCreationStarted -or
    $installState.roleCreatedByAttempt -or
    $installState.databaseCreationStarted -or
    $installState.databaseCreatedByAttempt
  )
) {
  throw "A previous setup attempt created a database resource but its protected local configuration is missing. No role or database was changed. Restore the installation configuration or contact support before retrying."
}

if ($hasExistingEnvironment) {
  if (
    [string]::IsNullOrWhiteSpace($existingEnvironment["DATABASE_URL"]) -or
    [string]::IsNullOrWhiteSpace($existingEnvironment["AUTH_SECRET"])
  ) {
    throw "The existing local server configuration is incomplete. Setup stopped before changing the installation."
  }

  try {
    $existingDatabaseUri = [uri]$existingEnvironment["DATABASE_URL"]
    $existingDatabaseUserInfo = $existingDatabaseUri.UserInfo -split ':', 2
    $existingDatabaseName = [uri]::UnescapeDataString(
      $existingDatabaseUri.AbsolutePath.TrimStart('/')
    )
    $existingDatabaseRole = [uri]::UnescapeDataString(
      $existingDatabaseUserInfo[0]
    )
    $existingDatabasePassword = if ($existingDatabaseUserInfo.Count -eq 2) {
      [uri]::UnescapeDataString($existingDatabaseUserInfo[1])
    }
    else {
      ""
    }
  }
  catch {
    throw "The existing database configuration is invalid. Setup stopped before changing the installation."
  }

  if (
    $existingDatabaseUri.Scheme -ne "postgresql" -or
    $existingDatabaseUri.Host -ne "127.0.0.1" -or
    $existingDatabaseUri.Port -ne 5432 -or
    $existingDatabaseRole -ne "bigbites_app" -or
    [string]::IsNullOrEmpty($existingDatabasePassword)
  ) {
    throw "The existing installation does not point to 127.0.0.1:5432/$databaseName. Setup stopped before changing the installation."
  }
  if (
    $existingDatabaseName -ne $databaseName -or
    $existingDatabaseUri.Query -cne "?schema=public"
  ) {
    $isKnownPowerShellInterpolationFailure = (
      $isResumingInstall -and
      $installState.roleCreatedByAttempt -and
      $installState.databaseCreatedByAttempt -and
      $existingDatabaseName -ceq "=public" -and
      [string]::IsNullOrEmpty($existingDatabaseUri.Query)
    )
    if (-not $isKnownPowerShellInterpolationFailure) {
      throw "The existing installation does not point to 127.0.0.1:5432/$databaseName. Setup stopped before changing the installation."
    }
    $script:repairLocalDatabaseUrlOnRetry = $true
    Write-Host "A previous installer attempt contains the recognized malformed local database URL. Setup will repair it only after verifying this attempt's database and role ownership."
  }
}


# ============================================================
# FUNCTIONS
# ============================================================

function Initialize-BigBitesPathSafety {
  if ("BigBitesPathSafety" -as [type]) {
    return
  }

  Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class BigBitesPathSafety
{
    private const uint FileReadAttributes = 0x80;
    private const uint ShareAll = 0x7;
    private const uint OpenExisting = 3;
    private const uint BackupSemantics = 0x02000000;

    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime
    {
        public uint Low;
        public uint High;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ByHandleFileInformation
    {
        public uint Attributes;
        public FileTime CreationTime;
        public FileTime LastAccessTime;
        public FileTime LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(
        string name, uint access, uint share, IntPtr security,
        uint creation, uint flags, IntPtr template);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(
        SafeFileHandle handle, StringBuilder path, uint length, uint flags);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(
        SafeFileHandle handle, out ByHandleFileInformation information);

    public static string InspectDirectory(string path)
    {
        using (SafeFileHandle handle = CreateFile(
            path, FileReadAttributes, ShareAll, IntPtr.Zero,
            OpenExisting, BackupSemantics, IntPtr.Zero))
        {
            if (handle.IsInvalid)
                throw new Win32Exception(Marshal.GetLastWin32Error());

            StringBuilder finalPath = new StringBuilder(32768);
            uint length = GetFinalPathNameByHandle(
                handle, finalPath, (uint)finalPath.Capacity, 0);
            if (length == 0 || length >= finalPath.Capacity)
                throw new Win32Exception(Marshal.GetLastWin32Error());

            ByHandleFileInformation information;
            if (!GetFileInformationByHandle(handle, out information))
                throw new Win32Exception(Marshal.GetLastWin32Error());

            string resolvedPath = finalPath.ToString();
            if (resolvedPath.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase))
                resolvedPath = @"\\" + resolvedPath.Substring(8);
            else if (resolvedPath.StartsWith(@"\\?\", StringComparison.OrdinalIgnoreCase))
                resolvedPath = resolvedPath.Substring(4);

            return String.Join("|", resolvedPath,
                information.VolumeSerialNumber.ToString("X8"),
                information.FileIndexHigh.ToString("X8"),
                information.FileIndexLow.ToString("X8"));
        }
    }
}
"@ -ErrorAction Stop | Out-Null
}

function Assert-NoBigBitesReparsePoints {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
  $currentPath = $pathRoot
  $remainingPath = $fullPath.Substring($pathRoot.Length)

  foreach ($segment in ($remainingPath -split '[\\/]' | Where-Object { $_ })) {
    $parentPath = $currentPath
    $currentPath = Join-Path $parentPath $segment
    $entryName = [System.IO.Path]::GetFileName($currentPath)
    $entryPaths = [System.IO.Directory]::GetFileSystemEntries($parentPath)
    $entryPath = $entryPaths |
      Where-Object {
        [System.IO.Path]::GetFileName($_).Equals(
          $entryName,
          [System.StringComparison]::OrdinalIgnoreCase
        )
      } |
      Select-Object -First 1

    if (-not $entryPath) {
      break
    }

    try {
      $attributes = [System.IO.File]::GetAttributes($entryPath)
    }
    catch {
      throw "A filesystem entry in the staging path could not be inspected."
    }

    if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "A reparse point was found in the staging path."
    }
  }
}

function Get-BigBitesTrustedSids {
  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  if (-not $currentSid) {
    throw "The current Windows identity could not be determined."
  }

  return @(
    "S-1-5-18",
    "S-1-5-32-544",
    $currentSid.Value
  ) | Select-Object -Unique
}

function Assert-BigBitesRestrictedAcl {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [switch]$RequireProtected
  )

  $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
  if ($RequireProtected -and -not $acl.AreAccessRulesProtected) {
    throw "The server root ACL inherits permissions and is not protected."
  }

  $trustedSids = @(Get-BigBitesTrustedSids)
  try {
    $ownerSid = $acl.GetOwner(
      [System.Security.Principal.SecurityIdentifier]
    ).Value
  }
  catch {
    throw "The owner SID for the protected staging path could not be determined."
  }

  if ($trustedSids -notcontains $ownerSid) {
    throw "The protected staging path has an untrusted owner SID: $ownerSid."
  }

  $mutableRights = [System.Security.AccessControl.FileSystemRights](
    [System.Security.AccessControl.FileSystemRights]::WriteData -bor
    [System.Security.AccessControl.FileSystemRights]::AppendData -bor
    [System.Security.AccessControl.FileSystemRights]::CreateFiles -bor
    [System.Security.AccessControl.FileSystemRights]::CreateDirectories -bor
    [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
    [System.Security.AccessControl.FileSystemRights]::Delete -bor
    [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor
    [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
    [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
    [System.Security.AccessControl.FileSystemRights]::TakeOwnership
  )
  $rules = $acl.GetAccessRules(
    $true,
    $true,
    [System.Security.Principal.SecurityIdentifier]
  )

  foreach ($rule in $rules) {
    if (
      $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
      $trustedSids -notcontains $rule.IdentityReference.Value -and
      ($rule.FileSystemRights -band $mutableRights) -ne 0
    ) {
      throw "An untrusted principal can modify the protected staging path."
    }
  }

  if ($RequireProtected) {
    foreach ($sid in @("S-1-5-18", "S-1-5-32-544")) {
      $hasFullControl = @(
        $rules | Where-Object {
          $_.IdentityReference.Value -eq $sid -and
          $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
          ($_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq
            [System.Security.AccessControl.FileSystemRights]::FullControl
        }
      ).Count -gt 0

      if (-not $hasFullControl) {
        throw "The protected staging path is missing a required system administrator access rule."
      }
    }
  }
}

function Set-BigBitesStagingRootAcl {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  Assert-BigBitesRestrictedAcl -Path $Path
  $security = New-Object System.Security.AccessControl.DirectorySecurity
  $security.SetAccessRuleProtection($true, $false)
  $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
    [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  foreach ($sidValue in (Get-BigBitesTrustedSids)) {
    $sid = New-Object System.Security.Principal.SecurityIdentifier($sidValue)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
      $sid,
      [System.Security.AccessControl.FileSystemRights]::FullControl,
      $inheritance,
      [System.Security.AccessControl.PropagationFlags]::None,
      [System.Security.AccessControl.AccessControlType]::Allow
    )
    $security.AddAccessRule($rule)
  }

  Set-Acl -LiteralPath $Path -AclObject $security -ErrorAction Stop
  Assert-BigBitesRestrictedAcl -Path $Path -RequireProtected
}

function Get-BigBitesDirectoryIdentity {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $identity = [BigBitesPathSafety]::InspectDirectory($Path)
  $parts = $identity.Split('|')
  if ($parts.Count -ne 4) {
    throw "The physical staging directory could not be identified."
  }

  return @{
    PhysicalPath = $parts[0].TrimEnd(
      [System.IO.Path]::DirectorySeparatorChar,
      [System.IO.Path]::AltDirectorySeparatorChar
    )
    FileIdentity = "$($parts[1])|$($parts[2])|$($parts[3])"
  }
}

function Assert-BigBitesPhysicalChild {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ParentPath,

    [Parameter(Mandatory = $true)]
    [string]$ChildPath
  )

  Assert-NoBigBitesReparsePoints -Path $ParentPath
  Assert-NoBigBitesReparsePoints -Path $ChildPath
  $parentIdentity = Get-BigBitesDirectoryIdentity -Path $ParentPath
  $childIdentity = Get-BigBitesDirectoryIdentity -Path $ChildPath
  $parentPrefix = $parentIdentity.PhysicalPath +
    [System.IO.Path]::DirectorySeparatorChar
  if (
    -not $childIdentity.PhysicalPath.StartsWith(
      $parentPrefix,
      [System.StringComparison]::OrdinalIgnoreCase
    )
  ) {
    throw "The staging directory does not resolve beneath its expected parent."
  }

  return @{
    Parent = $parentIdentity
    Child = $childIdentity
  }
}

function Assert-NoBigBitesReparsePointsInTree {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RootPath
  )

  foreach (
    $item in Get-ChildItem `
      -LiteralPath $RootPath `
      -Force `
      -Recurse `
      -ErrorAction Stop
  ) {
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "A reparse point was found in the staged server payload."
    }
  }
}

function Stage-ServerPayload {
  param(
    [Parameter(Mandatory = $true)]
    [string]$SourcePath,

    [Parameter(Mandatory = $true)]
    [string]$ServerRoot
  )

  $stagingRoot = Join-Path $ServerRoot ".staging"
  $createdStagingPath = $null
  $resolvedStagingRoot = [System.IO.Path]::GetFullPath($stagingRoot).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )

  if (-not (Test-Path -LiteralPath $SourcePath -PathType Container)) {
    throw "The packaged server source directory was not found."
  }

  Initialize-BigBitesPathSafety
  Assert-NoBigBitesReparsePoints -Path $ServerRoot
  Assert-BigBitesRestrictedAcl -Path $ServerRoot -RequireProtected
  Assert-NoBigBitesReparsePoints -Path $stagingRoot
  if (-not (Test-Path -LiteralPath $resolvedStagingRoot -PathType Container)) {
    New-Item -ItemType Directory -Path $resolvedStagingRoot | Out-Null
  }
  Assert-NoBigBitesReparsePoints -Path $ServerRoot
  Assert-NoBigBitesReparsePoints -Path $resolvedStagingRoot
  Set-BigBitesStagingRootAcl -Path $resolvedStagingRoot
  $serverRootIdentity = Get-BigBitesDirectoryIdentity -Path $ServerRoot
  $stagingRootIdentity = Get-BigBitesDirectoryIdentity -Path $resolvedStagingRoot

  $stagingPath = Join-Path $resolvedStagingRoot ([guid]::NewGuid().ToString("N"))
  $resolvedStagingPath = [System.IO.Path]::GetFullPath($stagingPath)
  $stagingRootPrefix = $resolvedStagingRoot +
    [System.IO.Path]::DirectorySeparatorChar

  if (
    $resolvedStagingPath.Equals(
      $resolvedStagingRoot,
      [System.StringComparison]::OrdinalIgnoreCase
    ) -or
    -not $resolvedStagingPath.StartsWith(
      $stagingRootPrefix,
      [System.StringComparison]::OrdinalIgnoreCase
    )
  ) {
    throw "The generated staging directory is outside the expected staging root."
  }

  try {
    New-Item -ItemType Directory -Path $resolvedStagingPath | Out-Null
    $createdStagingPath = $resolvedStagingPath
    $initialPathIdentity = Assert-BigBitesPhysicalChild `
      -ParentPath $resolvedStagingRoot `
      -ChildPath $resolvedStagingPath
    if (
      $initialPathIdentity.Parent.FileIdentity -ne $stagingRootIdentity.FileIdentity -or
      -not $initialPathIdentity.Child.PhysicalPath.Equals(
        $stagingRootIdentity.PhysicalPath +
        [System.IO.Path]::DirectorySeparatorChar +
        (Split-Path -Leaf $resolvedStagingPath),
        [System.StringComparison]::OrdinalIgnoreCase
      )
    ) {
      throw "The created staging directory did not resolve to its expected physical location."
    }
    $createdDirectoryIdentity = $initialPathIdentity.Child.FileIdentity

    foreach ($directory in @("dist", "node_modules", "prisma")) {
      Copy-Item `
        -LiteralPath (Join-Path $SourcePath $directory) `
        -Destination (Join-Path $resolvedStagingPath $directory) `
        -Recurse `
        -Force `
        -ErrorAction Stop
    }

    foreach ($file in @("package.json", "prisma.config.ts")) {
      Copy-Item `
        -LiteralPath (Join-Path $SourcePath $file) `
        -Destination (Join-Path $resolvedStagingPath $file) `
        -Force `
        -ErrorAction Stop
    }

    $passwordUtilityDirectory = Join-Path $resolvedStagingPath "src\utils"
    New-Item -ItemType Directory -Force -Path $passwordUtilityDirectory |
      Out-Null
    Copy-Item `
      -LiteralPath (Join-Path $SourcePath "src\utils\password.ts") `
      -Destination (Join-Path $passwordUtilityDirectory "password.ts") `
      -Force `
      -ErrorAction Stop

    $requiredStagedFiles = @(
      "dist\server.js",
      "package.json",
      "prisma.config.ts",
      "prisma\schema.prisma",
      "prisma\migrations\migration_lock.toml",
      "prisma\migrations\20260914084442_initial_hotel_pos\migration.sql",
      "prisma\migrations\20260922200000_remove_kitchen_role\migration.sql",
      "prisma\migrations\20260922210000_add_parcel_table\migration.sql",
      "prisma\migrations\20260928233000_ready_for_billing\migration.sql",
      "prisma\migrations\20260928234000_pending_order_payments\migration.sql",
      "prisma\migrations\20260929210000_add_gst_settings\migration.sql",
      "prisma\migrations\20260929220000_add_restaurant_address\migration.sql",
      "prisma\migrations\20261003120000_add_fssai_gstin_settings\migration.sql",
      "prisma\migrations\20261003123000_add_order_discounts\migration.sql",
      "prisma\migrations\20261003130000_remove_manager_role\migration.sql",
      "prisma\migrations\20261006150000_payment_tender_details\migration.sql",
      "prisma\migrations\20261006220000_add_gst_toggle_and_order_reports\migration.sql",
      "prisma\migrations\20261009230000_menu_variants_classification\migration.sql",
      "prisma\migrations\20261013010000_cash_upi_split_payment\migration.sql",
      "prisma\migrations\20261013213000_add_product_stock_movements\migration.sql",
      "node_modules\@prisma\client\package.json",
      "node_modules\.prisma\client\index.js",
      "node_modules\prisma\build\index.js",
      "src\utils\password.ts"
    )

    foreach ($file in $requiredStagedFiles) {
      if (-not (Test-Path -LiteralPath (Join-Path $resolvedStagingPath $file) -PathType Leaf)) {
        throw "A required staged server file is missing: $file."
      }
    }

    foreach ($directory in @("node_modules\@prisma\engines")) {
      if (-not (Test-Path -LiteralPath (Join-Path $resolvedStagingPath $directory) -PathType Container)) {
        throw "A required staged server directory is missing: $directory."
      }
    }
    Assert-NoBigBitesReparsePointsInTree -RootPath $resolvedStagingPath

    $packageMetadata = Get-Content `
      -LiteralPath (Join-Path $resolvedStagingPath "package.json") `
      -Raw |
      ConvertFrom-Json -ErrorAction Stop
    if (
      $packageMetadata.name -ne "server" -or
      [string]::IsNullOrWhiteSpace([string]$packageMetadata.version) -or
      $packageMetadata.type -ne "commonjs" -or
      -not $packageMetadata.dependencies."@prisma/client" -or
      -not $packageMetadata.dependencies.prisma
    ) {
      throw "The staged server package metadata is invalid."
    }

    Assert-NoBigBitesReparsePoints -Path $ServerRoot
    Assert-NoBigBitesReparsePoints -Path $resolvedStagingRoot
    Assert-NoBigBitesReparsePointsInTree -RootPath $resolvedStagingPath
    $currentServerIdentity = Get-BigBitesDirectoryIdentity -Path $ServerRoot
    $currentStagingIdentity = Get-BigBitesDirectoryIdentity -Path $resolvedStagingRoot
    $currentPathIdentity = Assert-BigBitesPhysicalChild `
      -ParentPath $resolvedStagingRoot `
      -ChildPath $resolvedStagingPath
    if (
      $currentServerIdentity.FileIdentity -ne $serverRootIdentity.FileIdentity -or
      $currentStagingIdentity.FileIdentity -ne $stagingRootIdentity.FileIdentity -or
      $currentPathIdentity.Child.FileIdentity -ne $createdDirectoryIdentity -or
      -not $currentPathIdentity.Child.PhysicalPath.Equals(
        $initialPathIdentity.Child.PhysicalPath,
        [System.StringComparison]::OrdinalIgnoreCase
      )
    ) {
      throw "The staging path changed during payload validation."
    }

    return $resolvedStagingPath
  }
  catch {
    $stagingFailure = $_
    if ($createdStagingPath) {
      try {
        $resolvedCreatedPath = [System.IO.Path]::GetFullPath($createdStagingPath)
        if (
          $resolvedCreatedPath -ne $resolvedStagingPath -or
          -not $resolvedCreatedPath.StartsWith(
            $stagingRootPrefix,
            [System.StringComparison]::OrdinalIgnoreCase
          )
        ) {
          throw "The staging path no longer matches the operation's created directory."
        }

        Assert-NoBigBitesReparsePoints -Path $ServerRoot
        Assert-NoBigBitesReparsePoints -Path $resolvedStagingRoot
        $currentServerIdentity = Get-BigBitesDirectoryIdentity -Path $ServerRoot
        $currentStagingIdentity = Get-BigBitesDirectoryIdentity -Path $resolvedStagingRoot
        Assert-BigBitesRestrictedAcl -Path $ServerRoot -RequireProtected
        Assert-BigBitesRestrictedAcl -Path $resolvedStagingRoot -RequireProtected
        Assert-BigBitesRestrictedAcl -Path $resolvedCreatedPath
        $currentPathIdentity = Assert-BigBitesPhysicalChild `
          -ParentPath $resolvedStagingRoot `
          -ChildPath $resolvedCreatedPath
        Assert-NoBigBitesReparsePointsInTree -RootPath $resolvedCreatedPath
        if (
          $currentServerIdentity.FileIdentity -ne $serverRootIdentity.FileIdentity -or
          $currentStagingIdentity.FileIdentity -ne $stagingRootIdentity.FileIdentity -or
          $currentPathIdentity.Parent.FileIdentity -ne $stagingRootIdentity.FileIdentity -or
          $currentPathIdentity.Child.FileIdentity -ne $createdDirectoryIdentity -or
          -not $currentPathIdentity.Child.PhysicalPath.Equals(
            $initialPathIdentity.Child.PhysicalPath,
            [System.StringComparison]::OrdinalIgnoreCase
          )
        ) {
          throw "The staging path changed during the operation."
        }

        Remove-Item `
          -LiteralPath $resolvedCreatedPath `
          -Recurse `
          -Force `
          -ErrorAction Stop
      }
      catch {
        throw "Staging failed; the staging directory was left for manual investigation at '$createdStagingPath'. Cleanup was refused or failed: $($_.Exception.Message)"
      }
    }
    throw $stagingFailure
  }
}

function Save-InstallState {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$State,

    [Parameter(Mandatory = $true)]
    [string]$StatePath
  )

  $temporaryPath = "$StatePath.$([guid]::NewGuid().ToString('N')).tmp"
  $json = $State | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText(
    $temporaryPath,
    $json,
    (New-Object System.Text.UTF8Encoding($false))
  )
  try {
    if (Test-Path -LiteralPath $StatePath -PathType Leaf) {
      $backupPath = "$StatePath.$([guid]::NewGuid().ToString('N')).bak"
      [System.IO.File]::Replace($temporaryPath, $StatePath, $backupPath)
      if (Test-Path -LiteralPath $backupPath -PathType Leaf) {
        Remove-Item -LiteralPath $backupPath -Force -ErrorAction Stop
      }
    }
    else {
      [System.IO.File]::Move($temporaryPath, $StatePath)
    }
  }
  finally {
    if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
      Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    }
  }
}

function Get-ActiveServerPayloadId {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ServerRoot
  )

  $pointerPath = Join-Path $ServerRoot "active-payload.txt"
  if (-not (Test-Path -LiteralPath $pointerPath -PathType Leaf)) {
    return $null
  }

  $payloadId = [System.IO.File]::ReadAllText($pointerPath).Trim()
  if ($payloadId -notmatch '^[a-f0-9]{32}$') {
    throw "The active server payload pointer is invalid. The current payload was left unchanged."
  }
  $payloadPath = Join-Path (Join-Path $ServerRoot "payloads") $payloadId
  if (
    -not (Test-Path -LiteralPath (Join-Path $payloadPath "dist\server.js") -PathType Leaf) -or
    -not (Test-Path -LiteralPath (Join-Path $payloadPath "node_modules\prisma\build\index.js") -PathType Leaf)
  ) {
    throw "The active server payload is incomplete. The current payload was left unchanged."
  }
  return $payloadId
}

function Set-ActiveServerPayload {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ServerRoot,

    [Parameter(Mandatory = $true)]
    [string]$PayloadId
  )

  if ($PayloadId -notmatch '^[a-f0-9]{32}$') {
    throw "The requested server payload identifier is invalid."
  }
  $payloadPath = Join-Path (Join-Path $ServerRoot "payloads") $PayloadId
  if (-not (Test-Path -LiteralPath (Join-Path $payloadPath "dist\server.js") -PathType Leaf)) {
    throw "The requested server payload is incomplete; the active payload was not changed."
  }

  $pointerPath = Join-Path $ServerRoot "active-payload.txt"
  $temporaryPath = "$pointerPath.$([guid]::NewGuid().ToString('N')).tmp"
  [System.IO.File]::WriteAllText(
    $temporaryPath,
    $PayloadId,
    (New-Object System.Text.UTF8Encoding($false))
  )
  try {
    if (Test-Path -LiteralPath $pointerPath -PathType Leaf) {
      $backupPath = "$pointerPath.$([guid]::NewGuid().ToString('N')).bak"
      [System.IO.File]::Replace($temporaryPath, $pointerPath, $backupPath)
      if (Test-Path -LiteralPath $backupPath -PathType Leaf) {
        Remove-Item -LiteralPath $backupPath -Force -ErrorAction Stop
      }
    }
    else {
      [System.IO.File]::Move($temporaryPath, $pointerPath)
    }
  }
  finally {
    if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
      Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    }
  }
}

function Save-LegacyServerPayload {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ServerRoot
  )

  if (-not (Test-Path -LiteralPath (Join-Path $ServerRoot "dist\server.js") -PathType Leaf)) {
    return $null
  }
  $payloadId = [guid]::NewGuid().ToString("N")
  $payloadsRoot = Join-Path $ServerRoot "payloads"
  $payloadPath = Join-Path $payloadsRoot $payloadId
  New-Item -ItemType Directory -Force -Path $payloadPath | Out-Null

  foreach ($directory in @("dist", "node_modules", "prisma")) {
    $sourcePath = Join-Path $ServerRoot $directory
    if (Test-Path -LiteralPath $sourcePath -PathType Container) {
      Copy-Item -LiteralPath $sourcePath -Destination $payloadPath -Recurse -Force -ErrorAction Stop
    }
  }
  foreach ($file in @("package.json", "prisma.config.ts")) {
    $sourcePath = Join-Path $ServerRoot $file
    if (Test-Path -LiteralPath $sourcePath -PathType Leaf) {
      Copy-Item -LiteralPath $sourcePath -Destination $payloadPath -Force -ErrorAction Stop
    }
  }
  $passwordUtility = Join-Path $ServerRoot "src\utils\password.ts"
  if (Test-Path -LiteralPath $passwordUtility -PathType Leaf) {
    $utilityDirectory = Join-Path $payloadPath "src\utils"
    New-Item -ItemType Directory -Force -Path $utilityDirectory | Out-Null
    Copy-Item -LiteralPath $passwordUtility -Destination $utilityDirectory -Force -ErrorAction Stop
  }

  if (
    -not (Test-Path -LiteralPath (Join-Path $payloadPath "dist\server.js") -PathType Leaf) -or
    -not (Test-Path -LiteralPath (Join-Path $payloadPath "node_modules\prisma\build\index.js") -PathType Leaf)
  ) {
    throw "The previous server payload could not be preserved completely. The active installation was not changed."
  }
  return $payloadId
}

function Get-VerifiedInventoryRemovalMigrationBytes {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [string]$ExpectedChecksum
  )

  if ($ExpectedChecksum -notmatch '^[a-f0-9]{64}$') {
    throw "The expected stock-removal migration checksum is invalid."
  }

  $migrationBytes = [System.IO.File]::ReadAllBytes($Path)
  $strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
  try {
    $migrationSql = $strictUtf8.GetString($migrationBytes)
  }
  catch {
    throw "The stock-removal migration is not valid UTF-8."
  }

  $normalizedSql = $migrationSql.Replace("`r`n", "`n")
  if ($normalizedSql.Contains("`r")) {
    throw "The stock-removal migration contains unsupported line endings."
  }
  $normalizedBytes = [System.Text.Encoding]::UTF8.GetBytes($normalizedSql)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $normalizedChecksum = [System.BitConverter]::ToString(
      $sha256.ComputeHash($normalizedBytes)
    ).Replace("-", "").ToLowerInvariant()
  }
  finally {
    $sha256.Dispose()
  }

  if ($normalizedChecksum -cne $ExpectedChecksum) {
    throw "The stock-removal migration does not match the verified historical SQL checksum."
  }

  return ,$normalizedBytes
}

function Assert-FreshDatabaseMigrationGate {
  param(
    [Parameter(Mandatory = $true)]
    [bool]$DatabaseCreatedByAttempt,

    [Parameter(Mandatory = $true)]
    [string]$DatabaseState,

    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [string[]]$AppliedMigrations,

    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [string[]]$ExpectedMigrations,

    [Parameter(Mandatory = $true)]
    [string]$MigrationName,

    [Parameter(Mandatory = $true)]
    [string]$MigrationChecksum
  )

  if (
    $MigrationName -cne "20261020101500_remove_product_stock" -or
    $MigrationChecksum -cne "98c0f088b6a25779eff60a5f618750ce8b2caee557334c316a68d41a1c9fa751"
  ) {
    throw "The fresh-database migration does not match the verified stock-removal migration identity and checksum."
  }

  if (-not $DatabaseCreatedByAttempt) {
    throw "A database migration is blocked because this installation attempt did not create the database."
  }
  $databaseStateParts = $DatabaseState.Trim() -split '\|', 5
  if (
    $databaseStateParts.Count -ne 5 -or
    $databaseStateParts[0] -cne $databaseName -or
    $databaseStateParts[1] -cne "127.0.0.1" -or
    $databaseStateParts[2] -cne "5432" -or
    $databaseStateParts[3] -notmatch '^\d+$' -or
    $databaseStateParts[4] -notin @("absent", "present")
  ) {
    throw "The installation-created database could not be positively verified. No migration was applied; preserve the database and follow the local recovery instructions."
  }
  if (
    $AppliedMigrations |
      Where-Object {
        $_ -notmatch '^\d{14}_[a-z0-9_]+$' -or
        $_ -notin $ExpectedMigrations
      }
  ) {
    throw "The installation-created database has unexpected migration history. No migration was applied; preserve the database and follow the local recovery instructions."
  }
  if (
    $databaseStateParts[4] -eq "absent" -and
    ($AppliedMigrations.Count -gt 0 -or [int64]$databaseStateParts[3] -gt 0)
  ) {
    throw "The installation-created database has migration objects without a migration ledger. No migration was applied; preserve the database and follow the local recovery instructions."
  }
  if (
    [int64]$databaseStateParts[3] -gt 0 -and
    $AppliedMigrations.Count -eq 0
  ) {
    throw "The installation-created database contains objects without verified package migration history. No migration was applied; preserve the database and follow the local recovery instructions."
  }
}

function ConvertTo-FreshDatabaseMigrationNames {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [string[]]$MigrationEntries,

    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [string[]]$ExpectedMigrations,

    [Parameter(Mandatory = $true)]
    [string]$InventoryRemovalMigrationName,

    [Parameter(Mandatory = $true)]
    [string]$InventoryRemovalSourceMigrationName,

    [Parameter(Mandatory = $true)]
    [string]$InventoryRemovalMigrationChecksum,

    [Parameter(Mandatory = $true)]
    [string]$InventoryRemovalSafeMigrationChecksum
  )

  $migrationNames = @()
  foreach ($migrationEntry in $MigrationEntries) {
    if ([string]::IsNullOrWhiteSpace($migrationEntry)) {
      continue
    }
    $entry = $migrationEntry.Trim() -split '\|', 2
    if (
      $entry.Count -ne 2 -or
      $entry[0] -notmatch '^\d{14}_[a-z0-9_]+$' -or
      $entry[1] -notmatch '^[a-f0-9]{64}$'
    ) {
      throw "The installation-created database migration ledger contains an invalid entry."
    }

    $migrationName = $entry[0]
    if (
      $migrationName -in @(
        $InventoryRemovalMigrationName,
        $InventoryRemovalSourceMigrationName
      )
    ) {
      if (
        $entry[1] -notin @(
          $InventoryRemovalMigrationChecksum,
          $InventoryRemovalSafeMigrationChecksum
        )
      ) {
        throw "The installation-created database has an unrecognized stock-removal migration checksum."
      }
      $migrationName = $InventoryRemovalMigrationName
    }

    if (
      $migrationName -notin $ExpectedMigrations -or
      $migrationName -in $migrationNames
    ) {
      throw "The installation-created database has unexpected migration history. No migration was applied; preserve the database and follow the local recovery instructions."
    }
    $migrationNames += $migrationName
  }
  return ,$migrationNames
}

function Receive-PostgresInstaller(
  [string]$Uri,
  [string]$DestinationPath,
  [int]$Attempt = 1,
  [datetime]$DownloadDeadline = [datetime]::MinValue
) {
  if ($DownloadDeadline -eq [datetime]::MinValue) {
    $DownloadDeadline = (Get-Date).AddMinutes(60)
  }
  if ($Attempt -gt 3 -or (Get-Date) -gt $DownloadDeadline) {
    throw "The PostgreSQL download exceeded its retry or 60-minute time limit."
  }

  $partialPath = "$DestinationPath.partial"
  $request = $null
  $response = $null
  $downloadStream = $null
  $fileStream = $null
  $downloadFailure = $null
  $receivedBytes = [long]0
  $expectedBytes = [long]0

  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $request = [System.Net.HttpWebRequest]::Create($Uri)
    $request.Method = "GET"
    $request.Timeout = 300000
    $request.ReadWriteTimeout = 300000
    $response = $request.GetResponse()
    $expectedBytes = $response.ContentLength
    if ($expectedBytes -le 0) {
      throw "The download server did not provide a valid package size."
    }

    $downloadStream = $response.GetResponseStream()
    $fileStream = New-Object System.IO.FileStream(
      $partialPath,
      [System.IO.FileMode]::CreateNew,
      [System.IO.FileAccess]::Write,
      [System.IO.FileShare]::None
    )
    $buffer = New-Object byte[] (1024 * 1024)
    $nextProgressBytes = [long](25 * 1024 * 1024)

    while ($true) {
      if ((Get-Date) -gt $DownloadDeadline) {
        throw "The PostgreSQL download exceeded its 60-minute time limit."
      }
      $bytesRead = $downloadStream.Read($buffer, 0, $buffer.Length)
      if ($bytesRead -eq 0) {
        break
      }
      $fileStream.Write($buffer, 0, $bytesRead)
      $receivedBytes += $bytesRead
      if ($receivedBytes -ge $nextProgressBytes) {
        Write-Host (
          "PostgreSQL download progress: {0:N0} of {1:N0} bytes." -f
          $receivedBytes,
          $expectedBytes
        )
        $nextProgressBytes += [long](25 * 1024 * 1024)
      }
    }

    $fileStream.Flush($true)
    if ($receivedBytes -ne $expectedBytes) {
      throw (
        "The PostgreSQL download was incomplete ({0} of {1} bytes)." -f
        $receivedBytes,
        $expectedBytes
      )
    }
  }
  catch {
    $downloadFailure = $_
  }
  finally {
    if ($fileStream) {
      $fileStream.Dispose()
    }
    if ($downloadStream) {
      $downloadStream.Dispose()
    }
    if ($response) {
      $response.Dispose()
    }
  }

  if ($downloadFailure) {
    try {
      if (Test-Path -LiteralPath $partialPath -PathType Leaf) {
        Remove-Item -LiteralPath $partialPath -Force -ErrorAction Stop
      }
    }
    catch {
      throw "The PostgreSQL download failed and its incomplete temporary file could not be removed. Preserve the file and contact support."
    }
    $networkException = $downloadFailure.Exception
    while (
      $networkException -and
      -not ($networkException -is [System.Net.WebException]) -and
      $networkException.InnerException
    ) {
      $networkException = $networkException.InnerException
    }
    $retryableFailure = $false
    if ($networkException -is [System.Net.WebException]) {
      $retryableFailure = $networkException.Status -in @(
        [System.Net.WebExceptionStatus]::Timeout,
        [System.Net.WebExceptionStatus]::ConnectFailure,
        [System.Net.WebExceptionStatus]::NameResolutionFailure,
        [System.Net.WebExceptionStatus]::ProxyNameResolutionFailure,
        [System.Net.WebExceptionStatus]::ReceiveFailure,
        [System.Net.WebExceptionStatus]::SendFailure,
        [System.Net.WebExceptionStatus]::ConnectionClosed,
        [System.Net.WebExceptionStatus]::KeepAliveFailure,
        [System.Net.WebExceptionStatus]::PipelineFailure
      )
      if (
        $networkException.Status -eq [System.Net.WebExceptionStatus]::ProtocolError -and
        $networkException.Response -is [System.Net.HttpWebResponse]
      ) {
        $retryableFailure = [int]$networkException.Response.StatusCode -in @(
          408, 429, 500, 502, 503, 504
        )
        $networkException.Response.Dispose()
      }
    }
    if (
      $retryableFailure -and
      $Attempt -lt 3 -and
      (Get-Date) -lt $DownloadDeadline
    ) {
      $delaySeconds = 5 * $Attempt
      Write-Host (
        "PostgreSQL download attempt {0} of 3 failed due to a temporary network error; retrying in {1} seconds." -f
        $Attempt,
        $delaySeconds
      )
      Start-Sleep -Seconds $delaySeconds
      return Receive-PostgresInstaller `
        -Uri $Uri `
        -DestinationPath $DestinationPath `
        -Attempt ($Attempt + 1) `
        -DownloadDeadline $DownloadDeadline
    }
    throw (
      "The official PostgreSQL installer download failed or was incomplete after {0} attempt(s). " -f
      $Attempt
    ) + (
      "Internet access is required for a fresh PostgreSQL installation; " +
      "restore connectivity and retry setup. Detail: " +
      $downloadFailure.Exception.Message
    )
  }

  try {
    Move-Item -LiteralPath $partialPath -Destination $DestinationPath -ErrorAction Stop
  }
  catch {
    throw "The complete PostgreSQL download could not be finalized in its protected temporary directory."
  }
}

function Install-PostgresPackage([string]$SuperuserPassword) {
  $optionDirectory = Join-Path $env:TEMP (
    "bigbites-postgres-options-{0}" -f [Guid]::NewGuid().ToString("N")
  )
  $optionFile = Join-Path $optionDirectory "postgresql.options"
  $installerPath = Join-Path $optionDirectory "postgresql-installer.exe"
  $optionDirectoryCreated = $false
  $installerProcessMayBeRunning = $false

  try {
    New-Item -ItemType Directory -Path $optionDirectory -ErrorAction Stop |
      Out-Null
    $optionDirectoryCreated = $true

    $security = New-Object System.Security.AccessControl.DirectorySecurity
    $security.SetAccessRuleProtection($true, $false)
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
      [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    $trustedSids = @(
      "S-1-5-18",
      "S-1-5-32-544",
      [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    ) | Select-Object -Unique

    foreach ($sidValue in $trustedSids) {
      $sid = New-Object System.Security.Principal.SecurityIdentifier($sidValue)
      $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $sid,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        $inheritance,
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
      )
      $security.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $optionDirectory -AclObject $security -ErrorAction Stop

    $optionLines = @(
      "mode=unattended",
      "unattendedmodeui=none",
      "superpassword=$SuperuserPassword",
      "serverport=5432",
      "servicename=bigbites-pos-postgresql-x64-17"
    )
    [System.IO.File]::WriteAllLines(
      $optionFile,
      $optionLines,
      [System.Text.Encoding]::ASCII
    )

    Write-Host "Downloading the official PostgreSQL 17.11 installer to a unique temporary directory..."
    Receive-PostgresInstaller `
      -Uri "https://get.enterprisedb.com/postgresql/postgresql-17.11-5-windows-x64.exe" `
      -DestinationPath $installerPath
    Write-Host "PostgreSQL installer download completed and its byte count was verified."

    $signature = $null
    for ($attempt = 1; $attempt -le 5; $attempt++) {
      try {
        $signature = Get-AuthenticodeSignature `
          -LiteralPath $installerPath `
          -ErrorAction Stop
      }
      catch {
        if ($attempt -eq 5) {
          throw "Could not access the completed PostgreSQL installer for Authenticode verification after five attempts. Close any process holding the temporary file and retry setup."
        }
        Write-Host "PostgreSQL installer is temporarily unavailable for signature verification; retrying ($attempt of 5)..."
        Start-Sleep -Seconds 2
        continue
      }

      if ($signature.Status -eq "Valid") {
        break
      }
      if ($signature.Status -eq "UnknownError" -and $attempt -lt 5) {
        Write-Host "Authenticode verification could not read the completed package yet; retrying ($attempt of 5)..."
        Start-Sleep -Seconds 2
        continue
      }
      break
    }

    if (
      $null -eq $signature -or
      $signature.Status -ne "Valid" -or
      $signature.SignerCertificate.Subject -notmatch "(?i)EnterpriseDB"
    ) {
      $signatureStatus = if ($signature) { $signature.Status } else { "Unavailable" }
      throw "The completed PostgreSQL installer failed EnterpriseDB Authenticode verification (status: $signatureStatus). It was not executed."
    }
    Write-Host "PostgreSQL installer Authenticode signature and EnterpriseDB signer verified."

    $installerArguments = '--optionfile "{0}"' -f $optionFile
    $installerProcess = Start-Process `
      -FilePath $installerPath `
      -ArgumentList $installerArguments `
      -PassThru `
      -WindowStyle Hidden `
      -ErrorAction Stop
    if ($null -eq $installerProcess) {
      throw "The verified PostgreSQL installer process could not be started."
    }
    $installerProcessMayBeRunning = $true
    Write-Host "PostgreSQL installer process started (PID $($installerProcess.Id)); waiting up to 30 minutes."
    $installerStartTime = Get-Date
    $installerDeadline = $installerStartTime.AddMinutes(30)
    $installerExited = $false
    do {
      $installerExited = $installerProcess.WaitForExit(30000)
      if (-not $installerExited) {
        $elapsedMinutes = [int](
          [Math]::Floor(((Get-Date) - $installerStartTime).TotalMinutes)
        )
        Write-Host "PostgreSQL installer is still running (about $elapsedMinutes minutes elapsed)."
      }
    } until (
      $installerExited -or
      (Get-Date) -ge $installerDeadline
    )

    if (-not $installerExited) {
      $processStopped = $false
      $stopFailure = $null
      try {
        $installerProcess.Kill()
        $processStopped = $installerProcess.WaitForExit(30000)
      }
      catch {
        $stopFailure = $_
      }
      if ($processStopped) {
        $installerProcessMayBeRunning = $false
      }
      else {
        $stopDetail = if ($stopFailure) {
          " Stop detail: $($stopFailure.Exception.Message)"
        }
        else {
          ""
        }
        throw (
          "The verified PostgreSQL installer exceeded its 30-minute time limit " +
          "and could not be confirmed stopped. Its protected temporary files " +
          "were retained at '$optionDirectory'.$stopDetail"
        )
      }
      throw "The verified PostgreSQL installer exceeded its 30-minute time limit and was stopped. Check Windows Application logs before retrying setup."
    }
    $installerProcessMayBeRunning = $false
    $installerProcess.Refresh()
    $installerExitCode = $installerProcess.ExitCode
    Write-Host "PostgreSQL installer process exited with code $installerExitCode."
    if ($installerExitCode -ne 0) {
      throw "The verified PostgreSQL installer failed (exit code $installerExitCode). Check the PostgreSQL installer logs and retry setup."
    }
    Write-Host "PostgreSQL installer completed successfully."
  }
  finally {
    $cleanupFailure = $null
    if ($optionDirectoryCreated) {
      if ($installerProcessMayBeRunning) {
        Write-Host "Protected PostgreSQL temporary files were retained because the installer process may still be running: $optionDirectory"
      }
      else {
        try {
          if (Test-Path -LiteralPath $installerPath -PathType Leaf) {
            Remove-Item -LiteralPath $installerPath -Force -ErrorAction Stop
          }
          if (Test-Path -LiteralPath $optionFile -PathType Leaf) {
            Remove-Item -LiteralPath $optionFile -Force -ErrorAction Stop
          }
        }
        catch {
          $cleanupFailure = $_
        }
        try {
          if (Test-Path -LiteralPath $optionDirectory -PathType Container) {
            Remove-Item -LiteralPath $optionDirectory -Force -ErrorAction Stop
          }
        }
        catch {
          if (-not $cleanupFailure) {
            $cleanupFailure = $_
          }
        }
      }
    }
    if ($cleanupFailure) {
      throw "Could not remove the temporary PostgreSQL installer options. Check the protected temporary directory and retry setup."
    }
  }
}

function Test-BigBitesNodeRuntime([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $false
  }

  $runtimeHash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
  if ($runtimeHash -ine "3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237") {
    return $false
  }

  $versionOutput = & $Path --version 2>$null
  $architectureOutput = & $Path -p "process.arch" 2>$null
  if (
    $LASTEXITCODE -ne 0 -or
    $versionOutput -notmatch '^v(?<major>\d+)\.(?<minor>\d+)'
  ) {
    return $false
  }
  if ($architectureOutput -ne "x64") {
    return $false
  }

  $major = [int]$Matches.major
  $minor = [int]$Matches.minor
  return $major -gt 20 -or ($major -eq 20 -and $minor -ge 19)
}


function Get-PostgresCli {
  $managedClientPath = Join-Path $programFilesRoot "PostgreSQL\17\bin\psql.exe"
  if (Test-Path -LiteralPath $managedClientPath -PathType Leaf) {
    $managedVersion = & $managedClientPath --version 2>$null
    if (
      $LASTEXITCODE -eq 0 -and
      $managedVersion -match '\(PostgreSQL\)\s+17(?:\.(?<minor>\d+))?'
    ) {
      return [pscustomobject]@{
        FullName = $managedClientPath
        Major = 17
        Minor = if ($Matches.minor) { [int]$Matches.minor } else { 0 }
      }
    }
  }

  $candidatePaths = @()
  $programRoots = @(
    $programFilesRoot
    $env:ProgramFiles
    ${env:ProgramFiles(x86)}
  ) |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    Select-Object -Unique

  foreach ($programRoot in $programRoots) {
    $candidatePaths += Get-ChildItem `
      (Join-Path $programRoot "PostgreSQL\*\bin\psql.exe") `
      -ErrorAction SilentlyContinue |
      ForEach-Object { $_.FullName }
  }

  $pathCommand = Get-Command psql.exe -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($pathCommand) {
    $candidatePaths += $pathCommand.Source
  }

  $compatibleClients = @(
    foreach ($candidatePath in ($candidatePaths | Select-Object -Unique)) {
      $versionOutput = & $candidatePath --version 2>$null
      if (
        $LASTEXITCODE -ne 0 -or
        $versionOutput -notmatch '\(PostgreSQL\)\s+(?<major>\d+)(?:\.(?<minor>\d+))?'
      ) {
        continue
      }

      $major = [int]$Matches.major
      if ($major -lt 10) {
        continue
      }

      [pscustomobject]@{
        FullName = $candidatePath
        Major = $major
        Minor = if ($Matches.minor) { [int]$Matches.minor } else { 0 }
      }
    }
  )

  return $compatibleClients |
    Sort-Object Major, Minor -Descending |
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

function New-LocalDatabaseUrl([string]$Password, [string]$DatabaseName) {
  if (
    [string]::IsNullOrWhiteSpace($Password) -or
    $DatabaseName -notmatch '^[a-z][a-z0-9_]*$'
  ) {
    throw "The local database connection settings are invalid."
  }

  $encodedUser = [Uri]::EscapeDataString("bigbites_app")
  $encodedPassword = [Uri]::EscapeDataString($Password)
  $url = "postgresql://${encodedUser}:${encodedPassword}@127.0.0.1:5432/${DatabaseName}?schema=public"
  try {
    $uri = [Uri]$url
    $userInfo = $uri.UserInfo -split ':', 2
    $parsedRole = [Uri]::UnescapeDataString($userInfo[0])
    $parsedPassword = if ($userInfo.Count -eq 2) {
      [Uri]::UnescapeDataString($userInfo[1])
    }
    else {
      ""
    }
    $parsedDatabase = [Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/'))
  }
  catch {
    throw "The local database connection URL could not be validated."
  }

  if (
    $uri.Scheme -ne "postgresql" -or
    $uri.Host -ne "127.0.0.1" -or
    $uri.Port -ne 5432 -or
    $parsedRole -ne "bigbites_app" -or
    $parsedPassword -cne $Password -or
    $parsedDatabase -cne $DatabaseName -or
    $uri.Query -cne "?schema=public"
  ) {
    throw "The local database connection URL did not preserve its expected database target."
  }
  return $url
}

function Set-LocalDatabaseUrlInEnvironment([string]$Path, [string]$DatabaseUrl) {
  $lines = [System.IO.File]::ReadAllLines($Path)
  $matches = @(
    for ($index = 0; $index -lt $lines.Length; $index++) {
      if ($lines[$index] -match '^DATABASE_URL=') {
        $index
      }
    }
  )
  if ($matches.Count -ne 1) {
    throw "The local server configuration does not contain exactly one database URL. It was left unchanged."
  }

  $lines[$matches[0]] = "DATABASE_URL=$DatabaseUrl"
  $operationId = [Guid]::NewGuid().ToString('N')
  $temporaryPath = "$Path.$operationId.tmp"
  $backupPath = "$Path.$operationId.bak"
  $replacementCompleted = $false
  try {
    $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
    [System.IO.File]::WriteAllLines(
      $temporaryPath,
      $lines,
      [System.Text.Encoding]::ASCII
    )
    Set-Acl -LiteralPath $temporaryPath -AclObject $acl -ErrorAction Stop
    [System.IO.File]::Replace($temporaryPath, $Path, $backupPath)
    $replacementCompleted = $true
  }
  catch {
    throw "The corrected local database configuration could not be saved safely. The original configuration was left unchanged."
  }
  finally {
    if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
      Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    }
    if (
      $replacementCompleted -and
      (Test-Path -LiteralPath $backupPath -PathType Leaf)
    ) {
      Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
    }
  }
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

function Get-BigBitesServerProcesses {
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

function ConvertFrom-BigBitesNetstatListeners {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("TCP", "UDP")]
    [string]$Protocol,

    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 65535)]
    [int]$LocalPort,

    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [AllowEmptyString()]
    [string[]]$Lines
  )

  $listeners = @()
  foreach ($line in $Lines) {
    if ([string]::IsNullOrWhiteSpace($line)) {
      continue
    }
    $fields = @($line.Trim() -split '\s+')
    if (
      $fields.Count -lt 4 -or
      $fields[0] -ine $Protocol -or
      $fields[1] -notmatch ':(\d+)$'
    ) {
      continue
    }

    $parsedLocalPort = [int]$Matches[1]
    if ($parsedLocalPort -ne $LocalPort) {
      continue
    }

    if ($Protocol -eq "TCP") {
      if (
        $fields.Count -lt 5 -or
        $fields[2] -notmatch ':(\d+)$'
      ) {
        throw "The netstat fallback returned an unreadable TCP endpoint for port $LocalPort."
      }
      if ([int]$Matches[1] -ne 0) {
        continue
      }
      $processId = $fields[4]
    }
    else {
      $processId = $fields[3]
    }

    if ($processId -notmatch '^\d+$') {
      throw "The netstat fallback returned an unreadable process ID for port $LocalPort."
    }
    $listeners += [pscustomobject]@{
      OwningProcess = [int]$processId
    }
  }

  return $listeners
}

function Get-BigBitesPortListeners {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("TCP", "UDP")]
    [string]$Protocol,

    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 65535)]
    [int]$LocalPort
  )

  try {
    if ($Protocol -eq "TCP") {
      return @(
        Get-NetTCPConnection `
          -State Listen `
          -LocalPort $LocalPort `
          -ErrorAction Stop
      )
    }
    return @(
      Get-NetUDPEndpoint `
        -LocalPort $LocalPort `
        -ErrorAction Stop
    )
  }
  catch {
    $queryError = $_.Exception.Message
    $netstatPath = Join-Path $env:SystemRoot "System32\netstat.exe"
    if (-not (Test-Path -LiteralPath $netstatPath -PathType Leaf)) {
      throw "The Windows $Protocol endpoint query failed and netstat.exe is unavailable; port $LocalPort could not be verified."
    }

    Write-Host "The Windows $Protocol endpoint query failed; checking port $LocalPort with netstat.exe."
    try {
      $netstatOutput = & $netstatPath `
        -ano `
        -p $Protocol.ToLowerInvariant() `
        2>&1
      if ($LASTEXITCODE -ne 0) {
        throw "netstat.exe returned exit code $LASTEXITCODE."
      }
    }
    catch {
      throw "The Windows $Protocol endpoint query and netstat.exe fallback both failed for port $LocalPort. Detail: $queryError"
    }

    return @(
      ConvertFrom-BigBitesNetstatListeners `
        -Protocol $Protocol `
        -LocalPort $LocalPort `
        -Lines @($netstatOutput)
    )
  }
}

function Assert-BigBitesPortAvailability {
  $serverProcessIds = @(
    Get-BigBitesServerProcesses |
      Select-Object -ExpandProperty ProcessId
  )
  $tcpListeners = @(
    Get-BigBitesPortListeners -Protocol "TCP" -LocalPort 3000
  )
  $udpListeners = @(
    Get-BigBitesPortListeners -Protocol "UDP" -LocalPort 3001
  )

  $tcpConflicts = @(
    $tcpListeners |
      Where-Object { $_.OwningProcess -notin $serverProcessIds }
  )
  if ($tcpConflicts.Count -gt 0) {
    $processIds = ($tcpConflicts | Select-Object -ExpandProperty OwningProcess -Unique) -join ", "
    throw "TCP port 3000 is already in use by a process not owned by BIG BITES POS (PID $processIds). The conflicting process was left unchanged."
  }

  $udpConflicts = @(
    $udpListeners |
      Where-Object { $_.OwningProcess -notin $serverProcessIds }
  )
  if ($udpConflicts.Count -gt 0) {
    $processIds = ($udpConflicts | Select-Object -ExpandProperty OwningProcess -Unique) -join ", "
    throw "UDP port 3001 is already in use by a process not owned by BIG BITES POS (PID $processIds). The conflicting process was left unchanged."
  }
}

function Stop-ExistingServer {
  $task = Get-ScheduledTask `
    -TaskName $taskName `
    -TaskPath "\" `
    -ErrorAction SilentlyContinue
  if ($task) {
    $expectedAction = @(
      $task.Actions | Where-Object {
        $_.Execute -match '(?i)(?:^|\\)powershell\.exe$' -and
        $_.Arguments -match [regex]::Escape(
          (Join-Path $serverDir "Start-BigBitesServer.ps1")
        )
      }
    )
    if ($task.Actions.Count -ne 1 -or $expectedAction.Count -ne 1) {
      throw "A task named $taskName exists, but it is not the expected BIG BITES POS startup task. It was left unchanged."
    }
    if ($task.State -eq "Running") {
      Stop-ScheduledTask -TaskName $taskName -TaskPath "\" -ErrorAction Stop
    }
  }

  $processes = @(Get-BigBitesServerProcesses)
  foreach ($process in $processes) {
    Write-Host "Stopping existing BIG BITES POS server process $($process.ProcessId)..."
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
  }

  $deadline = (Get-Date).AddSeconds(15)
  do {
    $remainingProcesses = @(Get-BigBitesServerProcesses)
    if ($remainingProcesses.Count -eq 0) {
      return
    }
    Start-Sleep -Milliseconds 500
  } until ((Get-Date) -gt $deadline)

  $processIds = ($remainingProcesses | ForEach-Object { $_.ProcessId }) -join ", "
  throw "The existing BIG BITES POS server process(es) $processIds could not be stopped."
}

function Restore-PreviousServerAfterFailure {
  if (-not $script:serverStopped) {
    return
  }

  $pointerPath = Join-Path $serverDir "active-payload.txt"
  if ($script:previousPayloadId) {
    Set-ActiveServerPayload `
      -ServerRoot $serverDir `
      -PayloadId $script:previousPayloadId
  }
  elseif (
    $script:activationAttempted -and
    (Test-Path -LiteralPath $pointerPath -PathType Leaf) -and
    ([System.IO.File]::ReadAllText($pointerPath).Trim() -eq $script:activePayloadId)
  ) {
    Remove-Item -LiteralPath $pointerPath -Force -ErrorAction Stop
  }

  if (-not $script:previousPayloadId -or -not $script:previousServerRestartSafe) {
    Write-Host "The previous payload was retained. Automatic restart was not attempted because the database state may not be compatible."
    return
  }

  Stop-ExistingServer
  $task = Get-ScheduledTask `
    -TaskName $taskName `
    -TaskPath "\" `
    -ErrorAction SilentlyContinue
  if (-not $task) {
    throw "The previous payload was restored, but its scheduled startup task is missing. Run setup again after reviewing the local installation state."
  }

  Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
  $deadline = (Get-Date).AddSeconds(45)
  do {
    Start-Sleep -Seconds 2
    try {
      $health = Invoke-RestMethod `
        -Uri "http://127.0.0.1:3000/health" `
        -TimeoutSec 3
      if ($health.status -eq "OK" -and $health.database -eq "Connected") {
        $script:serverStopped = $false
        Write-Host "The previous BIG BITES POS payload was restored and restarted successfully."
        return
      }
    }
    catch {
    }
  } until ((Get-Date) -gt $deadline)

  throw "The previous payload was restored, but its service did not become healthy. Check the local server logs before retrying."
}

function Enable-LocalPostgresSetupAccess {
  $instanceRoot = Split-Path (Split-Path $script:psqlPath -Parent) -Parent
  $rootPattern = [regex]::Escape($instanceRoot)
  $service = Get-CimInstance Win32_Service |
    Where-Object {
      $_.Name -match "(?i)postgresql" -and
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

$hasBundledServer = (
  (Test-Path -LiteralPath $ServerSourcePath) -and
  (Test-Path -LiteralPath (Join-Path $ServerSourcePath "dist\server.js"))
)

if (-not $hasBundledServer) {
  throw "The packaged server resources were not found at $ServerSourcePath. Installation stopped because the local POS server is required."
}
else {
  $requiredServerResources = @(
    "prisma\schema.prisma",
    "prisma\migrations\migration_lock.toml",
    "prisma\migrations\20260914084442_initial_hotel_pos\migration.sql",
    "prisma\migrations\20260922200000_remove_kitchen_role\migration.sql",
    "prisma\migrations\20260922210000_add_parcel_table\migration.sql",
    "prisma\migrations\20260928233000_ready_for_billing\migration.sql",
    "prisma\migrations\20260928234000_pending_order_payments\migration.sql",
    "prisma\migrations\20260929210000_add_gst_settings\migration.sql",
    "prisma\migrations\20260929220000_add_restaurant_address\migration.sql",
    "prisma\migrations\20261003120000_add_fssai_gstin_settings\migration.sql",
    "prisma\migrations\20261003123000_add_order_discounts\migration.sql",
    "prisma\migrations\20261003130000_remove_manager_role\migration.sql",
    "prisma\migrations\20261006150000_payment_tender_details\migration.sql",
    "prisma\migrations\20261006220000_add_gst_toggle_and_order_reports\migration.sql",
    "prisma\migrations\20261009230000_menu_variants_classification\migration.sql",
    "prisma\migrations\20261013010000_cash_upi_split_payment\migration.sql",
    "prisma\migrations\20261013213000_add_product_stock_movements\migration.sql"
  )
  foreach ($resource in $requiredServerResources) {
    if (-not (Test-Path -LiteralPath (Join-Path $ServerSourcePath $resource))) {
      throw "A required Prisma resource is missing: $resource. Installation stopped before changing services or databases."
    }
  }

  $migrationDirectories = Get-ChildItem `
    -LiteralPath (Join-Path $ServerSourcePath "prisma\migrations") `
    -Directory
  $inventoryRemovalMigrationName = "20261020101500_remove_product_stock"
  $inventoryRemovalSourceMigrationName = "20261020100000_remove_product_stock"
  $inventoryRemovalMigrationChecksum = "98c0f088b6a25779eff60a5f618750ce8b2caee557334c316a68d41a1c9fa751"
  $inventoryRemovalSafeMigrationSql = "-- Historical stock-removal migration intentionally disabled for local BIG BITES installs.`r`n"
  $inventoryRemovalSafeMigrationBytes = [System.Text.Encoding]::UTF8.GetBytes(
    $inventoryRemovalSafeMigrationSql
  )
  $inventoryRemovalSafeMigrationSha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $inventoryRemovalSafeMigrationChecksum = (
      [BitConverter]::ToString(
        $inventoryRemovalSafeMigrationSha256.ComputeHash(
          $inventoryRemovalSafeMigrationBytes
        )
      ).Replace("-", "").ToLowerInvariant()
    )
  }
  finally {
    $inventoryRemovalSafeMigrationSha256.Dispose()
  }
  $inventoryRemovalSourceDirectories = @(
    $migrationDirectories |
      Where-Object {
        $_.Name -in @(
          $inventoryRemovalMigrationName,
          $inventoryRemovalSourceMigrationName
        )
      }
  )
  if ($inventoryRemovalSourceDirectories.Count -ne 1) {
    throw "The packaged stock-removal migration identity is missing or ambiguous. Installation stopped before changing services or databases."
  }
  $inventoryRemovalSourceDirectory = $inventoryRemovalSourceDirectories[0]
  $inventoryRemovalSourcePath = Join-Path `
    $inventoryRemovalSourceDirectory.FullName `
    "migration.sql"
  if (
    -not (Test-Path -LiteralPath $inventoryRemovalSourcePath -PathType Leaf)
  ) {
    throw "The packaged stock-removal migration does not match the verified historical migration. Installation stopped before changing services or databases."
  }
  $null = Get-VerifiedInventoryRemovalMigrationBytes `
    -Path $inventoryRemovalSourcePath `
    -ExpectedChecksum $inventoryRemovalMigrationChecksum
  $destructiveInventorySql = '(?is)\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:(?:"?[\w]+"?)\.)?(?:"ProductStockMovement"|ProductStockMovement)(?![\w])|\bALTER\s+TABLE\b[^;]*?\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(?:"(?:stock|stockUnit|lowStockThreshold|lastStockUpdatedAt)"|\b(?:stock|stockUnit|lowStockThreshold|lastStockUpdatedAt)\b)'
  foreach ($migrationDirectory in $migrationDirectories) {
    $migrationFile = Join-Path $migrationDirectory.FullName "migration.sql"
    if (-not (Test-Path -LiteralPath $migrationFile)) {
      throw "Migration $($migrationDirectory.Name) has no migration.sql file. Installation stopped before changing services or databases."
    }
    $migrationSql = [System.IO.File]::ReadAllText($migrationFile)
    if (
      $migrationSql -match $destructiveInventorySql -and
      $migrationDirectory.FullName -ne $inventoryRemovalSourceDirectory.FullName
    ) {
      throw "Migration $($migrationDirectory.Name) contains SQL that removes product stock or stock-movement history. Installation stopped before changing services or databases."
    }
  }

  $approvedMigrationDirectories = @(
    $requiredServerResources |
      Where-Object {
        $_ -match '^prisma\\migrations\\[^\\]+\\migration\.sql$'
      } |
      ForEach-Object {
        ($_ -split '\\')[2]
      }
  )
  $approvedMigrationDirectories += $inventoryRemovalSourceDirectory.Name
  $unreviewedMigrations = @(
    $migrationDirectories |
      Where-Object {
        $_.Name -notin $approvedMigrationDirectories
      } |
      ForEach-Object { $_.Name }
  )
  if ($unreviewedMigrations.Count -gt 0) {
    throw "The packaged migration set contains unreviewed directories: $($unreviewedMigrations -join ', '). Installation stopped before changing services or databases."
  }

  $schemaPath = Join-Path $ServerSourcePath "prisma\schema.prisma"
  $schema = [System.IO.File]::ReadAllText($schemaPath)
  $productModel = [regex]::Match(
    $schema,
    '(?ms)model\s+Product\s*\{(.*?)^\}'
  )
  if (-not $productModel.Success) {
    throw "The packaged Prisma schema does not define the Product model. Installation stopped before changing services or databases."
  }
  foreach ($inventoryField in @(
    "stock",
    "stockUnit",
    "lowStockThreshold",
    "lastStockUpdatedAt"
  )) {
    if ($productModel.Groups[1].Value -notmatch "(?m)^\s*$inventoryField\s+") {
      throw "The packaged Product schema is missing required inventory field $inventoryField. Installation stopped before changing services or databases."
    }
  }
  if ($schema -notmatch '(?ms)model\s+ProductStockMovement\s*\{') {
    throw "The packaged Prisma schema does not preserve stock-movement history. Installation stopped before changing services or databases."
  }
}

if (-not (Test-Path (Join-Path $PSScriptRoot "Start-BigBitesServer.ps1"))) {
  throw "The packaged server startup script was not found at $PSScriptRoot."
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
  /C |
  Out-Null

if ($LASTEXITCODE -ne 0) {
  throw "Could not restrict access to the local server configuration."
}


# ============================================================
# INSTALL / FIND NODE.JS
# ============================================================

$bundledNodePath = Join-Path $PSScriptRoot "node-runtime\node.exe"
if (-not (Test-BigBitesNodeRuntime $bundledNodePath)) {
  throw "The bundled x64 Node.js runtime is missing, invalid, or older than 20.19. The server was not changed."
}

$nodePath = $bundledNodePath
Write-Host "The bundled private Node.js runtime is ready."


# ============================================================
# INSTALL / FIND POSTGRESQL
# ============================================================

$psql = Get-PostgresCli

$postgresPassword = $null


if (-not $psql) {

  Write-Host "PostgreSQL not found. Installing the signed official PostgreSQL package..."
  $postgresPortListeners = @(
    Get-BigBitesPortListeners -Protocol "TCP" -LocalPort 5432
  )
  if ($postgresPortListeners.Count -gt 0) {
    $processIds = (
      $postgresPortListeners |
        Select-Object -ExpandProperty OwningProcess -Unique
    ) -join ", "
    throw "TCP port 5432 is already in use by a process not identified as this BIG BITES PostgreSQL instance (PID $processIds). The existing process and database were left untouched."
  }

  $postgresPassword = `
    (New-RandomSecret 36).
    Replace("+", "A").
    Replace("/", "B")

  Install-PostgresPackage -SuperuserPassword $postgresPassword
  $script:postgresServiceName = "bigbites-pos-postgresql-x64-17"

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

  if (-not $hasExistingEnvironment) {
    throw "An existing PostgreSQL installation was detected without a BIG BITES local configuration. Setup will not attach to or restart an unrelated database service."
  }
  Write-Host "Existing PostgreSQL detected. Validating the configured BIG BITES local database."
}

if ($hasExistingEnvironment -and -not $isResumingInstall) {
  $script:psqlPath = $psql.FullName
  Set-LocalPostgresOperationTimeouts
  $env:PGPASSWORD = $existingDatabasePassword
  try {
    $preflightDatabaseIdentity = (
      & $psqlPath `
        -w `
        -h 127.0.0.1 `
        -p 5432 `
        -U bigbites_app `
        -d $databaseName `
        -v ON_ERROR_STOP=1 `
        -tAc "SELECT current_database() || '|' || host(inet_server_addr()) || '|' || current_setting('port')" `
        2>&1
    ) | Out-String

    if (
      $LASTEXITCODE -ne 0 -or
      $preflightDatabaseIdentity.Trim() -ne "$databaseName|127.0.0.1|5432"
    ) {
      throw "The existing database could not be positively verified as local 127.0.0.1:5432/$databaseName. The existing server was not stopped."
    }

    if (
      -not $installState -or
      $installState.status -ne "completed" -or
      -not $installState.roleCreatedByAttempt -or
      -not $installState.databaseCreatedByAttempt
    ) {
      throw "The local installation ownership journal is missing or incomplete. Setup did not attach to or modify the PostgreSQL service."
    }

    $expectedDatabaseMarker = "BIGBITES_INSTALL_ATTEMPT:$($installState.attemptId)"
    $preflightOwnershipMarker = (
      & $psqlPath `
        -w `
        -h 127.0.0.1 `
        -p 5432 `
        -U bigbites_app `
        -d $databaseName `
        -v ON_ERROR_STOP=1 `
        -tAc "SELECT COALESCE(shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database'), '') || '|' || COALESCE(shobj_description((SELECT oid FROM pg_roles WHERE rolname = current_user), 'pg_authid'), '')" `
        2>&1
    ) | Out-String
    if (
      $LASTEXITCODE -ne 0 -or
      $preflightOwnershipMarker.Trim() -ne "$expectedDatabaseMarker|$expectedDatabaseMarker"
    ) {
      throw "The local database and application role are not positively tied to this BIG BITES installation. The PostgreSQL service and database were left unchanged."
    }

    $preflightFailedMigrationCount = (
      & $psqlPath `
        -w `
        -h 127.0.0.1 `
        -p 5432 `
        -U bigbites_app `
        -d $databaseName `
        -v ON_ERROR_STOP=1 `
        -tAc 'SELECT count(*) FROM public."_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL' `
        2>&1
    ) | Out-String
    if ($LASTEXITCODE -ne 0 -or $preflightFailedMigrationCount.Trim() -ne "0") {
      throw "The existing migration ledger is missing or contains an incomplete migration. The existing server was not stopped."
    }

    $preflightAppliedOutput = (
      & $psqlPath `
        -w `
        -h 127.0.0.1 `
        -p 5432 `
        -U bigbites_app `
        -d $databaseName `
        -v ON_ERROR_STOP=1 `
        -tAc 'SELECT migration_name || ''|'' || checksum FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name' `
        2>&1
    ) | Out-String

    if ($LASTEXITCODE -ne 0) {
      throw "Could not verify the existing migration ledger. The existing server was not stopped."
    }

    $preflightAppliedMigrations = @()
    foreach ($line in ($preflightAppliedOutput -split "`r?`n")) {
      $entry = $line.Trim() -split '\|', 2
      if ($entry.Count -ne 2) {
        if (-not [string]::IsNullOrWhiteSpace($line)) {
          throw "The existing migration ledger could not be interpreted safely. The existing server was not stopped."
        }
        continue
      }
      if (
        $entry[0] -notmatch '^\d{14}_[a-z0-9_]+$' -or
        $entry[1] -notmatch '^[a-f0-9]{64}$' -or
        $entry[0] -in $preflightAppliedMigrations
      ) {
        throw "The existing migration ledger contains an invalid or ambiguous entry. The existing server was not stopped."
      }
      $migrationPath = Join-Path `
        (Join-Path $ServerSourcePath "prisma\migrations") `
        (Join-Path $entry[0] "migration.sql")
      if (
        $entry[0] -eq $inventoryRemovalMigrationName -and
        -not (Test-Path -LiteralPath $migrationPath -PathType Leaf)
      ) {
        $migrationPath = Join-Path `
          (Join-Path $ServerSourcePath "prisma\migrations") `
          (Join-Path $inventoryRemovalSourceMigrationName "migration.sql")
      }
      if (-not (Test-Path -LiteralPath $migrationPath -PathType Leaf)) {
        throw "The existing database contains a migration absent from this package. Its schema history cannot be verified; the existing server was not stopped."
      }
      $packageChecksum = if ($entry[0] -eq $inventoryRemovalMigrationName) {
        $null = Get-VerifiedInventoryRemovalMigrationBytes `
          -Path $migrationPath `
          -ExpectedChecksum $inventoryRemovalMigrationChecksum
        if (
          $entry[1] -notin @(
            $inventoryRemovalMigrationChecksum,
            $inventoryRemovalSafeMigrationChecksum
          )
        ) {
          throw "The existing database has an unrecognized stock-removal migration checksum. The existing server was not stopped."
        }
        $entry[1]
      }
      else {
        (Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash
      }
      if ($packageChecksum -ine $entry[1]) {
        throw "The existing database migration checksum does not match this package. The existing server was not stopped."
      }
      $preflightAppliedMigrations += $entry[0]
    }

    $packagedMigrations = @(
      Get-ChildItem `
        -LiteralPath (Join-Path $ServerSourcePath "prisma\migrations") `
        -Directory |
        ForEach-Object {
          if ($_.Name -eq $inventoryRemovalSourceMigrationName) {
            $inventoryRemovalMigrationName
          }
          else {
            $_.Name
          }
        }
    )
    $pendingMigrations = @(
      $packagedMigrations |
        Where-Object { $_ -notin $preflightAppliedMigrations }
    )
    if ($pendingMigrations.Count -gt 0) {
      throw "The existing database has unapplied migrations. Setup stopped before stopping the server or applying migrations; have the database owner review the migration plan."
    }
    $unrecognizedRemovalMigrations = @(
      $preflightAppliedMigrations |
        Where-Object { $_ -match '^\d{14}_remove_product_stock$' -and $_ -ne $inventoryRemovalMigrationName }
    )
    if ($unrecognizedRemovalMigrations.Count -gt 0) {
      throw "The existing database records a stock-removal migration under an unrecognized migration identity. Its history cannot be verified; the existing server was not stopped."
    }

    $preflightInventorySchemaState = (
      & $psqlPath `
        -w `
        -h 127.0.0.1 `
        -p 5432 `
        -U bigbites_app `
        -d $databaseName `
        -v ON_ERROR_STOP=1 `
        -tAc "SELECT CASE WHEN to_regclass('public.""Product""') IS NULL THEN 'missing' ELSE 'present' END || '|' || (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Product' AND column_name IN ('stock', 'stockUnit', 'lowStockThreshold', 'lastStockUpdatedAt')) || '|' || CASE WHEN to_regclass('public.""ProductStockMovement""') IS NULL THEN 'absent' ELSE 'present' END" `
        2>&1
    ) | Out-String

    if (
      $LASTEXITCODE -ne 0 -or
      $preflightInventorySchemaState.Trim() -ne "present|4|present"
    ) {
    throw "The existing local database does not have the verified inventory-preserving schema. The existing server was not stopped and no migration was applied."
    }
  }
  finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
}

if (-not ($hasExistingEnvironment -and -not $isResumingInstall)) {
  $script:psqlPath = $psql.FullName
  Set-LocalPostgresOperationTimeouts
  if ($postgresPassword) {
    $env:PGPASSWORD = $postgresPassword
  }
  else {
    Enable-LocalPostgresSetupAccess
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }

  try {
    $preflightMarker = if ($installState) {
      "BIGBITES_INSTALL_ATTEMPT:$($installState.attemptId)"
    }
    else {
      ""
    }
    $preflightDatabaseState = (
      & $psqlPath `
        -w `
        -h 127.0.0.1 `
        -p 5432 `
        -U postgres `
        -d postgres `
        -tAc "SELECT '1|' || COALESCE(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = '$databaseName'" `
        2>&1
    ) | Out-String
    if ($LASTEXITCODE -ne 0) {
      throw "Could not inspect the local database before stopping the server."
    }

    $preflightRoleState = (
      & $psqlPath `
        -w `
        -h 127.0.0.1 `
        -p 5432 `
        -U postgres `
        -d postgres `
        -tAc "SELECT '1|' || COALESCE(shobj_description(oid, 'pg_authid'), '') FROM pg_roles WHERE rolname = 'bigbites_app'" `
        2>&1
    ) | Out-String
    if ($LASTEXITCODE -ne 0) {
      throw "Could not inspect the local application role before stopping the server."
    }

    $databasePresent = -not [string]::IsNullOrWhiteSpace($preflightDatabaseState.Trim())
    $rolePresent = -not [string]::IsNullOrWhiteSpace($preflightRoleState.Trim())
    if (
      ($databasePresent -and $preflightDatabaseState.Trim() -ne "1|$preflightMarker") -or
      ($rolePresent -and $preflightRoleState.Trim() -ne "1|$preflightMarker")
    ) {
      throw "An existing or ambiguous local role/database was found before service shutdown. No role, database, business data, or active server payload was changed. Preserve the resources and follow the local recovery instructions."
    }
    if (
      $installState -and
      (
        ($installState.databaseCreatedByAttempt -and -not $databasePresent) -or
        ($installState.roleCreatedByAttempt -and -not $rolePresent)
      )
    ) {
      throw "A database resource recorded by this installation attempt is missing. The server was not stopped; follow the local recovery instructions."
    }

    $preflightOwnsDatabase = (
      $databasePresent -and
      -not [string]::IsNullOrWhiteSpace($preflightMarker) -and
      $preflightDatabaseState.Trim() -eq "1|$preflightMarker"
    )
    if ($preflightOwnsDatabase) {
      $preflightFreshDatabaseState = (
        & $psqlPath `
          -w `
          -h 127.0.0.1 `
          -p 5432 `
          -U postgres `
          -d $databaseName `
          -v ON_ERROR_STOP=1 `
          -tAc "SELECT current_database() || '|' || host(inet_server_addr()) || '|' || current_setting('port') || '|' || (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname <> '_prisma_migrations' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')) || '|' || CASE WHEN to_regclass('public.""_prisma_migrations""') IS NULL THEN 'absent' ELSE 'present' END" `
          2>&1
      ) | Out-String
      if ($LASTEXITCODE -ne 0) {
        throw "The installation-created database could not be verified before server shutdown. No migration or cleanup was performed."
      }

      $preflightFreshAppliedEntries = @()
      if ($preflightFreshDatabaseState.Trim() -notmatch '\|absent$') {
        $preflightFreshFailedMigrationCount = (
          & $psqlPath `
            -w `
            -h 127.0.0.1 `
            -p 5432 `
            -U postgres `
            -d $databaseName `
            -v ON_ERROR_STOP=1 `
            -tAc 'SELECT count(*) FROM public."_prisma_migrations" WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL' `
            2>&1
        ) | Out-String
        if (
          $LASTEXITCODE -ne 0 -or
          $preflightFreshFailedMigrationCount.Trim() -ne "0"
        ) {
          throw "The installation-created database has an incomplete or rolled-back migration. No migration was applied before service shutdown."
        }
        $preflightFreshAppliedOutput = (
          & $psqlPath `
            -w `
            -h 127.0.0.1 `
            -p 5432 `
            -U postgres `
            -d $databaseName `
            -v ON_ERROR_STOP=1 `
            -tAc 'SELECT migration_name || ''|'' || checksum FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name' `
            2>&1
        ) | Out-String
        if ($LASTEXITCODE -ne 0) {
          throw "The installation-created database migration ledger could not be verified before server shutdown."
        }
        $preflightFreshAppliedEntries = @(
          $preflightFreshAppliedOutput -split "`r?`n" |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ }
        )
      }

      $preflightExpectedMigrations = @(
        $migrationDirectories |
          ForEach-Object {
            if ($_.Name -eq $inventoryRemovalSourceMigrationName) {
              $inventoryRemovalMigrationName
            }
            else {
              $_.Name
            }
          }
      )
      $preflightFreshAppliedMigrations = @(
        ConvertTo-FreshDatabaseMigrationNames `
          -MigrationEntries $preflightFreshAppliedEntries `
          -ExpectedMigrations $preflightExpectedMigrations `
          -InventoryRemovalMigrationName $inventoryRemovalMigrationName `
          -InventoryRemovalSourceMigrationName $inventoryRemovalSourceMigrationName `
          -InventoryRemovalMigrationChecksum $inventoryRemovalMigrationChecksum `
          -InventoryRemovalSafeMigrationChecksum $inventoryRemovalSafeMigrationChecksum
      )
      Assert-FreshDatabaseMigrationGate `
        -DatabaseCreatedByAttempt $true `
        -DatabaseState $preflightFreshDatabaseState `
        -AppliedMigrations $preflightFreshAppliedMigrations `
        -ExpectedMigrations $preflightExpectedMigrations `
        -MigrationName $inventoryRemovalMigrationName `
        -MigrationChecksum $inventoryRemovalMigrationChecksum

      if ($script:repairLocalDatabaseUrlOnRetry) {
        $databaseUrl = New-LocalDatabaseUrl `
          -Password $existingDatabasePassword `
          -DatabaseName $databaseName
        Set-LocalDatabaseUrlInEnvironment `
          -Path $envFile `
          -DatabaseUrl $databaseUrl
        $existingEnvironment["DATABASE_URL"] = $databaseUrl
        $script:repairLocalDatabaseUrlOnRetry = $false
        Write-Host "The installation-owned database and role were verified; the local database URL was safely repaired for retry."
      }
    }
  }
  finally {
    Restore-PostgresAuthentication
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
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


& takeown.exe /F $serverDir | Out-Null

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

if (Test-Path -LiteralPath $envFile -PathType Leaf) {
  & icacls.exe `
    $envFile `
    /inheritance:r `
    /grant:r "*S-1-5-18:F" `
    "*S-1-5-32-544:F" `
    /C |
    Out-Null

  if ($LASTEXITCODE -ne 0) {
    throw "Could not restrict the local server configuration file."
  }
}


# ============================================================
# STAGE AND VALIDATE THE COMPLETE SERVER PAYLOAD
# ============================================================

Write-Host "Staging and validating the replacement BIG BITES POS server..."
$stagedServerPath = Stage-ServerPayload `
  -SourcePath $ServerSourcePath `
  -ServerRoot $serverDir
$stagedMigrationsPath = Join-Path $stagedServerPath "prisma\migrations"
$stagedInventoryRemovalSourcePath = Join-Path `
  $stagedMigrationsPath `
  $inventoryRemovalSourceMigrationName
$stagedInventoryRemovalPath = Join-Path `
  $stagedMigrationsPath `
  $inventoryRemovalMigrationName
if (
  (Test-Path -LiteralPath $stagedInventoryRemovalSourcePath -PathType Container) -and
  (Test-Path -LiteralPath $stagedInventoryRemovalPath)
) {
  throw "The staged Prisma migrations contain conflicting stock-removal identities."
}
if (Test-Path -LiteralPath $stagedInventoryRemovalSourcePath -PathType Container) {
  Move-Item `
    -LiteralPath $stagedInventoryRemovalSourcePath `
    -Destination $stagedInventoryRemovalPath `
    -ErrorAction Stop
}
if (
  -not (Test-Path -LiteralPath $stagedInventoryRemovalPath -PathType Container)
) {
  throw "The staged stock-removal migration does not match the verified historical migration."
}
$stagedInventoryRemovalSqlPath = Join-Path `
  $stagedInventoryRemovalPath `
  "migration.sql"
$null = Get-VerifiedInventoryRemovalMigrationBytes `
  -Path $stagedInventoryRemovalSqlPath `
  -ExpectedChecksum $inventoryRemovalMigrationChecksum
[System.IO.File]::WriteAllBytes(
  $stagedInventoryRemovalSqlPath,
  $inventoryRemovalSafeMigrationBytes
)

$payloadsRoot = Join-Path $serverDir "payloads"
New-Item -ItemType Directory -Force -Path $payloadsRoot | Out-Null
$script:activePayloadId = [guid]::NewGuid().ToString("N")
$script:candidatePayloadPath = Join-Path $payloadsRoot $script:activePayloadId
[System.IO.Directory]::Move($stagedServerPath, $script:candidatePayloadPath)

$script:previousPayloadId = Get-ActiveServerPayloadId -ServerRoot $serverDir
if (
  -not $script:previousPayloadId -and
  (Test-Path -LiteralPath (Join-Path $serverDir "dist\server.js") -PathType Leaf)
) {
  $script:previousPayloadId = Save-LegacyServerPayload -ServerRoot $serverDir
}

$startScript = Join-Path $serverDir "Start-BigBitesServer.ps1"
$startSource = Join-Path $PSScriptRoot "Start-BigBitesServer.ps1"
if (-not (Test-Path -LiteralPath $startSource -PathType Leaf)) {
  throw "The packaged server startup script was not found. The active server was not stopped."
}
Copy-Item -LiteralPath $startSource -Destination $startScript -Force -ErrorAction Stop

if ($hasExistingEnvironment -and -not $isResumingInstall) {
  $script:previousServerRestartSafe = $true
}

Assert-BigBitesPortAvailability
Stop-ExistingServer
$script:serverStopped = $true
Assert-BigBitesPortAvailability

$nodeRuntimeDirectory = Join-Path `
  (Join-Path $serverDir "runtime") `
  "node-3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237"
New-Item -ItemType Directory -Force -Path $nodeRuntimeDirectory | Out-Null
$installedNodePath = Join-Path $nodeRuntimeDirectory "node.exe"
if (-not (Test-Path -LiteralPath $installedNodePath -PathType Leaf)) {
  $stagedNodePath = "$installedNodePath.$([guid]::NewGuid().ToString('N')).tmp.exe"
  try {
    Copy-Item -LiteralPath $bundledNodePath -Destination $stagedNodePath -ErrorAction Stop
    if (-not (Test-BigBitesNodeRuntime $stagedNodePath)) {
      throw "The private Node.js runtime failed validation while being copied."
    }
    [System.IO.File]::Move($stagedNodePath, $installedNodePath)
  }
  finally {
    if (Test-Path -LiteralPath $stagedNodePath -PathType Leaf) {
      Remove-Item -LiteralPath $stagedNodePath -Force -ErrorAction SilentlyContinue
    }
  }
}
if (-not (Test-BigBitesNodeRuntime $installedNodePath)) {
  throw "The protected private Node.js runtime is invalid; existing runtime files were left untouched."
}
$nodePath = $installedNodePath


# ============================================================
# CREATE POSTGRES USER / DATABASE
# ============================================================

$script:psqlPath = $psql.FullName
Set-LocalPostgresOperationTimeouts
$pendingMigrations = @()
$isNewDatabase = $false

if ($hasExistingEnvironment -and -not $isResumingInstall) {
  $databaseUrl = $existingEnvironment["DATABASE_URL"]
  $appPassword = $existingDatabasePassword
  $authSecret = $existingEnvironment["AUTH_SECRET"]
}
else {
  if ($isResumingInstall -and $hasExistingEnvironment) {
    $databaseUrl = $existingEnvironment["DATABASE_URL"]
    $appPassword = $existingDatabasePassword
    $authSecret = $existingEnvironment["AUTH_SECRET"]
  }
  else {
    if (
      $isResumingInstall -and
      ($installState.roleCreationStarted -or $installState.databaseCreationStarted)
    ) {
      throw "A previous setup attempt may have created a database resource, but its protected local configuration is missing. No resources were changed; restore the configuration or contact support before retrying."
    }
    $appPassword = `
      (New-RandomSecret 36).
      Replace("+", "C").
      Replace("/", "D")

    $authSecret = New-RandomSecret 48
    $databaseUrl = New-LocalDatabaseUrl `
      -Password $appPassword `
      -DatabaseName $databaseName
  }

  if (-not $installState) {
    $installState = @{
      version = 1
      attemptId = [guid]::NewGuid().ToString("N")
      status = "in-progress"
      roleCreationStarted = $false
      roleCreatedByAttempt = $false
      databaseCreationStarted = $false
      databaseCreatedByAttempt = $false
    }
    Save-InstallState -State $installState -StatePath $installStatePath
  }

  if (-not $hasExistingEnvironment) {
    if (Test-Path -LiteralPath $envFile) {
      throw "A local server configuration appeared during setup. It was left unchanged; review the installation state before retrying."
    }
    $environment = @(
      "DATABASE_URL=$databaseUrl"
      "AUTH_SECRET=$authSecret"
      "NODE_ENV=production"
      "BIGBITES_DEPLOYMENT_MODE=local"
      "PORT=3000"
      "DISCOVERY_PORT=3001"
    ) -join [Environment]::NewLine
    [System.IO.File]::WriteAllText(
      $envFile,
      $environment + [Environment]::NewLine,
      [System.Text.Encoding]::ASCII
    )
    $hasExistingEnvironment = $true
  }

  if ($postgresPassword) {
    $env:PGPASSWORD = $postgresPassword
  }
  else {
    Enable-LocalPostgresSetupAccess
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }

  try {
    $attemptMarker = "BIGBITES_INSTALL_ATTEMPT:$($installState.attemptId)"
    $databaseState = (
      & $psqlPath `
        -w `
        -h 127.0.0.1 `
        -p 5432 `
        -U postgres `
        -d postgres `
        -tAc "SELECT '1|' || COALESCE(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = '$databaseName'" `
        2>&1
    ) | Out-String

    if ($LASTEXITCODE -ne 0) {
      throw "Could not verify the local database before setup."
    }

    $roleState = (
      & $psqlPath `
        -w `
        -h 127.0.0.1 `
        -p 5432 `
        -U postgres `
        -d postgres `
        -tAc "SELECT '1|' || COALESCE(shobj_description(oid, 'pg_authid'), '') FROM pg_roles WHERE rolname = 'bigbites_app'" `
        2>&1
    ) | Out-String

    if ($LASTEXITCODE -ne 0) {
      throw "Could not verify the local application role before setup."
    }

    $databaseExists = -not [string]::IsNullOrWhiteSpace($databaseState.Trim())
    $roleExists = -not [string]::IsNullOrWhiteSpace($roleState.Trim())
    $databaseOwned = $databaseExists -and $databaseState.Trim() -eq "1|$attemptMarker"
    $roleOwned = $roleExists -and $roleState.Trim() -eq "1|$attemptMarker"

    if ($databaseExists -and -not $databaseOwned) {
      throw "The local $databaseName database exists but cannot be positively tied to this installation attempt. It and all business data were left unchanged. Do not delete or reset it; restore the matching installation state or contact support."
    }
    if ($roleExists -and -not $roleOwned) {
      throw "The local bigbites_app role exists but cannot be positively tied to this installation attempt. It was left unchanged. Do not delete it; restore the matching installation state or contact support."
    }

    if ($databaseOwned) {
      $installState.databaseCreatedByAttempt = $true
      Save-InstallState -State $installState -StatePath $installStatePath
    }
    elseif ($installState.databaseCreatedByAttempt) {
      throw "The database recorded as created by this attempt is missing. No role or database was deleted; follow the local recovery instructions before retrying."
    }

    if ($roleOwned) {
      $installState.roleCreatedByAttempt = $true
      Save-InstallState -State $installState -StatePath $installStatePath
    }
    elseif ($installState.roleCreatedByAttempt) {
      throw "The role recorded as created by this attempt is missing. No role or database was deleted; follow the local recovery instructions before retrying."
    }

    if (-not $roleExists) {
      $installState.roleCreationStarted = $true
      Save-InstallState -State $installState -StatePath $installStatePath
      Invoke-Psql "CREATE ROLE bigbites_app LOGIN PASSWORD '$appPassword'"
      Invoke-Psql "COMMENT ON ROLE bigbites_app IS '$attemptMarker'"
      $installState.roleCreatedByAttempt = $true
      Save-InstallState -State $installState -StatePath $installStatePath
    }

    if (-not $databaseExists) {
      $installState.databaseCreationStarted = $true
      Save-InstallState -State $installState -StatePath $installStatePath
      Invoke-Psql "CREATE DATABASE $databaseName OWNER bigbites_app"
      Invoke-Psql "COMMENT ON DATABASE $databaseName IS '$attemptMarker'"
      $installState.databaseCreatedByAttempt = $true
      Save-InstallState -State $installState -StatePath $installStatePath
    }

    $isNewDatabase = [bool]$installState.databaseCreatedByAttempt
  }
  finally {
    Restore-PostgresAuthentication
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
}


# ============================================================
# PRISMA MIGRATIONS
# ============================================================

if (-not $isNewDatabase) {
  $env:PGPASSWORD = $appPassword
  try {
    $databaseIdentity = (
      & $psqlPath `
        -w `
        -h 127.0.0.1 `
        -p 5432 `
        -U bigbites_app `
        -d $databaseName `
        -v ON_ERROR_STOP=1 `
        -tAc "SELECT current_database() || '|' || host(inet_server_addr()) || '|' || current_setting('port')" `
        2>&1
    ) | Out-String

    if ($LASTEXITCODE -ne 0 -or $databaseIdentity.Trim() -ne "$databaseName|127.0.0.1|5432") {
      throw "The configured database could not be positively verified as local 127.0.0.1:5432/$databaseName. Migrations were not applied."
    }

    $failedMigrationCount = (
      & $psqlPath `
        -w `
        -h 127.0.0.1 `
        -p 5432 `
        -U bigbites_app `
        -d $databaseName `
        -v ON_ERROR_STOP=1 `
        -tAc 'SELECT count(*) FROM public."_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL' `
        2>&1
    ) | Out-String

    if ($LASTEXITCODE -ne 0 -or $failedMigrationCount.Trim() -ne "0") {
      throw "The existing migration ledger is missing or contains a failed migration. No migrations were applied."
    }

    $appliedOutput = (
      & $psqlPath `
        -w `
        -h 127.0.0.1 `
        -p 5432 `
        -U bigbites_app `
        -d $databaseName `
        -v ON_ERROR_STOP=1 `
        -tAc 'SELECT migration_name || ''|'' || checksum FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name' `
        2>&1
    ) | Out-String

    if ($LASTEXITCODE -ne 0) {
      throw "Could not verify migration history for the existing database. Migrations were not applied."
    }

    $appliedMigrations = @()
    $appliedMigrationChecksums = @{}
    foreach ($line in ($appliedOutput -split "`r?`n")) {
      if ([string]::IsNullOrWhiteSpace($line)) {
        continue
      }
      $entry = $line.Trim() -split '\|', 2
      if (
        $entry.Count -ne 2 -or
        $entry[0] -notmatch '^\d{14}_[a-z0-9_]+$' -or
        $entry[1] -notmatch '^[a-f0-9]{64}$' -or
        $entry[0] -in $appliedMigrations
      ) {
        throw "The existing migration ledger contains an invalid or ambiguous entry. Migrations were not applied."
      }
      $appliedMigrations += $entry[0]
      $appliedMigrationChecksums[$entry[0]] = $entry[1]
    }
    $migrationDirectories = @(
      Get-ChildItem `
        -LiteralPath (Join-Path $script:candidatePayloadPath "prisma\migrations") `
        -Directory |
        Select-Object -ExpandProperty Name
    )
    $unknownMigrations = @(
      $appliedMigrations |
        Where-Object { $_ -notin $migrationDirectories }
    )
    if ($unknownMigrations.Count -gt 0) {
      throw "The database migration history contains entries absent from this package. Setup stopped without applying migrations."
    }
    foreach ($migrationName in $appliedMigrations) {
      $migrationPath = Join-Path `
        (Join-Path $script:candidatePayloadPath "prisma\migrations") `
        (Join-Path $migrationName "migration.sql")
      if (-not (Test-Path -LiteralPath $migrationPath -PathType Leaf)) {
        throw "The database migration history contains an entry without packaged SQL. Setup stopped without applying migrations."
      }
      $packageChecksum = if ($migrationName -eq $inventoryRemovalMigrationName) {
        $null = Get-VerifiedInventoryRemovalMigrationBytes `
          -Path $migrationPath `
          -ExpectedChecksum $inventoryRemovalMigrationChecksum
        $inventoryRemovalMigrationChecksum
      }
      else {
        (Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash
      }
      if ($packageChecksum -ine $appliedMigrationChecksums[$migrationName]) {
        throw "The existing database migration checksum does not match this package. Migrations were not applied."
      }
      if (
        $migrationName -eq $inventoryRemovalMigrationName -and
        $packageChecksum -ine $inventoryRemovalMigrationChecksum
      ) {
        throw "The historical stock-removal migration checksum is not recognized. Migrations were not applied."
      }
    }

    $pendingMigrations = @(
      $migrationDirectories |
        Where-Object { $_ -notin $appliedMigrations }
    )

    if ($inventoryRemovalMigrationName -in $pendingMigrations) {
      throw "The packaged migration set contains a stock-removal migration that cannot be applied to an existing database."
    }

    $inventorySchemaState = (
      & $psqlPath `
        -w `
        -h 127.0.0.1 `
        -p 5432 `
        -U bigbites_app `
        -d $databaseName `
        -v ON_ERROR_STOP=1 `
        -tAc "SELECT CASE WHEN to_regclass('public.""Product""') IS NULL THEN 'missing' ELSE 'present' END || '|' || (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Product' AND column_name IN ('stock', 'stockUnit', 'lowStockThreshold', 'lastStockUpdatedAt')) || '|' || CASE WHEN to_regclass('public.""ProductStockMovement""') IS NULL THEN 'absent' ELSE 'present' END" `
        2>&1
    ) | Out-String

    if ($LASTEXITCODE -ne 0 -or $inventorySchemaState.Trim() -ne "present|4|present") {
      throw "The existing local database does not have the verified inventory-preserving schema. Setup stopped without applying migrations."
    }

    if ($pendingMigrations.Count -gt 0) {
      throw "The existing database has unapplied migrations. Setup stopped without running migrations; have the database owner review the migration plan."
    }
  }
  finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
}

if ($isNewDatabase) {
  $env:PGPASSWORD = $appPassword
  try {
    $newDatabaseState = (
      & $psqlPath `
        -w `
        -h 127.0.0.1 `
        -p 5432 `
        -U bigbites_app `
        -d $databaseName `
        -v ON_ERROR_STOP=1 `
        -tAc "SELECT current_database() || '|' || host(inet_server_addr()) || '|' || current_setting('port') || '|' || (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname <> '_prisma_migrations' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')) || '|' || CASE WHEN to_regclass('public.""_prisma_migrations""') IS NULL THEN 'absent' ELSE 'present' END" `
        2>&1
    ) | Out-String

    if ($LASTEXITCODE -ne 0) {
      throw "The database created by this installation attempt could not be positively verified. No migrations were applied."
    }

    $newDatabaseAppliedMigrations = @()
    if ($newDatabaseState.Trim() -notmatch '\|absent$') {
      $newDatabaseFailedMigrationCount = (
        & $psqlPath `
          -w `
          -h 127.0.0.1 `
          -p 5432 `
          -U bigbites_app `
          -d $databaseName `
          -v ON_ERROR_STOP=1 `
          -tAc 'SELECT count(*) FROM public."_prisma_migrations" WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL' `
          2>&1
      ) | Out-String
      if (
        $LASTEXITCODE -ne 0 -or
        $newDatabaseFailedMigrationCount.Trim() -ne "0"
      ) {
        throw "The installation-created database has an incomplete or rolled-back migration. No migration was applied."
      }
      $newDatabaseAppliedOutput = (
        & $psqlPath `
          -w `
          -h 127.0.0.1 `
          -p 5432 `
          -U bigbites_app `
          -d $databaseName `
          -v ON_ERROR_STOP=1 `
          -tAc 'SELECT migration_name || ''|'' || checksum FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name' `
          2>&1
      ) | Out-String
      if ($LASTEXITCODE -ne 0) {
        throw "The installation-created database migration ledger could not be verified. No migration was applied."
      }
      $newDatabaseAppliedMigrations = @(
        $newDatabaseAppliedOutput -split "`r?`n" |
          ForEach-Object { $_.Trim() } |
          Where-Object { $_ }
      )
    }

    $migrationRoot = Join-Path $script:candidatePayloadPath "prisma\migrations"
    $migrationDirectories = @(
      Get-ChildItem -LiteralPath $migrationRoot -Directory |
        Select-Object -ExpandProperty Name
    )
    $verifiedMigrationNames = @()
    foreach ($migrationEntry in $newDatabaseAppliedMigrations) {
      $entry = $migrationEntry -split '\|', 2
      if (
        $entry.Count -ne 2 -or
        $entry[0] -notmatch '^\d{14}_[a-z0-9_]+$' -or
        $entry[1] -notmatch '^[a-f0-9]{64}$' -or
        $entry[0] -notin $migrationDirectories -or
        $entry[0] -in $verifiedMigrationNames
      ) {
        throw "The installation-created database has an invalid or unexpected migration entry. No migration was applied."
      }

      $migrationPath = Join-Path `
        $migrationRoot `
        (Join-Path $entry[0] "migration.sql")
      if (-not (Test-Path -LiteralPath $migrationPath -PathType Leaf)) {
        throw "The installation-created database has a migration without packaged SQL. No migration was applied."
      }
      $packageChecksum = if ($entry[0] -eq $inventoryRemovalMigrationName) {
        $null = Get-VerifiedInventoryRemovalMigrationBytes `
          -Path $inventoryRemovalSourcePath `
          -ExpectedChecksum $inventoryRemovalMigrationChecksum
        if (
          $entry[1] -notin @(
            $inventoryRemovalMigrationChecksum,
            $inventoryRemovalSafeMigrationChecksum
          )
        ) {
          throw "The installation-created database has an unrecognized stock-removal migration checksum. No migration was applied."
        }
        $entry[1]
      }
      else {
        (Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash
      }
      if ($packageChecksum -ine $entry[1]) {
        throw "The installation-created database migration checksum does not match this package. No migration was applied."
      }

      $verifiedMigrationNames += $entry[0]
    }

    Assert-FreshDatabaseMigrationGate `
      -DatabaseCreatedByAttempt ([bool]$installState.databaseCreatedByAttempt) `
      -DatabaseState $newDatabaseState `
      -AppliedMigrations $verifiedMigrationNames `
      -ExpectedMigrations $migrationDirectories `
      -MigrationName $inventoryRemovalMigrationName `
      -MigrationChecksum $inventoryRemovalMigrationChecksum
  }
  finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
}

$env:DATABASE_URL = $databaseUrl
$env:AUTH_SECRET = $authSecret
$env:NODE_ENV = "production"
$env:BIGBITES_DEPLOYMENT_MODE = "local"
$migrationDatabaseUri = [Uri]$env:DATABASE_URL
Write-Host (
  "Verified local migration target: {0}:{1}/{2} (schema {3})." -f
  $migrationDatabaseUri.Host,
  $migrationDatabaseUri.Port,
  [Uri]::UnescapeDataString($migrationDatabaseUri.AbsolutePath.TrimStart('/')),
  ($migrationDatabaseUri.Query -replace '^\?schema=', '')
)


Push-Location $script:candidatePayloadPath

try {
  if ($isNewDatabase -or $pendingMigrations.Count -gt 0) {
    Write-Host "Applying and verifying the local database migrations..."
    if ($hasExistingEnvironment -and $pendingMigrations.Count -gt 0) {
      $script:previousServerRestartSafe = $false
    }
    & $nodePath `
      (Join-Path $script:candidatePayloadPath "node_modules\prisma\build\index.js") `
      migrate deploy

    if ($LASTEXITCODE -ne 0) {
      throw "Database migrations failed. Review the migration error and restore the verified local backup if recovery is required."
    }
    Write-Host "Database migrations completed in package order; the stock-removal migration ran only as its verified comment-only replacement."
  }
  else {
    Write-Host "The existing local database is already current with the packaged migrations."
  }
}
finally {

  Pop-Location

  Remove-Item `
    Env:DATABASE_URL,
    Env:AUTH_SECRET,
    Env:NODE_ENV,
    Env:BIGBITES_DEPLOYMENT_MODE `
    -ErrorAction SilentlyContinue
}

if ($isNewDatabase) {
  $env:PGPASSWORD = $appPassword
  try {
    $finalInventorySchemaState = (
      & $psqlPath `
        -w `
        -h 127.0.0.1 `
        -p 5432 `
        -U bigbites_app `
        -d $databaseName `
        -v ON_ERROR_STOP=1 `
        -tAc "SELECT CASE WHEN to_regclass('public.""Product""') IS NULL THEN 'missing' ELSE 'present' END || '|' || (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Product' AND column_name IN ('stock', 'stockUnit', 'lowStockThreshold', 'lastStockUpdatedAt')) || '|' || CASE WHEN to_regclass('public.""ProductStockMovement""') IS NULL THEN 'absent' ELSE 'present' END" `
        2>&1
    ) | Out-String
    if (
      $LASTEXITCODE -ne 0 -or
      $finalInventorySchemaState.Trim() -ne "present|4|present"
    ) {
      if (
        -not $installState -or
        -not [bool]$installState.databaseCreatedByAttempt
      ) {
        throw (
          "Inventory schema validation failed for the installation-created database (observed state: {0}). " +
          "Automatic repair was blocked because database ownership could not be verified."
        ) -f $finalInventorySchemaState.Trim()
      }

      $stockColumnState = (
        & $psqlPath `
          -w `
          -h 127.0.0.1 `
          -p 5432 `
          -U bigbites_app `
          -d $databaseName `
          -v ON_ERROR_STOP=1 `
          -tAc "SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Product') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Product' AND column_name = 'stock') THEN 'safe' ELSE 'unsafe' END" `
          2>&1
      ) | Out-String
      if ($LASTEXITCODE -ne 0 -or $stockColumnState.Trim() -ne "safe") {
        throw (
          "Inventory schema validation failed (observed state: {0}); the Product.stock column was not confirmed. " +
          "No automatic database repair was attempted."
        ) -f $finalInventorySchemaState.Trim()
      }

      Write-Host "Repairing only missing inventory schema on the verified installation-created database; existing Product.stock quantities are preserved."
      $inventoryRepairSql = @'
BEGIN;

DO $$
BEGIN
  IF to_regclass('public."Product"') IS NULL THEN
    RAISE EXCEPTION 'Required table public."Product" is missing; inventory repair was not applied';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Product'
      AND column_name = 'stock'
  ) THEN
    RAISE EXCEPTION 'Required column public."Product".stock is missing; inventory repair was not applied';
  END IF;
END $$;

ALTER TABLE public."Product"
  ADD COLUMN IF NOT EXISTS "stockUnit" TEXT NOT NULL DEFAULT 'pcs',
  ADD COLUMN IF NOT EXISTS "lowStockThreshold" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastStockUpdatedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS public."ProductStockMovement" (
  "id" SERIAL NOT NULL,
  "productId" INTEGER NOT NULL,
  "movementType" TEXT NOT NULL DEFAULT 'ADJUSTMENT',
  "quantity" INTEGER NOT NULL,
  "previousStock" INTEGER NOT NULL,
  "newStock" INTEGER NOT NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductStockMovement_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = to_regclass('public."ProductStockMovement"')
      AND conname = 'ProductStockMovement_productId_fkey'
  ) THEN
    ALTER TABLE public."ProductStockMovement"
      ADD CONSTRAINT "ProductStockMovement_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES public."Product"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
'@
      & $psqlPath `
        -w `
        -h 127.0.0.1 `
        -p 5432 `
        -U bigbites_app `
        -d $databaseName `
        -v ON_ERROR_STOP=1 `
        -c $inventoryRepairSql `
        2>&1 | ForEach-Object { Write-Host $_ }
      if ($LASTEXITCODE -ne 0) {
        throw "The safe additive inventory-schema repair failed. Existing stock quantities were not intentionally changed; preserve the database and setup log."
      }

      $finalInventorySchemaState = (
        & $psqlPath `
          -w `
          -h 127.0.0.1 `
          -p 5432 `
          -U bigbites_app `
          -d $databaseName `
          -v ON_ERROR_STOP=1 `
          -tAc "SELECT CASE WHEN to_regclass('public.""Product""') IS NULL THEN 'missing' ELSE 'present' END || '|' || (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Product' AND column_name IN ('stock', 'stockUnit', 'lowStockThreshold', 'lastStockUpdatedAt')) || '|' || CASE WHEN to_regclass('public.""ProductStockMovement""') IS NULL THEN 'absent' ELSE 'present' END" `
          2>&1
      ) | Out-String
      if (
        $LASTEXITCODE -ne 0 -or
        $finalInventorySchemaState.Trim() -ne "present|4|present"
      ) {
        throw (
          "Inventory schema validation still failed after the safe repair (observed state: {0}). " +
          "The local server was not started; preserve the database and setup log."
        ) -f $finalInventorySchemaState.Trim()
      }
      Write-Host "Inventory schema is ready; no stock quantities were reset and no movement records were fabricated."
    }
  }
  finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
}

# ============================================================
# WINDOWS FIREWALL
# ============================================================

$postgresInstanceRoot = Split-Path (Split-Path $psql.FullName -Parent) -Parent
$postgresRootPattern = [regex]::Escape($postgresInstanceRoot)
$postgresService = Get-CimInstance Win32_Service -ErrorAction Stop |
  Where-Object {
    $_.Name -match "(?i)postgresql" -and
    $_.PathName -match $postgresRootPattern
  } |
  Sort-Object Name -Descending |
  Select-Object -First 1

if (-not $postgresService) {
  throw "Could not identify the PostgreSQL service required by the local POS database."
}

Set-Service `
  -Name $postgresService.Name `
  -StartupType Automatic `
  -ErrorAction Stop

$postgresService = Get-CimInstance Win32_Service -ErrorAction Stop |
  Where-Object { $_.Name -eq $postgresService.Name } |
  Select-Object -First 1
if (-not $postgresService -or $postgresService.StartMode -ne "Auto") {
  throw "The PostgreSQL service could not be configured to start automatically with Windows."
}

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
# CREATE WINDOWS STARTUP TASK
# ============================================================

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
Assert-BigBitesPortAvailability

Set-ActiveServerPayload `
  -ServerRoot $serverDir `
  -PayloadId $script:activePayloadId
$script:activationAttempted = $true

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
Write-Host "The local API and PostgreSQL health checks passed."

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

if ($installState -and $installState.status -eq "in-progress") {
  $installState.status = "completed"
  Save-InstallState -State $installState -StatePath $installStatePath
}
$script:serverStopped = $false


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

Write-Host "No menu items or application accounts were initialized automatically."
Write-Host "For a verified empty local database, run $InstallDir\resources\windows\Initialize-BigBites.ps1 interactively as an administrator."

Stop-Transcript | Out-Null
Restore-LocalPostgresOperationTimeouts
exit 0