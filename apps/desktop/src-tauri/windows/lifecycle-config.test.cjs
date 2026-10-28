const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const os = require("node:os");

const windowsDirectory = __dirname;
const tauriDirectory = path.resolve(windowsDirectory, "..");
const desktopDirectory = path.resolve(tauriDirectory, "..");
const waiterDirectory = path.resolve(desktopDirectory, "..", "waiter_app");

const read = (filePath) => fs.readFileSync(filePath, "utf8");

const tauriConfig = JSON.parse(
  read(path.join(tauriDirectory, "tauri.conf.json")),
);
const installer = read(path.join(windowsDirectory, "Install-BigBites.ps1"));
const postgresPackageInstallerMatch = installer.match(
  /function Install-PostgresPackage\([^)]*\) \{[\s\S]*?(?=\r?\nfunction )/,
);
const postgresDownloadHelperMatch = installer.match(
  /function Receive-PostgresInstaller\([\s\S]*?(?=\r?\nfunction )/,
);
const nodeRuntimeValidatorMatch = installer.match(
  /function Test-BigBitesNodeRuntime\([^)]*\) \{[\s\S]*?(?=\r?\nfunction )/,
);
const localDatabaseUrlBuilderMatch = installer.match(
  /function New-LocalDatabaseUrl\([^)]*\) \{[\s\S]*?(?=\r?\nfunction )/,
);
const localDatabaseUrlEnvironmentWriterMatch = installer.match(
  /function Set-LocalDatabaseUrlInEnvironment\([^)]*\) \{[\s\S]*?(?=\r?\nfunction )/,
);
const bundledNodeSelectionMatch = installer.match(
  /\$bundledNodePath = Join-Path \$PSScriptRoot "node-runtime\\node\.exe"[\s\S]*?Write-Host "The bundled private Node\.js runtime is ready\."/,
);
const freshMigrationNamesConverterMatch = installer.match(
  /function ConvertTo-FreshDatabaseMigrationNames \{[\s\S]*?(?=\r?\nfunction )/,
);
const stagingHelperMatch = installer.match(
  /function Initialize-BigBitesPathSafety \{[\s\S]*?(?=\r?\n# ={10,}\r?\n# VALIDATION)/,
);
const starter = read(path.join(windowsDirectory, "Start-BigBitesServer.ps1"));
const stopper = read(path.join(windowsDirectory, "Stop-BigBitesServer.ps1"));
const initializer = read(
  path.join(windowsDirectory, "Initialize-BigBites.ps1"),
);
const nsis = read(path.join(windowsDirectory, "installer.nsh"));
const serverDirectory = path.resolve(desktopDirectory, "..", "server");
const serverPackage = JSON.parse(
  read(path.join(serverDirectory, "package.json")),
);
const serverBuild = read(
  path.join(serverDirectory, "scripts", "build.cjs"),
);
const windowsRuntimePreparer = read(
  path.join(serverDirectory, "scripts", "prepare-windows-runtime.cjs"),
);
const migrationSafetyGuard =
  installer.indexOf("$migrationSql -match $destructiveInventorySql");
const payloadStagingCall = installer.indexOf(
  "$stagedServerPath = Stage-ServerPayload",
);
const stopExistingServerCall = installer.indexOf(
  "Stop-ExistingServer",
  payloadStagingCall,
);

function normalizePowerShellContinuations(source) {
  return source.replace(/`\r?\n\s*/g, " ");
}

function getStagingManifest() {
  assert.ok(stagingHelperMatch, "installer must declare the isolated staging helper");
  const helper = stagingHelperMatch[0];
  const filesMatch = helper.match(
    /\$requiredStagedFiles\s*=\s*@\(([\s\S]*?)\)/,
  );
  const directoriesMatch = helper.match(
    /foreach\s*\(\$directory\s+in\s+@\("node_modules\\@prisma\\engines"\)\)/,
  );
  assert.ok(filesMatch, "staging helper must declare required staged files");
  assert.ok(directoriesMatch, "staging helper must require Prisma engines");
  return {
    helper,
    files: [...filesMatch[1].matchAll(/"([^"]+)"/g)].map(
      (match) => match[1],
    ),
    directories: ["node_modules\\@prisma\\engines"],
  };
}

function getStageFunction() {
  const match = stagingHelperMatch[0].match(
    /function Stage-ServerPayload \{[\s\S]*?(?=\nfunction )/,
  );
  assert.ok(match, "installer must declare Stage-ServerPayload");
  return match[0];
}

function createStagingFixture(root, files, directories) {
  for (const file of files) {
    const filePath = path.join(root, ...file.split(/[\\/]/));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      file === "package.json"
        ? JSON.stringify({
            name: "server",
            version: "1.0.0",
            type: "commonjs",
            dependencies: { "@prisma/client": "^7.0.0", prisma: "^7.0.0" },
          })
        : "fixture",
    );
  }
  for (const directory of directories) {
    fs.mkdirSync(path.join(root, ...directory.split(/[\\/]/)), {
      recursive: true,
    });
  }
}

function createTestRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function testPostgresPackageInstaller(context, mode) {
  assert.ok(postgresPackageInstallerMatch, "installer must declare Install-PostgresPackage");
  const testRoot = createTestRoot("bigbites-postgres-installer-");
  const scriptPath = path.join(testRoot, "postgres-installer-test.ps1");
  const script = [
    "param([string]$TestRoot, [string]$Mode)",
    "$ErrorActionPreference = 'Stop'",
    "$env:TEMP = $TestRoot",
    "$script:TestRoot = $TestRoot",
    "$script:TestPassword = 'Safe-Local-Test-Password-Only'",
    "$script:InstallerMode = $Mode",
    "$script:ObservedOptionDirectory = $null",
    "$script:InstallerExecuted = $false",
    "$script:SignatureAttempts = 0",
    "$script:clock = [datetime]::Now",
    "function Get-Date { if ($script:InstallerMode -eq 'process-timeout') { $script:clock = $script:clock.AddMinutes(31) }; return $script:clock }",
    "class MockInstallerProcess {",
    "  [int]$Id",
    "  [int]$ExitCode",
    "  [bool]$ShouldTimeout",
    "  MockInstallerProcess([int]$exitCode, [bool]$shouldTimeout) { $this.Id = 24680; $this.ExitCode = $exitCode; $this.ShouldTimeout = $shouldTimeout }",
    "  [bool] WaitForExit([int]$timeoutMilliseconds) { return -not $this.ShouldTimeout }",
    "  [void] Refresh() {}",
    "  [void] Kill() { $this.ShouldTimeout = $false }",
    "}",
    "function Invoke-WingetInstall { throw 'winget must not be used.' }",
    "function Receive-PostgresInstaller { param([string]$Uri, [string]$DestinationPath); if ($Uri -ne 'https://get.enterprisedb.com/postgresql/postgresql-17.11-5-windows-x64.exe') { throw 'Unexpected download URI.' }; if ($script:InstallerMode -eq 'download-failure') { throw 'The official PostgreSQL installer download failed. Internet access is required.' }; if ($script:InstallerMode -eq 'download-incomplete') { throw 'The PostgreSQL download was incomplete.' }; if ([IO.Path]::GetFileName($DestinationPath) -ne 'postgresql-installer.exe' -or (Split-Path -Leaf (Split-Path -Parent $DestinationPath)) -notmatch '^bigbites-postgres-options-[0-9a-f]{32}$') { throw 'Installer was not downloaded into a unique temporary directory.' }; [System.IO.File]::WriteAllText($DestinationPath, 'mock signed installer') }",
    "function Get-AuthenticodeSignature { [CmdletBinding()] param([string]$LiteralPath); $script:SignatureAttempts++; if ($script:InstallerMode -eq 'signature-lock' -and $script:SignatureAttempts -lt 3) { return [pscustomobject]@{ Status = 'UnknownError'; SignerCertificate = $null } }; $status = if ($script:InstallerMode -eq 'signature-failure') { 'NotTrusted' } else { 'Valid' }; $subject = if ($script:InstallerMode -eq 'wrong-signer') { 'CN=Unknown Publisher' } else { 'CN=EnterpriseDB Test' }; return [pscustomobject]@{ Status = $status; SignerCertificate = [pscustomobject]@{ Subject = $subject } } }",
    "function Test-PostgresOptions { param([string]$optionFile)",
    "  $script:ObservedOptionDirectory = Split-Path -Parent $optionFile",
    "  $options = [System.IO.File]::ReadAllText($optionFile)",
    "  if (-not $options.Contains('superpassword=' + $script:TestPassword)) { throw 'Option file omitted its test credential.' }",
    "  if (-not $options.Contains('mode=unattended') -or -not $options.Contains('serverport=5432') -or -not $options.Contains('servicename=bigbites-pos-postgresql-x64-17')) { throw 'Option file omitted required installer settings.' }",
    "  $acl = Get-Acl -LiteralPath $script:ObservedOptionDirectory",
    "  if (-not $acl.AreAccessRulesProtected) { throw 'Option directory inherited permissions.' }",
    "  $allowedSids = @($acl.Access | Where-Object { $_.AccessControlType -eq 'Allow' } | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value })",
    "  foreach ($sid in @('S-1-5-18', 'S-1-5-32-544', [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value)) { if ($allowedSids -notcontains $sid) { throw 'Option directory ACL omitted a required trusted identity.' } }",
    "}",
    "function Start-Process { [CmdletBinding()] param([string]$FilePath, [string]$ArgumentList, [switch]$PassThru, [string]$WindowStyle); $script:InstallerExecuted = $true; if (-not (Test-Path -LiteralPath $FilePath)) { throw 'Downloaded installer was missing.' }; if ($ArgumentList -match 'Safe-Local-Test-Password-Only|--superpassword') { throw 'Password appeared in process arguments.' }; if ($ArgumentList -notmatch '^--optionfile \"([^\"]+)\"$') { throw 'Protected option-file argument was not supplied.' }; $optionFile = $Matches[1]; Test-PostgresOptions $optionFile; $exitCode = if ($script:InstallerMode -eq 'installer-exit-failure') { 17 } else { 0 }; $shouldTimeout = $script:InstallerMode -eq 'process-timeout'; return [MockInstallerProcess]::new($exitCode, $shouldTimeout) }",
    postgresPackageInstallerMatch[0],
    "try {",
    "  Install-PostgresPackage -SuperuserPassword $script:TestPassword",
    "  if ($Mode -in @('installer-exit-failure', 'process-timeout')) { throw 'Injected process failure was not propagated.' }",
    "} catch {",
    "  if ($Mode -eq 'installer-exit-failure' -and $_.Exception.Message -notmatch 'exit code 17') { throw }",
    "  if ($Mode -eq 'process-timeout' -and $_.Exception.Message -notmatch '30-minute time limit') { throw }",
    "  if ($Mode -eq 'download-failure' -and $_.Exception.Message -notmatch 'Internet access is required') { throw }",
    "  if ($Mode -eq 'download-incomplete' -and $_.Exception.Message -notmatch 'download was incomplete') { throw }",
    "  if ($Mode -eq 'signature-failure' -and $_.Exception.Message -notmatch 'failed EnterpriseDB Authenticode verification') { throw }",
    "  if ($Mode -eq 'wrong-signer' -and $_.Exception.Message -notmatch 'failed EnterpriseDB Authenticode verification') { throw }",
    "  if ($Mode -notin @('installer-exit-failure', 'process-timeout', 'download-failure', 'download-incomplete', 'signature-failure', 'wrong-signer')) { throw }",
    "}",
    "if ($Mode -in @('download-failure', 'download-incomplete', 'signature-failure', 'wrong-signer') -and $script:InstallerExecuted) { throw 'Unverified PostgreSQL package was executed.' }",
    "if ($Mode -in @('success', 'installer-exit-failure', 'process-timeout', 'signature-lock') -and -not $script:ObservedOptionDirectory) { throw 'PostgreSQL options were not inspected.' }",
    "if ($Mode -eq 'signature-lock' -and $script:SignatureAttempts -ne 3) { throw 'Transient Authenticode file lock was not retried.' }",
    "if (@(Get-ChildItem -LiteralPath $TestRoot -Directory -Filter 'bigbites-postgres-options-*').Count -ne 0) { throw 'Temporary credential directory was not removed.' }",
    "Write-Output 'POSTGRES_OPTION_FILE_TEST_PASSED'",
  ].join("\r\n");
  fs.writeFileSync(scriptPath, script, "utf8");
  context.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-TestRoot",
      testRoot,
      "-Mode",
      mode,
    ],
    { encoding: "utf8", timeout: 30000 },
  );
  if (result.error && result.error.code === "ENOENT") {
    context.skip("Windows PowerShell is unavailable; PostgreSQL credential-file test not run.");
    return;
  }
  assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
  assert.match(result.stdout || "", /POSTGRES_OPTION_FILE_TEST_PASSED/);
}

test("PostgreSQL downloader atomically finalizes complete data and removes interrupted transfers", async (context) => {
  assert.ok(postgresDownloadHelperMatch, "installer must declare Receive-PostgresInstaller");
  const powershellCheck = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", "exit 0"],
    { encoding: "utf8", timeout: 10000 },
  );
  if (powershellCheck.error && powershellCheck.error.code === "ENOENT") {
    context.skip("Windows PowerShell is unavailable; download integration test not run.");
    return;
  }

  const testRoot = createTestRoot("bigbites-postgres-download-");
  const scriptPath = path.join(testRoot, "postgres-download-test.ps1");
  const packageBytes = Buffer.alloc(2 * 1024 * 1024, 0x42);
  let retryRequests = 0;
  const server = require("node:http").createServer((request, response) => {
    if (request.url === "/retry-once" && retryRequests++ === 0) {
      response.writeHead(503, { "Content-Length": "0" });
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Length": packageBytes.length });
    if (request.url === "/interrupted") {
      response.on("error", () => {});
      response.write(packageBytes.subarray(0, packageBytes.length / 2));
      response.destroy();
      return;
    }
    response.end(packageBytes);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  const script = [
    "param([string]$TestRoot, [string]$Uri, [string]$DestinationPath, [string]$Mode)",
    "$ErrorActionPreference = 'Stop'",
    postgresDownloadHelperMatch[0],
    "if ($Mode -eq 'complete') {",
    "  Receive-PostgresInstaller -Uri $Uri -DestinationPath $DestinationPath",
    "  if ((Get-Item -LiteralPath $DestinationPath).Length -ne 2097152) { throw 'Completed download size did not match the server content length.' }",
    "  if (Test-Path -LiteralPath ($DestinationPath + '.partial')) { throw 'A partial file remained after a complete download.' }",
    "  Write-Output 'POSTGRES_DOWNLOAD_COMPLETE'",
    "} elseif ($Mode -eq 'retry') {",
    "  Receive-PostgresInstaller -Uri $Uri -DestinationPath $DestinationPath",
    "  if ((Get-Item -LiteralPath $DestinationPath).Length -ne 2097152) { throw 'Retried download size did not match the server content length.' }",
    "  if (Test-Path -LiteralPath ($DestinationPath + '.partial')) { throw 'A partial file remained after a retried download.' }",
    "  Write-Output 'POSTGRES_DOWNLOAD_RETRY_PASSED'",
    "} else {",
    "  try { Receive-PostgresInstaller -Uri $Uri -DestinationPath $DestinationPath; throw 'Interrupted download was accepted.' } catch { if ($_.Exception.Message -notmatch 'download failed or was incomplete') { throw } }",
    "  if (Test-Path -LiteralPath $DestinationPath) { throw 'Interrupted download produced an executable destination.' }",
    "  if (Test-Path -LiteralPath ($DestinationPath + '.partial')) { throw 'Interrupted download left a partial file behind.' }",
    "  Write-Output 'POSTGRES_DOWNLOAD_INTERRUPTED_SAFELY'",
    "}",
  ].join("\r\n");
  fs.writeFileSync(scriptPath, script, "utf8");

  async function runDownload(pathname, destinationName, mode) {
    const destinationPath = path.join(testRoot, destinationName);
    const uri = `http://127.0.0.1:${server.address().port}${pathname}`;
    const args = [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-TestRoot",
      testRoot,
      "-Uri",
      uri,
      "-DestinationPath",
      destinationPath,
      "-Mode",
      mode,
    ];
    return await new Promise((resolve, reject) => {
      const child = spawn("powershell.exe", args, { windowsHide: true });
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("PowerShell download integration test timed out."));
      }, 30000);
      child.stdout.setEncoding("utf8").on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.setEncoding("utf8").on("data", (chunk) => {
        stderr += chunk;
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        resolve({ code, stdout, stderr });
      });
    });
  }

  const complete = await runDownload("/complete", "complete.exe", "complete");
  assert.equal(complete.code, 0, `${complete.stdout}\n${complete.stderr}`);
  assert.match(complete.stdout, /POSTGRES_DOWNLOAD_COMPLETE/);
  assert.equal(
    crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(testRoot, "complete.exe")))
      .digest("hex"),
    crypto.createHash("sha256").update(packageBytes).digest("hex"),
  );

  const retried = await runDownload("/retry-once", "retried.exe", "retry");
  assert.equal(retried.code, 0, `${retried.stdout}\n${retried.stderr}`);
  assert.match(retried.stdout, /POSTGRES_DOWNLOAD_RETRY_PASSED/);
  assert.equal(retryRequests, 2, "transient server failure should be retried once");

  const interrupted = await runDownload(
    "/interrupted",
    "interrupted.exe",
    "interrupted",
  );
  assert.equal(interrupted.code, 0, `${interrupted.stdout}\n${interrupted.stderr}`);
  assert.match(interrupted.stdout, /POSTGRES_DOWNLOAD_INTERRUPTED_SAFELY/);
});

test("fresh Windows setup uses the bundled x64 Node runtime without Node.js or winget", (context) => {
  const bundledNode = path.join(windowsDirectory, "node-runtime", "node.exe");
  const bundledNodeLicense = path.join(
    windowsDirectory,
    "node-runtime",
    "LICENSE",
  );
  assert.ok(fs.existsSync(bundledNode), "the private Node runtime must be bundled");
  assert.ok(fs.existsSync(bundledNodeLicense), "the Node license must be bundled");
  assert.equal(
    crypto.createHash("sha256").update(fs.readFileSync(bundledNode)).digest("hex"),
    "3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237",
  );
  assert.ok(nodeRuntimeValidatorMatch, "installer must validate its private runtime");
  assert.ok(bundledNodeSelectionMatch, "installer must select its private runtime");
  assert.match(
    installer,
    /\$stagedNodePath = "\$installedNodePath\.\$\(\[guid\]::NewGuid\(\)\.ToString\('N'\)\)\.tmp\.exe"/,
  );

  const testRoot = createTestRoot("bigbites-node-less-installer-");
  const scriptPath = path.join(
    windowsDirectory,
    `.node-less-test-${process.pid}.ps1`,
  );
  const script = [
    "param([string]$TestRoot)",
    "$ErrorActionPreference = 'Stop'",
    "$env:ProgramFiles = Join-Path $TestRoot 'missing-program-files'",
    "$systemNode = Join-Path $env:ProgramFiles 'nodejs\\node.exe'",
    "if (Test-Path -LiteralPath $systemNode) { throw 'Test environment unexpectedly has a system Node runtime.' }",
    "function Get-Command { [CmdletBinding()] param([string]$Name); if ($Name -eq 'winget') { throw 'winget must not be needed by bundled Node setup.' }; throw 'Unexpected external command lookup.' }",
    nodeRuntimeValidatorMatch[0],
    bundledNodeSelectionMatch[0],
    "$nodeStageDirectory = Join-Path $TestRoot 'private-runtime'",
    "New-Item -ItemType Directory -Path $nodeStageDirectory | Out-Null",
    "$stagedNodePath = Join-Path $nodeStageDirectory 'node.exe.test.tmp.exe'",
    "Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'node-runtime\\node.exe') -Destination $stagedNodePath",
    "if (-not (Test-BigBitesNodeRuntime $stagedNodePath)) { throw 'The staged private runtime did not remain executable.' }",
    "Write-Output 'FRESH_NODELESS_WINGETLESS_RUNTIME_PASSED'",
  ].join("\r\n");
  fs.writeFileSync(scriptPath, script, "utf8");
  context.after(() => {
    fs.rmSync(scriptPath, { force: true });
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-TestRoot",
      testRoot,
    ],
    { encoding: "utf8", timeout: 60000 },
  );
  if (result.error && result.error.code === "ENOENT") {
    context.skip("Windows PowerShell is unavailable; private-runtime regression test not run.");
    return;
  }
  assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
  assert.match(result.stdout || "", /FRESH_NODELESS_WINGETLESS_RUNTIME_PASSED/);
});

function createPowerShellHarness(sourceRoot, serverRoot, options = {}) {
  const scriptPath = path.join(
    path.dirname(serverRoot),
    "staging-test-harness.ps1",
  );
  const functions = stagingHelperMatch[0];
  const redirectMock = options.redirectTarget
    ? `
$script:CopyAttempted = $false
function Copy-Item {
  param(
    [string]$LiteralPath,
    [string]$Destination,
    [switch]$Recurse,
    [switch]$Force,
    [string]$ErrorAction
  )
  if (-not $script:CopyAttempted) {
    $script:CopyAttempted = $true
    $stageDirectory = Split-Path -Parent $Destination
    Remove-Item -LiteralPath $stageDirectory -Force -ErrorAction Stop
    $linkResult = & cmd.exe /d /c "mklink /J \`"$stageDirectory\`" \`"$RedirectTarget\`""
    if ($LASTEXITCODE -ne 0) { throw "Test junction creation failed." }
    throw "Injected copy failure after redirecting the staging path."
  }
  Microsoft.PowerShell.Management\\Copy-Item @PSBoundParameters
}
`
    : "";
  const copyFailureMock = options.failCopy
    ? `
$script:StagedCopyCount = 0
function Copy-Item {
  param(
    [string]$LiteralPath,
    [string]$Destination,
    [switch]$Recurse,
    [switch]$Force,
    [string]$ErrorAction
  )
  $script:StagedCopyCount++
  if ($script:StagedCopyCount -eq 2) {
    throw "Injected staged file-copy failure."
  }
  Microsoft.PowerShell.Management\\Copy-Item @PSBoundParameters
}
`
    : "";
  const aclOwnerMock = options.aclOwnerSid
    ? `
$script:TestAcl = New-Object System.Security.AccessControl.DirectorySecurity
$script:TestAcl.SetOwner((New-Object System.Security.Principal.SecurityIdentifier($AclOwnerSid)))
function Get-Acl {
  [CmdletBinding()]
  param([string]$LiteralPath)
  return $script:TestAcl
}
`
    : "";
  const aclOwnerSetup =
    options.aclOwnerSid === "CURRENT"
      ? "$AclOwnerSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value"
      : "";
  const temporaryRootAclSetup = `
function Set-TestServerRootAcl {
  param([string]$Path)
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
  Set-Acl -LiteralPath $Path -AclObject $security -ErrorAction Stop
}
`;
  const script = [
    "param([string]$SourcePath, [string]$ServerRoot, [string]$RedirectTarget, [string]$InspectionPath, [string]$AclOwnerSid, [string]$AclOwnerPath, [string]$Mode, [string]$DatabaseCreatedByAttempt, [string]$DatabaseState, [string]$AppliedMigrations, [string]$PreviousPayloadId, [string]$NewPayloadId, [string]$StatePath, [string]$MigrationPath, [string]$ExpectedChecksum, [string]$MigrationName, [string]$MigrationChecksum)",
    "$ErrorActionPreference = 'Stop'",
    "$databaseName = 'bigbites_client_local_delivery_20261027'",
    functions,
    redirectMock,
    copyFailureMock,
    aclOwnerSetup,
    aclOwnerMock,
    temporaryRootAclSetup,
    "if ($Mode -eq 'database-gate') {",
    "  $applied = @($AppliedMigrations -split ',' | Where-Object { $_ } | ForEach-Object { ($_ -split '\\|', 2)[0] })",
    "  $expected = @($MigrationName)",
    "  Assert-FreshDatabaseMigrationGate -DatabaseCreatedByAttempt ([bool]::Parse($DatabaseCreatedByAttempt)) -DatabaseState $DatabaseState -AppliedMigrations $applied -ExpectedMigrations $expected -MigrationName $MigrationName -MigrationChecksum $MigrationChecksum",
    "  Write-Output 'DATABASE_GATE_PASSED'",
    "  exit 0",
    "}",
    "if ($Mode -eq 'netstat-port-parser') {",
    "  $tcp = @(ConvertFrom-BigBitesNetstatListeners -Protocol TCP -LocalPort 3000 -Lines @('TCP 0.0.0.0:3000 0.0.0.0:0 LISTENING 1234', 'TCP [::]:3000 [::]:0 LISTENING 1234', 'TCP 127.0.0.1:3000 192.0.2.10:80 ESTABLISHED 9876', 'TCP 0.0.0.0:3001 0.0.0.0:0 LISTENING 5678'))",
    "  $udp = @(ConvertFrom-BigBitesNetstatListeners -Protocol UDP -LocalPort 3001 -Lines @('UDP 0.0.0.0:3001 *:* 4321', 'UDP [::]:3001 *:* 4321', 'UDP 0.0.0.0:3002 *:* 8765'))",
    "  if ($tcp.Count -ne 2 -or @($tcp | Select-Object -ExpandProperty OwningProcess -Unique).Count -ne 1 -or $tcp[0].OwningProcess -ne 1234) { throw 'TCP netstat listener parsing failed.' }",
    "  if ($udp.Count -ne 2 -or @($udp | Select-Object -ExpandProperty OwningProcess -Unique).Count -ne 1 -or $udp[0].OwningProcess -ne 4321) { throw 'UDP netstat listener parsing failed.' }",
    "  Write-Output 'NETSTAT_PORT_PARSER_PASSED'",
    "  exit 0",
    "}",
    "if ($Mode -eq 'netstat-provider-fallback') {",
    "  function Get-NetTCPConnection { throw 'Injected missing TCP endpoint CIM provider.' }",
    "  function Get-NetUDPEndpoint { throw 'Injected missing UDP endpoint CIM provider.' }",
    "  $tcpPort = 5432",
    "  $udpPort = 3001",
    "  $expectedTcpOutput = & (Join-Path $env:SystemRoot 'System32\\netstat.exe') -ano -p tcp 2>&1",
    "  $expectedUdpOutput = & (Join-Path $env:SystemRoot 'System32\\netstat.exe') -ano -p udp 2>&1",
    "  $expectedTcp = @(ConvertFrom-BigBitesNetstatListeners -Protocol TCP -LocalPort $tcpPort -Lines @($expectedTcpOutput) | Select-Object -ExpandProperty OwningProcess -Unique | Sort-Object)",
    "  $expectedUdp = @(ConvertFrom-BigBitesNetstatListeners -Protocol UDP -LocalPort $udpPort -Lines @($expectedUdpOutput) | Select-Object -ExpandProperty OwningProcess -Unique | Sort-Object)",
    "  $actualTcp = @(Get-BigBitesPortListeners -Protocol TCP -LocalPort $tcpPort | Select-Object -ExpandProperty OwningProcess -Unique | Sort-Object)",
    "  $actualUdp = @(Get-BigBitesPortListeners -Protocol UDP -LocalPort $udpPort | Select-Object -ExpandProperty OwningProcess -Unique | Sort-Object)",
    "  if (($expectedTcp -join ',') -ne ($actualTcp -join ',') -or ($expectedUdp -join ',') -ne ($actualUdp -join ',')) { throw 'CIM-provider fallback did not match netstat listener owners.' }",
    "  Write-Output 'NETSTAT_PROVIDER_FALLBACK_PASSED'",
    "  exit 0",
    "}",
    "if ($Mode -eq 'migration-bytes') {",
    "  try {",
    "    $bytes = Get-VerifiedClientBaselineMigrationBytes -Path $MigrationPath -ExpectedChecksum $ExpectedChecksum",
    "    Write-Output ('MIGRATION_BYTES=' + [Convert]::ToBase64String($bytes))",
    "    exit 0",
    "  } catch {",
    "    [Console]::Error.WriteLine($_.Exception.Message)",
    "    exit 20",
    "  }",
    "}",
    "if ($Mode -eq 'state-before-database' -or $Mode -eq 'state-after-database') {",
    "  $state = @{ version = 1; attemptId = '0123456789abcdef0123456789abcdef'; status = 'in-progress'; roleCreationStarted = $true; roleCreatedByAttempt = $true; databaseCreationStarted = ($Mode -eq 'state-after-database'); databaseCreatedByAttempt = ($Mode -eq 'state-after-database') }",
    "  Save-InstallState -State $state -StatePath $StatePath",
    "  $state.status = 'in-progress'",
    "  Save-InstallState -State $state -StatePath $StatePath",
    "  Write-Output (Get-Content -LiteralPath $StatePath -Raw)",
    "  exit 0",
    "}",
    "if ($Mode -eq 'repeat-install') {",
    "  Set-ActiveServerPayload -ServerRoot $ServerRoot -PayloadId $NewPayloadId",
    "  Set-ActiveServerPayload -ServerRoot $ServerRoot -PayloadId $NewPayloadId",
    "  $state = @{ version = 1; attemptId = '0123456789abcdef0123456789abcdef'; status = 'completed'; roleCreationStarted = $true; roleCreatedByAttempt = $true; databaseCreationStarted = $true; databaseCreatedByAttempt = $true }",
    "  Save-InstallState -State $state -StatePath $StatePath",
    "  Save-InstallState -State $state -StatePath $StatePath",
    "  Write-Output 'REPEAT_INSTALL_PASSED'",
    "  exit 0",
    "}",
    "if ($Mode -eq 'recovery') {",
    "  $serverDir = $ServerRoot",
    "  $script:serverStopped = $true",
    "  $script:activationAttempted = $true",
    "  $script:previousServerRestartSafe = $true",
    "  $script:previousPayloadId = $PreviousPayloadId",
    "  $script:activePayloadId = $NewPayloadId",
    "  $script:RecoveryTaskStarts = 0",
    "  function Stop-ExistingServer { }",
    "  $taskName = 'BigBitesPosServer'",
    "  function Get-ScheduledTask { param($TaskName, $TaskPath, $ErrorAction); return [pscustomobject]@{ TaskName = 'BigBitesPosServer'; TaskPath = '\\' } }",
    "  function Start-ScheduledTask { param($TaskName, $ErrorAction); $script:RecoveryTaskStarts++ }",
    "  function Start-Sleep { param([int]$Seconds) }",
    "  function Invoke-RestMethod { param($Uri, $TimeoutSec); return [pscustomobject]@{ status = 'OK'; database = 'Connected' } }",
    "  Restore-PreviousServerAfterFailure",
    "  if ([System.IO.File]::ReadAllText((Join-Path $ServerRoot 'active-payload.txt')).Trim() -ne $PreviousPayloadId -or $script:RecoveryTaskStarts -ne 1) { throw 'Previous payload/service recovery did not complete.' }",
    "  Write-Output 'RECOVERY_PASSED'",
    "  exit 0",
    "}",
    "if ($Mode -eq 'recovery-unsafe') {",
    "  $serverDir = $ServerRoot",
    "  $script:serverStopped = $true",
    "  $script:activationAttempted = $true",
    "  $script:previousServerRestartSafe = $false",
    "  $script:previousPayloadId = $PreviousPayloadId",
    "  $script:activePayloadId = $NewPayloadId",
    "  $script:RecoveryTaskStarts = 0",
    "  $taskName = 'BigBitesPosServer'",
    "  function Stop-ExistingServer { }",
    "  function Start-ScheduledTask { param($TaskName, $ErrorAction); $script:RecoveryTaskStarts++ }",
    "  Restore-PreviousServerAfterFailure",
    "  if ([System.IO.File]::ReadAllText((Join-Path $ServerRoot 'active-payload.txt')).Trim() -ne $PreviousPayloadId -or $script:RecoveryTaskStarts -ne 0 -or -not $script:serverStopped) { throw 'Unsafe database recovery did not retain the previous payload without restarting it.' }",
    "  Write-Output 'RECOVERY_UNSAFE_PASSED'",
    "  exit 0",
    "}",
    "try {",
    "  if ($InspectionPath) {",
    "    Assert-NoBigBitesReparsePoints -Path $InspectionPath",
    "    Write-Output 'INSPECTION_PASSED'",
    "    exit 0",
    "  }",
    "  if ($AclOwnerPath) {",
    "    Assert-BigBitesRestrictedAcl -Path $AclOwnerPath",
    "    Write-Output 'ACL_OWNER_ACCEPTED'",
    "    exit 0",
    "  }",
    "  Set-TestServerRootAcl -Path $ServerRoot",
    "  $stagedPath = Stage-ServerPayload -SourcePath $SourcePath -ServerRoot $ServerRoot",
    "  Assert-BigBitesRestrictedAcl -Path (Join-Path $ServerRoot '.staging') -RequireProtected",
    "  Write-Output ('STAGED=' + $stagedPath)",
    "  exit 0",
    "} catch {",
    "  [Console]::Error.WriteLine($_.Exception.Message)",
    "  exit 20",
    "}",
  ].join("\r\n");
  fs.writeFileSync(scriptPath, script, "utf8");
  return scriptPath;
}

function invokeStagingHarness(sourceRoot, serverRoot, options = {}) {
  const scriptPath = createPowerShellHarness(sourceRoot, serverRoot, options);
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-SourcePath",
      sourceRoot,
      "-ServerRoot",
      serverRoot,
      "-RedirectTarget",
      options.redirectTarget || "",
      "-InspectionPath",
      options.inspectionPath || "",
      "-AclOwnerSid",
      options.aclOwnerSid || "",
      "-AclOwnerPath",
      options.aclOwnerPath || "",
      "-Mode",
      options.mode || "",
      "-DatabaseCreatedByAttempt",
      options.databaseCreatedByAttempt === undefined
        ? "false"
        : String(options.databaseCreatedByAttempt),
      "-DatabaseState",
      options.databaseState || "",
      "-AppliedMigrations",
      options.appliedMigrations || "",
      "-PreviousPayloadId",
      options.previousPayloadId || "",
      "-NewPayloadId",
      options.newPayloadId || "",
      "-StatePath",
      options.statePath || "",
      "-MigrationPath",
      options.migrationPath || "",
      "-ExpectedChecksum",
      options.expectedChecksum || "",
      "-MigrationName",
      options.migrationName || "20261027220000_initial_client_pos",
      "-MigrationChecksum",
      options.migrationChecksum ||
        "af32ea70140e6f3de8f416b2ad8b40a798cc18551b5af8483ba701de6a1b403a",
    ],
    { encoding: "utf8", timeout: 30000 },
  );
  if (result.error && result.error.code === "ENOENT") {
    return { unavailable: true, output: "" };
  }
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    output: `${result.stdout || ""}\n${result.stderr || ""}`,
  };
}

function removeTemporaryRoot(root) {
  const stagingRoot = path.join(root, "server", ".staging");
  if (fs.existsSync(stagingRoot)) {
    for (const entry of fs.readdirSync(stagingRoot)) {
      const entryPath = path.join(stagingRoot, entry);
      if (fs.lstatSync(entryPath).isSymbolicLink()) {
        try {
          fs.rmdirSync(entryPath);
        } catch {}
      }
    }
  }
  const stagingPath = path.join(root, "server", ".staging");
  if (fs.existsSync(stagingPath) && fs.lstatSync(stagingPath).isSymbolicLink()) {
    try {
      fs.rmdirSync(stagingPath);
    } catch {}
  }
  fs.rmSync(root, { recursive: true, force: true });
}

test("local database URL safely encodes reserved password characters and preserves the expected target", (context) => {
  assert.ok(localDatabaseUrlBuilderMatch, "installer must validate the local database URL");
  const testRoot = createTestRoot("bigbites-database-url-");
  const scriptPath = path.join(testRoot, "database-url-test.ps1");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    localDatabaseUrlBuilderMatch[0],
    "$databaseName = 'bigbites_client_local_delivery_20261027'",
    "$legacyUrl = \"postgresql://bigbites_client_delivery_app:SafeTestPassword@127.0.0.1:5432/$databaseName?schema=public\"",
    "if (([Uri]$legacyUrl).AbsolutePath -cne '/=public') { throw 'The previous interpolation failure was not reproduced.' }",
    "$password = 'SafeTest:@/?#%+&=Password'",
    "$url = New-LocalDatabaseUrl -Password $password -DatabaseName 'bigbites_client_local_delivery_20261027'",
    "$uri = [Uri]$url",
    "$userInfo = $uri.UserInfo -split ':', 2",
    "if ([Uri]::UnescapeDataString($userInfo[1]) -cne $password) { throw 'The database URL changed its password.' }",
    "if ([Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/')) -cne 'bigbites_client_local_delivery_20261027') { throw 'The database URL changed its database name.' }",
    "if ($uri.Query -cne '?schema=public') { throw 'The database URL changed its schema.' }",
    "Write-Output 'LOCAL_DATABASE_URL_VALIDATION_PASSED'",
  ].join("\r\n");
  fs.writeFileSync(scriptPath, script, "utf8");
  context.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
    { encoding: "utf8", timeout: 10000 },
  );
  if (result.error && result.error.code === "ENOENT") {
    context.skip("Windows PowerShell is unavailable; local database URL test not run.");
    return;
  }
  assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
  assert.match(result.stdout || "", /LOCAL_DATABASE_URL_VALIDATION_PASSED/);
});

test("installer-owned retry repairs only the known PowerShell interpolation URL after ownership verification", (context) => {
  assert.match(installer, /\$isKnownPowerShellInterpolationFailure = \([\s\S]*?\$isResumingInstall[\s\S]*?\$installState\.roleCreatedByAttempt[\s\S]*?\$installState\.databaseCreatedByAttempt[\s\S]*?\$existingDatabaseName -ceq "=public"[\s\S]*?\[string\]::IsNullOrEmpty\(\$existingDatabaseUri\.Query\)/);
  assert.match(installer, /if \(\$script:repairLocalDatabaseUrlOnRetry\)[\s\S]*?Set-LocalDatabaseUrlInEnvironment[\s\S]*?The installation-owned database and role were verified/);
  assert.ok(localDatabaseUrlEnvironmentWriterMatch, "installer must replace its local database URL atomically");
  const testRoot = createTestRoot("bigbites-database-config-repair-");
  const scriptPath = path.join(testRoot, "database-config-repair-test.ps1");
  const envPath = path.join(testRoot, ".env");
  fs.writeFileSync(
    envPath,
    "DATABASE" + "_URL=postgresql://bigbites_client_delivery_app:old@127.0.0.1:5432/=public\r\nAUTH_SECRET" + "=keep-this-line\r\n",
    "ascii",
  );
  const script = [
    "$ErrorActionPreference = 'Stop'",
    localDatabaseUrlEnvironmentWriterMatch[0],
    "$newUrl = 'postgresql://bigbites_client_delivery_app:encoded@127.0.0.1:5432/bigbites_client_local_delivery_20261027?schema=public'",
    `Set-LocalDatabaseUrlInEnvironment -Path '${envPath.replace(/'/g, "''")}' -DatabaseUrl $newUrl`,
    `$lines = [System.IO.File]::ReadAllLines('${envPath.replace(/'/g, "''")}')`,
    "if ($lines.Count -ne 2 -or $lines[0] -cne (('DATABASE' + '_URL=') + $newUrl) -or $lines[1] -cne ('AUTH_SECRET' + '=keep-this-line')) { throw 'The local config repair changed unrelated settings.' }",
    "Write-Output 'OWNED_DATABASE_URL_REPAIR_TEST_PASSED'",
  ].join("\r\n");
  fs.writeFileSync(scriptPath, script, "utf8");
  context.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
    { encoding: "utf8", timeout: 10000 },
  );
  if (result.error && result.error.code === "ENOENT") {
    context.skip("Windows PowerShell is unavailable; config repair test not run.");
    return;
  }
  assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
  assert.match(result.stdout || "", /OWNED_DATABASE_URL_REPAIR_TEST_PASSED/);
});

test("Prisma resolves the configured local database and public schema from the installer URL", () => {
  const prismaCli = path.join(serverDirectory, "node_modules", "prisma", "build", "index.js");
  assert.ok(fs.existsSync(prismaCli), "Prisma CLI must be present for URL parsing regression coverage");
  const result = spawnSync(
    process.execPath,
    [prismaCli, "migrate", "deploy", "--schema", "prisma/schema.prisma"],
    {
      cwd: serverDirectory,
      encoding: "utf8",
      timeout: 60000,
      env: {
        DATABASE_URL: "postgresql://bigbites_client_delivery_app:SafeTestPasswordNoReservedChars@127.0.0.1:1/bigbites_client_local_delivery_20261027?schema=public",
        PGOPTIONS: "-c statement_timeout=300000 -c lock_timeout=30000",
        TEMP: os.tmpdir(),
        TMP: os.tmpdir(),
      },
    },
  );
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  assert.equal(result.status, 1, output);
  assert.match(output, /PostgreSQL database "bigbites_client_local_delivery_20261027", schema "public" at "127\.0\.0\.1:1"/);
  assert.match(output, /P1001: Can't reach database server/);
  assert.doesNotMatch(output, /database "=public"/);
});

test("backend staging helper declares a complete package and Prisma validation contract", () => {
  const { helper, files } = getStagingManifest();
  const stageFunction = getStageFunction();
  assert.ok(
    (installer.match(/Stage-ServerPayload/g) || []).length > 1,
    "the validated staging helper must be used by the installer",
  );
  assert.ok(installer.indexOf("Stage-ServerPayload `") < stopExistingServerCall);
  assert.match(installer, /Set-ActiveServerPayload[\s\S]*?\$script:activePayloadId/);
  assert.ok(files.includes("dist\\server.js"));
  assert.ok(files.includes("prisma\\schema.prisma"));
  assert.ok(files.includes("prisma.config.ts"));
  assert.ok(
    files.includes(
      "prisma\\client-migrations\\20261027220000_initial_client_pos\\migration.sql",
    ),
  );
  assert.ok(files.includes("node_modules\\.prisma\\client\\index.js"));
  assert.ok(files.includes("node_modules\\prisma\\build\\index.js"));
  assert.match(helper, /Copy-Item[\s\S]*?Join-Path \$SourcePath \$directory/);
  assert.match(helper, /ConvertFrom-Json -ErrorAction Stop/);
  assert.match(helper, /node_modules\\@prisma\\client\\package\.json/);
  assert.match(helper, /node_modules\\@prisma\\engines/);
  assert.match(helper, /GetFinalPathNameByHandle/);
  assert.match(helper, /GetFileInformationByHandle/);
  assert.match(helper, /Assert-NoBigBitesReparsePointsInTree/);
  assert.match(helper, /Set-BigBitesStagingRootAcl -Path \$resolvedStagingRoot/);
  assert.match(helper, /Assert-BigBitesRestrictedAcl -Path \$ServerRoot -RequireProtected/);
  assert.match(helper, /\$acl\.GetOwner\([\s\S]*?SecurityIdentifier/);
  assert.match(helper, /untrusted owner SID/i);
  assert.doesNotMatch(stageFunction, /\$envFile|\$serverLogs|\bbackups\b/i);
  assert.doesNotMatch(
    stageFunction,
    /\b(?:Register-ScheduledTask|Unregister-ScheduledTask|Stop-ScheduledTask|New-NetFirewallRule|Remove-NetFirewallRule|psql|migrate deploy)\b/i,
  );
});

test("ACL validation accepts the invoking identity as owner", (context) => {
  const fixtureRoot = createTestRoot("bigbites-acl-trusted-owner-");
  context.after(() => removeTemporaryRoot(fixtureRoot));
  const result = invokeStagingHarness("", fixtureRoot, {
    aclOwnerSid: "CURRENT",
    aclOwnerPath: fixtureRoot,
  });
  if (result.unavailable) {
    context.skip("Windows PowerShell is unavailable; synthetic ACL owner test not run.");
    return;
  }
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /ACL_OWNER_ACCEPTED/);
});

test("ACL validation rejects an untrusted owner SID", (context) => {
  const fixtureRoot = createTestRoot("bigbites-acl-untrusted-owner-");
  context.after(() => removeTemporaryRoot(fixtureRoot));
  const result = invokeStagingHarness("", fixtureRoot, {
    aclOwnerSid: "S-1-5-21-111111111-222222222-333333333-4444",
    aclOwnerPath: fixtureRoot,
  });
  if (result.unavailable) {
    context.skip("Windows PowerShell is unavailable; synthetic ACL owner test not run.");
    return;
  }
  assert.equal(result.status, 20);
  assert.match(result.output, /untrusted owner SID/i);
});

test("stage helper copies a valid payload without changing active or user data", (context) => {
  const { files, directories } = getStagingManifest();
  const fixtureRoot = createTestRoot("bigbites-stage-success-");
  const sourceRoot = path.join(fixtureRoot, "package");
  const serverRoot = path.join(fixtureRoot, "server");
  context.after(() => removeTemporaryRoot(fixtureRoot));
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(serverRoot, { recursive: true });
  createStagingFixture(sourceRoot, files, directories);
  fs.mkdirSync(path.join(serverRoot, "dist"), { recursive: true });
  fs.writeFileSync(path.join(serverRoot, "dist", "server.js"), "active");
  fs.writeFileSync(path.join(serverRoot, ".env"), "preserve-config");
  fs.mkdirSync(path.join(serverRoot, "logs"));
  fs.writeFileSync(path.join(serverRoot, "logs", "sentinel.log"), "preserve-log");
  fs.mkdirSync(path.join(serverRoot, "backups"));
  fs.writeFileSync(path.join(serverRoot, "backups", "sentinel.dump"), "preserve-backup");
  fs.mkdirSync(path.join(serverRoot, "postgres-data"));
  fs.writeFileSync(
    path.join(serverRoot, "postgres-data", "sentinel"),
    "preserve-database-data",
  );
  const result = invokeStagingHarness(sourceRoot, serverRoot);
  if (result.unavailable) {
    context.skip("Windows PowerShell is unavailable; helper runtime test not run.");
    return;
  }
  assert.equal(result.status, 0, result.output);
  const stagedPath = result.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith("STAGED="))
    ?.slice("STAGED=".length);
  assert.ok(stagedPath);
  assert.equal(
    path.dirname(stagedPath),
    path.join(serverRoot, ".staging"),
  );
  for (const file of files) {
    assert.equal(
      fs.existsSync(path.join(stagedPath, ...file.split(/[\\/]/))),
      true,
      `staged payload missing ${file}`,
    );
  }
  assert.equal(fs.readFileSync(path.join(serverRoot, "dist", "server.js"), "utf8"), "active");
  assert.equal(fs.readFileSync(path.join(serverRoot, ".env"), "utf8"), "preserve-config");
  assert.equal(fs.readFileSync(path.join(serverRoot, "logs", "sentinel.log"), "utf8"), "preserve-log");
  assert.equal(fs.readFileSync(path.join(serverRoot, "backups", "sentinel.dump"), "utf8"), "preserve-backup");
  assert.equal(
    fs.readFileSync(path.join(serverRoot, "postgres-data", "sentinel"), "utf8"),
    "preserve-database-data",
  );
});

test("missing staged payload file fails and cleans only its operation directory", (context) => {
  const { files, directories } = getStagingManifest();
  const fixtureRoot = createTestRoot("bigbites-stage-missing-");
  const sourceRoot = path.join(fixtureRoot, "package");
  const serverRoot = path.join(fixtureRoot, "server");
  context.after(() => removeTemporaryRoot(fixtureRoot));
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(serverRoot, { recursive: true });
  createStagingFixture(sourceRoot, files, directories);
  fs.rmSync(path.join(sourceRoot, "dist", "server.js"));
  const stagingRoot = path.join(serverRoot, ".staging");
  fs.mkdirSync(stagingRoot);
  fs.mkdirSync(path.join(stagingRoot, "sibling"));
  fs.writeFileSync(path.join(stagingRoot, "sibling", "keep.txt"), "keep");
  const result = invokeStagingHarness(sourceRoot, serverRoot);
  if (result.unavailable) {
    context.skip("Windows PowerShell is unavailable; helper runtime test not run.");
    return;
  }
  assert.equal(result.status, 20);
  assert.match(result.output, /required staged server file is missing/);
  assert.deepEqual(fs.readdirSync(stagingRoot), ["sibling"]);
  assert.equal(fs.readFileSync(path.join(stagingRoot, "sibling", "keep.txt"), "utf8"), "keep");
});

test("copy failure removes its operation directory and preserves sibling data", (context) => {
  const { files, directories } = getStagingManifest();
  const fixtureRoot = createTestRoot("bigbites-stage-copy-failure-");
  const sourceRoot = path.join(fixtureRoot, "package");
  const serverRoot = path.join(fixtureRoot, "server");
  context.after(() => removeTemporaryRoot(fixtureRoot));
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(serverRoot, { recursive: true });
  createStagingFixture(sourceRoot, files, directories);
  const stagingRoot = path.join(serverRoot, ".staging");
  fs.mkdirSync(stagingRoot, { recursive: true });
  fs.mkdirSync(path.join(stagingRoot, "sibling"));
  fs.writeFileSync(path.join(stagingRoot, "sibling", "keep.txt"), "keep");
  const result = invokeStagingHarness(sourceRoot, serverRoot, {
    failCopy: true,
  });
  if (result.unavailable) {
    context.skip("Windows PowerShell is unavailable; helper runtime test not run.");
    return;
  }
  assert.equal(result.status, 20);
  assert.match(result.output, /Injected staged file-copy failure/);
  assert.deepEqual(fs.readdirSync(stagingRoot), ["sibling"]);
  assert.equal(fs.readFileSync(path.join(stagingRoot, "sibling", "keep.txt"), "utf8"), "keep");
});

test("the client baseline is blocked for a database not created by this install", (context) => {
  const fixtureRoot = createTestRoot("bigbites-existing-database-gate-");
  const serverRoot = path.join(fixtureRoot, "server");
  const databaseFixture = path.join(fixtureRoot, "database-state.txt");
  context.after(() => removeTemporaryRoot(fixtureRoot));
  fs.mkdirSync(serverRoot, { recursive: true });
  fs.writeFileSync(databaseFixture, "existing-business-data");

  const result = invokeStagingHarness("", serverRoot, {
    mode: "database-gate",
    databaseCreatedByAttempt: false,
    databaseState: "bigbites_client_local_delivery_20261027|127.0.0.1|5432|12|present",
  });
  if (result.unavailable) {
    context.skip("Windows PowerShell is unavailable; database-gate fixture not run.");
    return;
  }
  assert.notEqual(result.status, 0, result.output);
  assert.match(
    result.output.replace(/\s+/g, " "),
    /installation attempt did not create the database/,
  );
  assert.equal(fs.readFileSync(databaseFixture, "utf8"), "existing-business-data");
});

test("netstat fallback identifies TCP listeners and UDP endpoints by local port and owner", (context) => {
  const fixtureRoot = createTestRoot("bigbites-netstat-port-fallback-");
  const serverRoot = path.join(fixtureRoot, "server");
  context.after(() => removeTemporaryRoot(fixtureRoot));
  fs.mkdirSync(serverRoot, { recursive: true });

  const result = invokeStagingHarness("", serverRoot, {
    mode: "netstat-port-parser",
  });
  if (result.unavailable) {
    context.skip("Windows PowerShell is unavailable; netstat fallback fixture not run.");
    return;
  }
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /NETSTAT_PORT_PARSER_PASSED/);
});

test("missing network endpoint CIM providers fall back to netstat without changing host state", (context) => {
  const fixtureRoot = createTestRoot("bigbites-netstat-provider-fallback-");
  const serverRoot = path.join(fixtureRoot, "server");
  context.after(() => removeTemporaryRoot(fixtureRoot));
  fs.mkdirSync(serverRoot, { recursive: true });

  const result = invokeStagingHarness("", serverRoot, {
    mode: "netstat-provider-fallback",
  });
  if (result.unavailable) {
    context.skip("Windows PowerShell is unavailable; netstat provider fallback fixture not run.");
    return;
  }
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /NETSTAT_PROVIDER_FALLBACK_PASSED/);
});

test("fresh setup verifies the stock-free client baseline migration", (context) => {
  const fixtureRoot = createTestRoot("bigbites-fresh-database-gate-");
  const serverRoot = path.join(fixtureRoot, "server");
  context.after(() => removeTemporaryRoot(fixtureRoot));
  fs.mkdirSync(serverRoot, { recursive: true });

  const result = invokeStagingHarness("", serverRoot, {
    mode: "database-gate",
    databaseCreatedByAttempt: true,
    databaseState: "bigbites_client_local_delivery_20261027|127.0.0.1|5432|0|absent",
  });
  if (result.unavailable) {
    context.skip("Windows PowerShell is unavailable; database-gate fixture not run.");
    return;
  }
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /DATABASE_GATE_PASSED/);

  const resolvedRetry = invokeStagingHarness("", serverRoot, {
    mode: "database-gate",
    databaseCreatedByAttempt: true,
    databaseState: "bigbites_client_local_delivery_20261027|127.0.0.1|5432|0|present",
    appliedMigrations:
      "20261027220000_initial_client_pos|af32ea70140e6f3de8f416b2ad8b40a798cc18551b5af8483ba701de6a1b403a",
  });
  assert.equal(resolvedRetry.status, 0, resolvedRetry.output);

  for (const gateOverride of [
    { migrationName: "20261020101500_remove_product_stock" },
    { migrationChecksum: "invalid" },
  ]) {
    const rejected = invokeStagingHarness("", serverRoot, {
      mode: "database-gate",
      databaseCreatedByAttempt: true,
      databaseState: "bigbites_client_local_delivery_20261027|127.0.0.1|5432|0|absent",
      ...gateOverride,
    });
    assert.notEqual(rejected.status, 0, rejected.output);
    assert.match(
      rejected.output.replace(/\s+/g, " "),
      /does not match the packaged local-client baseline identity and checksum/,
    );
  }
});

test("client initialization writes a unique menu import report and restores its environment", () => {
  assert.match(
    initializer,
    /menu-import-report-\{0\}\.json[\s\S]*?BIGBITES_MENU_IMPORT_REPORT = \$menuImportReportPath/,
  );
  assert.match(
    initializer,
    /\$previousMenuImportReportPath = \$env:BIGBITES_MENU_IMPORT_REPORT/,
  );
  assert.match(
    initializer,
    /\$env:BIGBITES_MENU_IMPORT_REPORT = \$previousMenuImportReportPath/,
  );
});

test("fresh migration gate resumes an installation-created database with package history", (context) => {
  const fixtureRoot = createTestRoot("bigbites-partial-database-gate-");
  const serverRoot = path.join(fixtureRoot, "server");
  context.after(() => removeTemporaryRoot(fixtureRoot));
  fs.mkdirSync(serverRoot, { recursive: true });

  const resumable = invokeStagingHarness("", serverRoot, {
    mode: "database-gate",
    databaseCreatedByAttempt: true,
    databaseState: "bigbites_client_local_delivery_20261027|127.0.0.1|5432|3|present",
    appliedMigrations:
      "20261027220000_initial_client_pos|af32ea70140e6f3de8f416b2ad8b40a798cc18551b5af8483ba701de6a1b403a",
  });
  if (resumable.unavailable) {
    context.skip("Windows PowerShell is unavailable; database-gate fixture not run.");
    return;
  }
  assert.equal(resumable.status, 0, resumable.output);
  assert.match(resumable.output, /DATABASE_GATE_PASSED/);

  const untrackedObjects = invokeStagingHarness("", serverRoot, {
    mode: "database-gate",
    databaseCreatedByAttempt: true,
    databaseState: "bigbites_client_local_delivery_20261027|127.0.0.1|5432|3|absent",
  });
  assert.notEqual(untrackedObjects.status, 0, untrackedObjects.output);
  assert.match(untrackedObjects.output, /without a migration ledger/);
});

test("every fresh database migration-gate call supplies the expected package migration set", () => {
  const calls = [
    ...installer.matchAll(/Assert-FreshDatabaseMigrationGate `([\s\S]*?)(?=\r?\n\s*if \(\$script:repairLocalDatabaseUrlOnRetry\)|\r?\n\s*\}\s*\r?\n\s*finally|\r?\n\s*\})/g),
  ];
  assert.equal(calls.length, 2, "both preflight retry and fresh database paths must gate migrations");
  for (const [index, call] of calls.entries()) {
    assert.match(
      call[1],
      /-ExpectedMigrations \$[A-Za-z][A-Za-z0-9_]*/,
      `migration gate call ${index + 1} must supply the mandatory expected migration list`,
    );
  }
  assert.match(
    installer,
    /\$preflightExpectedMigrations = @\([\s\S]*?\$inventoryRemovalSourceMigrationName[\s\S]*?\$inventoryRemovalMigrationName[\s\S]*?\)[\s\S]*?ConvertTo-FreshDatabaseMigrationNames `[\s\S]*?-ExpectedMigrations \$preflightExpectedMigrations[\s\S]*?Assert-FreshDatabaseMigrationGate `[\s\S]*?-AppliedMigrations \$preflightFreshAppliedMigrations/,
  );
});

test("preflight migration ledger entries are parsed before the retry gate", (context) => {
  assert.ok(
    freshMigrationNamesConverterMatch,
    "installer must parse migration names and checksums from ledger entries",
  );
  assert.match(
    installer,
    /\$preflightFreshAppliedOutput[\s\S]*?\$preflightFreshAppliedEntries = @\([\s\S]*?ConvertTo-FreshDatabaseMigrationNames `[\s\S]*?-MigrationEntries \$preflightFreshAppliedEntries/,
  );

  const testRoot = createTestRoot("bigbites-migration-ledger-parser-");
  const scriptPath = path.join(testRoot, "migration-ledger-parser.ps1");
  context.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const script = [
    "$ErrorActionPreference = 'Stop'",
    freshMigrationNamesConverterMatch[0],
    "$checksum = 'af32ea70140e6f3de8f416b2ad8b40a798cc18551b5af8483ba701de6a1b403a'",
    "$expected = @('20261027220000_initial_client_pos')",
    "$names = @(ConvertTo-FreshDatabaseMigrationNames -MigrationEntries @('20261027220000_initial_client_pos|' + $checksum) -ExpectedMigrations $expected -InventoryRemovalMigrationName '20261027220000_initial_client_pos' -InventoryRemovalSourceMigrationName '20261027220000_initial_client_pos' -InventoryRemovalMigrationChecksum $checksum -InventoryRemovalSafeMigrationChecksum $checksum)",
    "if ($names.Count -ne 1 -or $names[0] -cne '20261027220000_initial_client_pos') { throw 'The client baseline name|checksum row was not parsed.' }",
    "$rejected = $false",
    "try { ConvertTo-FreshDatabaseMigrationNames -MigrationEntries @('20261027220000_initial_client_pos|' + ('0' * 64)) -ExpectedMigrations $expected -InventoryRemovalMigrationName '20261027220000_initial_client_pos' -InventoryRemovalSourceMigrationName '20261027220000_initial_client_pos' -InventoryRemovalMigrationChecksum $checksum -InventoryRemovalSafeMigrationChecksum $checksum | Out-Null } catch { $rejected = $true }",
    "if (-not $rejected) { throw 'An unknown client baseline checksum was accepted.' }",
    "Write-Output 'FRESH_MIGRATION_LEDGER_PARSER_PASSED'",
  ].join("\r\n");
  fs.writeFileSync(scriptPath, script, "utf8");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
    { encoding: "utf8", timeout: 10000 },
  );
  if (result.error && result.error.code === "ENOENT") {
    context.skip("Windows PowerShell is unavailable; migration-ledger parser test not run.");
    return;
  }
  assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
  assert.match(result.stdout || "", /FRESH_MIGRATION_LEDGER_PARSER_PASSED/);
});

test("fresh migration gate rejects an installation-created database with unrelated migration history", (context) => {
  const fixtureRoot = createTestRoot("bigbites-recorded-database-gate-");
  const serverRoot = path.join(fixtureRoot, "server");
  context.after(() => removeTemporaryRoot(fixtureRoot));
  fs.mkdirSync(serverRoot, { recursive: true });

  const result = invokeStagingHarness("", serverRoot, {
    mode: "database-gate",
    databaseCreatedByAttempt: true,
    databaseState: "bigbites_client_local_delivery_20261027|127.0.0.1|5432|0|absent",
    appliedMigrations:
      "20260913000000_unrelated|0000000000000000000000000000000000000000000000000000000000000000",
  });
  if (result.unavailable) {
    context.skip("Windows PowerShell is unavailable; database-gate fixture not run.");
    return;
  }
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /unexpected migration history/);
});

test("the client baseline must match its packaged SQL checksum after line-ending normalization", (context) => {
  const fixtureRoot = createTestRoot("bigbites-client-baseline-checksum-");
  const sourceMigration = path.join(
    serverDirectory,
    "prisma",
    "client-migrations",
    "20261027220000_initial_client_pos",
    "migration.sql",
  );
  const tamperedMigration = path.join(fixtureRoot, "tampered-migration.sql");
  const checksum =
    "af32ea70140e6f3de8f416b2ad8b40a798cc18551b5af8483ba701de6a1b403a";
  context.after(() => removeTemporaryRoot(fixtureRoot));
  fs.mkdirSync(fixtureRoot, { recursive: true });

  const verified = invokeStagingHarness("", fixtureRoot, {
    mode: "migration-bytes",
    migrationPath: sourceMigration,
    expectedChecksum: checksum,
  });
  if (verified.unavailable) {
    context.skip("Windows PowerShell is unavailable; migration checksum fixture not run.");
    return;
  }
  assert.equal(verified.status, 0, verified.output);
  const verifiedBase64 = verified.stdout.match(/MIGRATION_BYTES=([A-Za-z0-9+/=]+)/)?.[1];
  assert.ok(verifiedBase64, verified.output);
  const normalizedBytes = Buffer.from(verifiedBase64, "base64");
  assert.equal(
    crypto.createHash("sha256").update(normalizedBytes).digest("hex"),
    checksum,
  );
  assert.equal(normalizedBytes.includes(Buffer.from("\r\n")), false);

  const tamperedSql = read(sourceMigration).replace("CREATE SCHEMA", "CREATE SCHEMA altered");
  fs.writeFileSync(tamperedMigration, tamperedSql, "utf8");
  const rejected = invokeStagingHarness("", fixtureRoot, {
    mode: "migration-bytes",
    migrationPath: tamperedMigration,
    expectedChecksum: checksum,
  });
  assert.notEqual(rejected.status, 0, rejected.output);
  assert.match(rejected.output, /does not match its packaged checksum/);
});

test("failed setup before database creation persists owned-role state for safe retry", (context) => {
  const fixtureRoot = createTestRoot("bigbites-before-database-failure-");
  const serverRoot = path.join(fixtureRoot, "server");
  const statePath = path.join(fixtureRoot, "installation-state.json");
  context.after(() => removeTemporaryRoot(fixtureRoot));
  fs.mkdirSync(serverRoot, { recursive: true });

  const result = invokeStagingHarness("", serverRoot, {
    mode: "state-before-database",
    statePath,
  });
  if (result.unavailable) {
    context.skip("Windows PowerShell is unavailable; install-state fixture not run.");
    return;
  }
  assert.equal(result.status, 0, result.output);
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(state.status, "in-progress");
  assert.equal(state.roleCreatedByAttempt, true);
  assert.equal(state.databaseCreatedByAttempt, false);
});

test("failed setup after database creation records the owned database for retry", (context) => {
  const fixtureRoot = createTestRoot("bigbites-after-database-failure-");
  const serverRoot = path.join(fixtureRoot, "server");
  const statePath = path.join(fixtureRoot, "installation-state.json");
  context.after(() => removeTemporaryRoot(fixtureRoot));
  fs.mkdirSync(serverRoot, { recursive: true });

  const result = invokeStagingHarness("", serverRoot, {
    mode: "state-after-database",
    statePath,
  });
  if (result.unavailable) {
    context.skip("Windows PowerShell is unavailable; install-state fixture not run.");
    return;
  }
  assert.equal(result.status, 0, result.output);
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(state.roleCreatedByAttempt, true);
  assert.equal(state.databaseCreatedByAttempt, true);
  assert.equal(state.databaseCreationStarted, true);
});

test("fresh-install resource checkpoints bracket role and database creation", () => {
  const roleAttemptStarted = installer.indexOf(
    "$installState.roleCreationStarted = $true",
  );
  const roleCreation = installer.indexOf(
    'Invoke-Psql "CREATE ROLE bigbites_client_delivery_app LOGIN PASSWORD',
  );
  const roleRecorded = installer.indexOf(
    "$installState.roleCreatedByAttempt = $true",
    roleCreation,
  );
  const databaseAttemptStarted = installer.indexOf(
    "$installState.databaseCreationStarted = $true",
    roleRecorded,
  );
  const databaseCreation = installer.indexOf(
    'Invoke-Psql "CREATE DATABASE $databaseName OWNER bigbites_client_delivery_app"',
    databaseAttemptStarted,
  );
  const databaseRecorded = installer.indexOf(
    "$installState.databaseCreatedByAttempt = $true",
    databaseCreation,
  );

  assert.ok(roleAttemptStarted >= 0 && roleAttemptStarted < roleCreation);
  assert.ok(roleCreation < roleRecorded && roleRecorded < databaseAttemptStarted);
  assert.ok(databaseAttemptStarted < databaseCreation && databaseCreation < databaseRecorded);
  assert.match(installer, /Save-InstallState -State \$installState -StatePath \$installStatePath/);
  assert.doesNotMatch(installer, /\b(?:DROP\s+DATABASE|DROP\s+ROLE|Remove-Database|Remove-Role)\b/i);
});

test("activation failure restores the previous payload and restarts its service", (context) => {
  const fixtureRoot = createTestRoot("bigbites-activation-recovery-");
  const serverRoot = path.join(fixtureRoot, "server");
  const previousPayloadId = "11111111111111111111111111111111";
  const newPayloadId = "22222222222222222222222222222222";
  context.after(() => removeTemporaryRoot(fixtureRoot));
  for (const payloadId of [previousPayloadId, newPayloadId]) {
    const entry = path.join(serverRoot, "payloads", payloadId, "dist", "server.js");
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, payloadId);
  }
  fs.writeFileSync(path.join(serverRoot, "active-payload.txt"), newPayloadId);

  const result = invokeStagingHarness("", serverRoot, {
    mode: "recovery",
    previousPayloadId,
    newPayloadId,
  });
  if (result.unavailable) {
    context.skip("Windows PowerShell is unavailable; activation recovery fixture not run.");
    return;
  }
  assert.equal(result.status, 0, result.output);
  assert.equal(
    fs.readFileSync(path.join(serverRoot, "active-payload.txt"), "utf8"),
    previousPayloadId,
  );
  assert.match(result.output, /RECOVERY_PASSED/);
});

test("unsafe database recovery restores the previous payload without restarting it", (context) => {
  const fixtureRoot = createTestRoot("bigbites-unsafe-recovery-");
  const serverRoot = path.join(fixtureRoot, "server");
  const previousPayloadId = "44444444444444444444444444444444";
  const newPayloadId = "55555555555555555555555555555555";
  context.after(() => removeTemporaryRoot(fixtureRoot));
  for (const payloadId of [previousPayloadId, newPayloadId]) {
    const entry = path.join(serverRoot, "payloads", payloadId, "dist", "server.js");
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, payloadId);
  }
  fs.writeFileSync(path.join(serverRoot, "active-payload.txt"), newPayloadId);

  const result = invokeStagingHarness("", serverRoot, {
    mode: "recovery-unsafe",
    previousPayloadId,
    newPayloadId,
  });
  if (result.unavailable) {
    context.skip("Windows PowerShell is unavailable; unsafe-recovery fixture not run.");
    return;
  }
  assert.equal(result.status, 0, result.output);
  assert.equal(
    fs.readFileSync(path.join(serverRoot, "active-payload.txt"), "utf8"),
    previousPayloadId,
  );
  assert.match(result.output, /RECOVERY_UNSAFE_PASSED/);
});

test("repeated install activation and state writes are idempotent", (context) => {
  const fixtureRoot = createTestRoot("bigbites-repeated-install-");
  const serverRoot = path.join(fixtureRoot, "server");
  const statePath = path.join(fixtureRoot, "installation-state.json");
  const payloadId = "33333333333333333333333333333333";
  context.after(() => removeTemporaryRoot(fixtureRoot));
  const entry = path.join(serverRoot, "payloads", payloadId, "dist", "server.js");
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, "fixture");

  const result = invokeStagingHarness("", serverRoot, {
    mode: "repeat-install",
    newPayloadId: payloadId,
    statePath,
  });
  if (result.unavailable) {
    context.skip("Windows PowerShell is unavailable; repeated-install fixture not run.");
    return;
  }
  assert.equal(result.status, 0, result.output);
  assert.equal(fs.readFileSync(path.join(serverRoot, "active-payload.txt"), "utf8"), payloadId);
  assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).status, "completed");
  assert.match(result.output, /REPEAT_INSTALL_PASSED/);
});

test("failed upgrade recovery restarts the existing scheduled service", (context) => {
  const fixtureRoot = createTestRoot("bigbites-service-restart-");
  const serverRoot = path.join(fixtureRoot, "server");
  const previousPayloadId = "44444444444444444444444444444444";
  const newPayloadId = "55555555555555555555555555555555";
  context.after(() => removeTemporaryRoot(fixtureRoot));
  for (const payloadId of [previousPayloadId, newPayloadId]) {
    const entry = path.join(serverRoot, "payloads", payloadId, "dist", "server.js");
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, payloadId);
  }
  fs.writeFileSync(path.join(serverRoot, "active-payload.txt"), newPayloadId);

  const result = invokeStagingHarness("", serverRoot, {
    mode: "recovery",
    previousPayloadId,
    newPayloadId,
  });
  if (result.unavailable) {
    context.skip("Windows PowerShell is unavailable; service-restart fixture not run.");
    return;
  }
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /previous BIG BITES POS payload was restored and restarted successfully/);
});

function createJunction(linkPath, targetPath) {
  try {
    fs.symlinkSync(targetPath, linkPath, "junction");
    return true;
  } catch {
    return false;
  }
}

test("pre-existing staging junction is rejected without touching its target", (context) => {
  const { files, directories } = getStagingManifest();
  const fixtureRoot = createTestRoot("bigbites-stage-junction-");
  const sourceRoot = path.join(fixtureRoot, "package");
  const serverRoot = path.join(fixtureRoot, "server");
  const externalRoot = path.join(fixtureRoot, "external");
  context.after(() => removeTemporaryRoot(fixtureRoot));
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(serverRoot, { recursive: true });
  fs.mkdirSync(externalRoot);
  createStagingFixture(sourceRoot, files, directories);
  fs.writeFileSync(path.join(externalRoot, "keep.txt"), "keep");
  const stagingRoot = path.join(serverRoot, ".staging");
  if (!createJunction(stagingRoot, externalRoot)) {
    context.skip("Windows junction creation is unavailable; reparse-point case not verified.");
    return;
  }
  const result = invokeStagingHarness(sourceRoot, serverRoot);
  if (result.unavailable) {
    context.skip("Windows PowerShell is unavailable; helper runtime test not run.");
    return;
  }
  assert.equal(result.status, 20);
  assert.match(result.output, /reparse point/i);
  assert.equal(fs.readFileSync(path.join(externalRoot, "keep.txt"), "utf8"), "keep");
});

test("dangling symlink is detected as a filesystem entry when supported", (context) => {
  const fixtureRoot = createTestRoot("bigbites-stage-dangling-link-");
  const serverRoot = path.join(fixtureRoot, "server");
  const linkPath = path.join(serverRoot, "dangling-link");
  const missingTarget = path.join(fixtureRoot, "does-not-exist");
  context.after(() => removeTemporaryRoot(fixtureRoot));
  fs.mkdirSync(serverRoot, { recursive: true });

  try {
    fs.symlinkSync(missingTarget, linkPath, "file");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP", "UNKNOWN"].includes(error.code)) {
      context.skip("This Windows environment does not permit creating symlinks.");
      return;
    }
    throw error;
  }

  const result = invokeStagingHarness("", serverRoot, {
    inspectionPath: linkPath,
  });
  if (result.unavailable) {
    context.skip("Windows PowerShell is unavailable; dangling symlink case not verified.");
    return;
  }
  assert.equal(result.status, 20);
  assert.match(result.output, /reparse point/i);
});

test("redirected staging path fails closed before recursive cleanup", (context) => {
  const { files, directories } = getStagingManifest();
  const fixtureRoot = createTestRoot("bigbites-stage-redirect-");
  const sourceRoot = path.join(fixtureRoot, "package");
  const serverRoot = path.join(fixtureRoot, "server");
  const externalRoot = path.join(fixtureRoot, "external");
  context.after(() => removeTemporaryRoot(fixtureRoot));
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(serverRoot, { recursive: true });
  fs.mkdirSync(externalRoot);
  createStagingFixture(sourceRoot, files, directories);
  fs.writeFileSync(path.join(externalRoot, "keep.txt"), "keep");
  const result = invokeStagingHarness(sourceRoot, serverRoot, {
    redirectTarget: externalRoot,
  });
  if (result.unavailable) {
    context.skip("Windows PowerShell is unavailable; helper runtime test not run.");
    return;
  }
  if (result.status === 20 && /junction creation failed/i.test(result.output)) {
    context.skip("Windows junction creation is unavailable; redirected cleanup case not verified.");
    return;
  }
  assert.equal(result.status, 20);
  assert.match(result.output, /left for manual investigation/i);
  assert.equal(fs.readFileSync(path.join(externalRoot, "keep.txt"), "utf8"), "keep");
});

test("desktop installer launches the cloud client without provisioning a local server", () => {
  assert.equal(tauriConfig.build.beforeBuildCommand, "npm run build");
  assert.equal(tauriConfig.bundle.resources, undefined);
  assert.match(nsis, /!macro NSIS_HOOK_PREUNINSTALL\s+!macroend/);
  assert.match(nsis, /ExecShell "" "\$INSTDIR\\desktop\.exe"/);
  assert.doesNotMatch(
    nsis,
    /Install-BigBites|Start-BigBitesServer|Stop-BigBitesServer|resources\\server|PostgreSQL/i,
  );
});

test("legacy local bootstrap validates server paths with PowerShell-compatible syntax", () => {
  assert.match(
    installer,
    /\$hasBundledServer = \(\s*\(Test-Path -LiteralPath \$ServerSourcePath\)\s*-and\s*\(Test-Path -LiteralPath \(Join-Path \$ServerSourcePath "dist\\server\.js"\)\)\s*\)/,
  );
  assert.doesNotMatch(
    installer,
    /Test-Path\s+\$ServerSourcePath\s+-(?:and|or)\b/,
  );
});

test("Windows runtime helper remains isolated from the cloud-client desktop build", () => {
  assert.equal(
    serverPackage.scripts["prepare:windows-runtime"],
    "node scripts/prepare-windows-runtime.cjs",
  );
  assert.doesNotMatch(
    tauriConfig.build.beforeBuildCommand,
    /server|prepare:windows-runtime/,
  );
  assert.match(
    windowsRuntimePreparer,
    /spawnSync\(\s*process\.execPath,\s*\[npmCli,\s*"ci",\s*"--omit=dev",\s*"--no-audit",\s*"--no-fund"\]/,
  );
  assert.match(windowsRuntimePreparer, /package-lock\.json/);
  assert.match(windowsRuntimePreparer, /bigbites_package_codegen_only/);
  assert.match(windowsRuntimePreparer, /schema-engine-windows\.exe/);
  assert.match(windowsRuntimePreparer, /migrate[\s\S]*?deploy/);
  assert.match(windowsRuntimePreparer, /APPLICATION_RUNTIME_IMPORTS_PASSED|require\('@prisma\/client'\)/);
  for (const excludedAsset of [
    "@prisma/studio-core/dist/ui",
    "@prisma/studio-core/dist/metafile-cjs.json",
    "@prisma/studio-core/dist/metafile-esm.json",
    "@prisma/dev/dist/runtime-assets",
  ]) {
    assert.ok(
      windowsRuntimePreparer.includes(excludedAsset),
      `Missing individually validated Prisma build asset exclusion: ${excludedAsset}`,
    );
  }
  assert.match(windowsRuntimePreparer, /Refusing to replace a runtime directory without its ownership marker/);
  assert.match(windowsRuntimePreparer, /renameSync\(stageRoot, outputRoot\)/);
});

test("legacy local bootstrap deploys a stock-free client baseline", () => {
  assert.ok(migrationSafetyGuard >= 0);
  assert.ok(stopExistingServerCall > migrationSafetyGuard);
  assert.match(installer, /\$clientBaselineMigrationName = "20261027220000_initial_client_pos"/);
  assert.match(installer, /Get-VerifiedClientBaselineMigrationBytes/);
  assert.match(installer, /prisma\\client-migrations/);
  assert.match(installer, /\$env:BIGBITES_LOCAL_CLIENT_MIGRATIONS = "1"/);
  assert.match(installer, /The stock-free local-client baseline migration was applied and verified/);
  assert.match(installer, /fresh local database schema was verified as stock-free/);
  assert.doesNotMatch(installer, /migrate resolve/);
  assert.ok(
    installer.indexOf("$migrationSql -match $destructiveInventorySql") <
      stopExistingServerCall,
    "baseline SQL is checked before stopping the active server",
  );
  assert.match(installer, /packaged Prisma schema unexpectedly contains stock or inventory models/);
  assert.match(installer, /clientSchemaState\.Trim\(\) -ne "present\|0"/);
  assert.match(installer, /finalClientSchemaState\.Trim\(\) -ne "present\|0"/);
  assert.doesNotMatch(installer, /CREATE TABLE IF NOT EXISTS public\."ProductStockMovement"/);
  assert.doesNotMatch(installer, /inventoryRepairSql|Repairing only missing inventory schema/);
  assert.match(installer, /Get-FileHash -LiteralPath \$migrationPath -Algorithm SHA256/);
  assert.match(installer, /\$packageChecksum -ine \$appliedMigrationChecksums\[\$migrationName\]/);
  assert.match(installer, /existing database has unapplied migrations/);
  assert.match(installer, /databaseCreatedByAttempt = \$false/);
  assert.match(installer, /\$databaseName = "bigbites_client_local_delivery_20261027"/);
  assert.match(installer, /COMMENT ON DATABASE \$databaseName IS '\$attemptMarker'/);
  assert.match(installer, /The local \$databaseName database exists but cannot be positively tied to this installation attempt/);
  assert.match(initializer, /\$databaseName -ne "bigbites_client_local_delivery_20261027"/);
});

test("legacy local bootstrap rejects unconfigured database conflicts", () => {
  const resourcePreflight = installer.indexOf(
    "if (-not ($hasExistingEnvironment -and -not $isResumingInstall))",
  );
  const databaseProbe = installer.indexOf("preflightDatabaseState", resourcePreflight);
  const roleProbe = installer.indexOf("preflightRoleState", resourcePreflight);
  const resourceConflict = installer.indexOf(
    "An existing or ambiguous local role/database was found before service shutdown",
    resourcePreflight,
  );
  const retryDatabaseGate = installer.indexOf("if ($preflightOwnsDatabase)", resourcePreflight);

  assert.ok(resourcePreflight >= 0);
  assert.ok(databaseProbe > resourcePreflight);
  assert.ok(roleProbe > databaseProbe);
  assert.ok(resourceConflict > roleProbe);
  assert.ok(resourceConflict < stopExistingServerCall);
  assert.ok(retryDatabaseGate > resourceConflict);
  assert.ok(
    installer.indexOf("Assert-FreshDatabaseMigrationGate `", retryDatabaseGate) <
      stopExistingServerCall,
    "partially migrated retry databases must be rejected before service shutdown",
  );
  assert.doesNotMatch(
    installer,
    /\b(?:DROP\s+DATABASE|DROP\s+ROLE|Remove-Database|Remove-Role)\b/i,
  );
});

test("legacy local bootstrap validates its PostgreSQL ownership journal", () => {
  const ownershipJournalCheck = installer.indexOf(
    "The local installation ownership journal is missing or incomplete",
  );
  const ownershipMarkerCheck = installer.indexOf(
    "$preflightOwnershipMarker",
  );
  assert.ok(ownershipJournalCheck >= 0);
  assert.ok(ownershipMarkerCheck > ownershipJournalCheck);
  assert.ok(stopExistingServerCall > ownershipMarkerCheck);
  assert.match(
    installer,
    /The local database and application role are not positively tied to this BIG BITES installation/,
  );
  assert.match(
    installer,
    /An existing PostgreSQL installation was detected without a BIG BITES local configuration/,
  );
});

test("desktop bundle contains no backend, migration, or local database payload", () => {
  assert.equal(tauriConfig.bundle.resources, undefined);
  assert.equal(tauriConfig.build.beforeBuildCommand, "npm run build");
  assert.doesNotMatch(
    tauriConfig.build.beforeBuildCommand,
    /server|prisma|migration|postgres/i,
  );
  assert.doesNotMatch(nsis, /Install-BigBites|resources\\server|prisma|migrate/i);
});

test("legacy local server helpers are not shipped by the cloud installer", () => {
  assert.match(installer, /\$taskName = "BigBitesPosServer"/);
  assert.match(installer, /\$serverDir = Join-Path \$dataRoot "server"/);
  assert.match(installer, /-TaskPath "\\"/);
  assert.match(
    installer,
    /Join-Path \$serverDir "Start-BigBitesServer\.ps1"/,
  );
  assert.match(installer, /resources\\windows\\Initialize-BigBites\.ps1/);
  assert.match(
    installer,
    /Join-Path \$serverDir "dist\\server\.js"/,
  );
  assert.match(
    installer,
    /A task named \$taskName exists, but it is not the expected BIG BITES POS startup task/,
  );
  assert.match(
    installer,
    /New-ScheduledTaskAction `\s*-Execute "powershell\.exe"/,
  );
  assert.match(
    starter,
    /\$serverDir = Join-Path \$env:ProgramData "BIG BITES POS\\server"/,
  );
  assert.match(starter, /active-payload\.txt/);
  assert.match(starter, /Join-Path \(Join-Path \$serverDir "payloads"\) \$activePayloadId/);
  assert.match(
    starter,
    /\$nodePath = Join-Path `\s*\(Join-Path \$serverDir "runtime"\) `\s*"node-3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237\\node\.exe"/,
  );
  assert.match(installer, /\$bundledNodePath = Join-Path \$PSScriptRoot "node-runtime\\node\.exe"/);
  assert.match(installer, /Copy-Item -LiteralPath \$bundledNodePath -Destination \$stagedNodePath/);
  assert.match(
    initializer,
    /\$nodePath = Join-Path `\s*\(Join-Path \$serverDir "runtime"\) `\s*"node-3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237\\node\.exe"/,
  );
  assert.match(starter, /Add-Content -LiteralPath \$startupLog/);
  assert.match(starter, /status -eq "OK"[\s\S]*?database -eq "Connected"/);
  assert.match(starter, /\(Get-Date\)\.AddSeconds\(45\)/);
  assert.match(
    installer,
    /Get-NetTCPConnection `\s*-State Listen `\s*-LocalPort \$LocalPort/,
  );
  assert.match(
    installer,
    /Get-NetUDPEndpoint `\s*-LocalPort \$LocalPort/,
  );
  assert.match(installer, /function ConvertFrom-BigBitesNetstatListeners/);
  assert.match(installer, /function Get-BigBitesPortListeners/);
  assert.match(installer, /netstat\.exe/);
  assert.match(
    installer,
    /Get-BigBitesPortListeners -Protocol "TCP" -LocalPort 3000/,
  );
  assert.match(
    installer,
    /Get-BigBitesPortListeners -Protocol "UDP" -LocalPort 3001/,
  );
  assert.match(
    installer,
    /Get-BigBitesPortListeners -Protocol "TCP" -LocalPort 5432/,
  );
  assert.match(installer, /TCP port 3000 is already in use/);
  assert.match(installer, /UDP port 3001 is already in use/);
  assert.match(installer, /Assert-BigBitesPortAvailability/);
  assert.doesNotMatch(installer, /winget/i);
  assert.match(installer, /https:\/\/get\.enterprisedb\.com\/postgresql\/postgresql-17\.11-5-windows-x64\.exe/);
  assert.match(installer, /function Receive-PostgresInstaller\(/);
  assert.match(installer, /\$request\.Timeout = 300000/);
  assert.match(installer, /\$request\.ReadWriteTimeout = 300000/);
  assert.match(installer, /\$DownloadDeadline = \(Get-Date\)\.AddMinutes\(60\)/);
  assert.match(installer, /\$retryableFailure[\s\S]{0,100}\$Attempt -lt 3/);
  assert.match(installer, /\$receivedBytes -ne \$expectedBytes/);
  assert.match(installer, /Get-AuthenticodeSignature `\s*-LiteralPath \$installerPath/);
  assert.match(installer, /SignerCertificate\.Subject -notmatch "\(\?i\)EnterpriseDB"/);
  assert.doesNotMatch(installer, /Invoke-WebRequest/);
  assert.match(installer, /WaitForExit\(30000\)/);
  assert.match(installer, /\$installerStartTime\.AddMinutes\(30\)/);
  assert.match(installer, /PostgreSQL installer process exited with code/);
  assert.match(installer, /An existing PostgreSQL installation was detected without a BIG BITES local configuration/);
  assert.match(installer, /TCP port 5432 is already in use/);
  assert.match(installer, /Get-Command psql\.exe -CommandType Application/);
  assert.match(installer, /PostgreSQL/);
  assert.match(installer, /\$major -lt 10/);
  assert.match(installer, /Sort-Object Major, Minor -Descending/);
  assert.match(installer, /Set-Service `\s*-Name \$postgresService\.Name `\s*-StartupType Automatic/);
  assert.ok(
    installer.indexOf("Set-Service `") < installer.indexOf("Register-ScheduledTask `"),
    "PostgreSQL must be configured for automatic startup before registering the backend task",
  );
  assert.match(
    stopper,
    /\$taskName = "BigBitesPosServer"/,
  );
  assert.match(
    stopper,
    /Join-Path \$env:ProgramData "BIG BITES POS\\server"/,
  );
  assert.match(stopper, /-TaskPath "\\"/);
  assert.match(stopper, /Get-BigBitesServerProcesses/);
  assert.match(stopper, /Unregister-ScheduledTask/);
  assert.match(stopper, /A task named \$taskName exists[\s\S]*?left unchanged/);
  assert.equal(tauriConfig.bundle.resources, undefined);
  assert.doesNotMatch(
    nsis,
    /Install-BigBites|Start-BigBitesServer|Stop-BigBitesServer|resources\\server/i,
  );
  assert.ok(
    migrationSafetyGuard >= 0 &&
      stopExistingServerCall > migrationSafetyGuard,
    "Migration safety must be checked before the existing server is stopped.",
  );
  assert.ok(
    stopExistingServerCall > installer.indexOf("Stage-ServerPayload `"),
    "The replacement payload must be staged and validated before stopping the server.",
  );
});

test("PostgreSQL installer verifies its official download and keeps credentials out of process arguments", (context) => {
  testPostgresPackageInstaller(context, "success");
  testPostgresPackageInstaller(context, "installer-exit-failure");
  testPostgresPackageInstaller(context, "process-timeout");
  testPostgresPackageInstaller(context, "download-failure");
  testPostgresPackageInstaller(context, "download-incomplete");
  testPostgresPackageInstaller(context, "signature-failure");
  testPostgresPackageInstaller(context, "wrong-signer");
  testPostgresPackageInstaller(context, "signature-lock");
  assert.doesNotMatch(
    installer,
    /--superpassword\s+\$postgresPassword/i,
    "PostgreSQL password must not be passed to the installer on its command line",
  );
  assert.doesNotMatch(
    installer,
    /(?:Write-Host|Write-Output|Add-Content|Set-Content)[^\r\n]*\$postgresPassword/i,
    "PostgreSQL password must not be written to installer output or logs",
  );
  assert.doesNotMatch(installer, /winget/i);
});

test("cloud installer leaves existing local services and data untouched", () => {
  assert.doesNotMatch(stopper, /\b(?:Stop-Service|Restart-Service)\b/i);
  assert.doesNotMatch(stopper, /\b(?:Remove-Item|Remove-ItemProperty|Remove-Database)\b/i);
  assert.doesNotMatch(stopper, /\b(?:psql|pg_dump|pg_restore|migrate deploy)\b/i);
  assert.match(stopper, /Stop-Process -Id \$process\.ProcessId -Force/);
  assert.match(stopper, /Unregister-ScheduledTask/);
  assert.match(nsis, /!macro NSIS_HOOK_PREUNINSTALL\s+!macroend/);
  assert.doesNotMatch(nsis, /Stop-BigBitesServer|Stop-Service|Remove-Database|DROP DATABASE/i);
});

test("desktop and waiter release defaults use the hosted production API", () => {
  const desktopSource = read(
    path.resolve(desktopDirectory, "src", "App.tsx"),
  );
  const waiterSource = read(
    path.join(waiterDirectory, "lib", "services", "api_service.dart"),
  );
  const waiterGradle = read(
    path.join(waiterDirectory, "android", "app", "build.gradle.kts"),
  );

  assert.match(
    desktopSource,
    /import\.meta\.env\.DEV[\s\S]*?VITE_API_URL \|\| "http:\/\/127\.0\.0\.1:3000"[\s\S]*?"https:\/\/big-bites-server\.onrender\.com"/,
  );
  assert.match(
    waiterSource,
    /'API_BASE_URL'[\s\S]*?defaultValue: 'https:\/\/big-bites-server\.onrender\.com'/,
  );
  assert.match(waiterSource, /_discoveryPort = 3001/);
  assert.match(waiterSource, /_serverPort = 3000/);
  assert.match(waiterSource, /_discoverServer\(\)/);
  assert.match(waiterSource, /startReconnectMonitor/);
  assert.match(waiterSource, /_reconnectInterval = Duration\(seconds: 15\)/);
  assert.match(waiterSource, /Timer\.periodic\(_reconnectInterval/);
  const waiterMain = read(path.join(waiterDirectory, "lib", "main.dart"));
  assert.match(waiterMain, /Timer\.periodic\(const Duration\(seconds: 15\)/);
  const serverSource = read(
    path.resolve(serverDirectory, "src", "server.ts"),
  );
  assert.match(serverSource, /DISCOVERY_REQUEST\s*=\s*"BIGBITES_POS_DISCOVERY_V1"/);
  assert.match(serverSource, /DISCOVERY_PORT[\s\S]*?process\.env\.DISCOVERY_PORT[\s\S]*?\|\| 3001/);
  assert.match(serverSource, /service:\s*"big-bites-pos"[\s\S]*?port:\s*PORT/);
  assert.match(serverSource, /LAN discovery could not bind its UDP port[\s\S]*?process\.exit\(1\)/);
  assert.doesNotMatch(waiterGradle, /API_BASE_URL|dart-define/i);
});

test("static tests do not read or print environment secrets", () => {
  const testSource = read(__filename);
  const testBody = testSource.replace(
    /^  assert\.doesNotMatch\(testBody,.*$/gm,
    "",
  );
  assert.doesNotMatch(testBody, /process\.env|Get-Content[^\n]*\.env/i);
  assert.doesNotMatch(testBody, /console\.(?:log|info|debug)\s*\(/);
  assert.doesNotMatch(testBody, /(?:DATABASE_URL|AUTH_SECRET)\s*=/);
});
