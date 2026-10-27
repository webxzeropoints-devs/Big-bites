const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const windowsDirectory = __dirname;
const installer = fs.readFileSync(
  path.join(windowsDirectory, "Install-BigBites.ps1"),
  "utf8",
);
const starter = fs.readFileSync(
  path.join(windowsDirectory, "Start-BigBitesServer.ps1"),
  "utf8",
);

function extract(source, expression, description) {
  const match = source.match(expression);
  assert.ok(match, `Could not find production ${description} for isolated test`);
  return match[0];
}

function invokePowerShell(context, body, parameters = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bigbites-installer-mocks-"));
  const scriptPath = path.join(root, "mock-test.ps1");
  fs.writeFileSync(
    scriptPath,
    [
      "param([string]$TestRoot, [string]$Scenario)",
      "$ErrorActionPreference = 'Stop'",
      body,
    ].join("\r\n"),
    "utf8",
  );
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
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
      root,
      "-Scenario",
      parameters[0] || "default",
    ],
    { encoding: "utf8", timeout: 30000 },
  );
  if (result.error && result.error.code === "ENOENT") {
    context.skip("Windows PowerShell is unavailable; isolated mock test not run.");
    return null;
  }
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  assert.equal(result.status, 0, output);
  return output;
}

const restoreFunction = extract(
  installer,
  /function Restore-PreviousServerAfterFailure \{[\s\S]*?(?=\r?\nfunction )/,
  "previous-server recovery function",
);
const startupAttempt = extract(
  starter,
  /\$process = Start-Process `[\s\S]*?if \(\$null -eq \$process\) \{\s*throw "The BIG BITES POS server failed to start in the background\."\s*\}/,
  "server process-start path",
);
const taskRegistration = extract(
  installer,
  /Register-ScheduledTask `[\s\S]*?Out-Null/,
  "scheduled-task registration command",
);

function recoveryTestBody() {
  return [
    "$serverDir = $TestRoot",
    "$taskName = 'BigBitesPosServer'",
    "$script:serverStopped = $true",
    "$script:activationAttempted = $true",
    "$script:previousServerRestartSafe = $true",
    "$script:previousPayloadId = '11111111111111111111111111111111'",
    "$script:activePayloadId = '22222222222222222222222222222222'",
    "$script:scheduledStarts = 0",
    "$script:clock = [datetime]::Parse('2026-10-26T00:00:00')",
    "function Set-ActiveServerPayload { param($ServerRoot, $PayloadId); [System.IO.File]::WriteAllText((Join-Path $ServerRoot 'active-payload.txt'), $PayloadId) }",
    "function Stop-ExistingServer { }",
    "function Get-ScheduledTask { param($TaskName, $TaskPath, $ErrorAction); [pscustomobject]@{ TaskName = $TaskName; TaskPath = $TaskPath } }",
    "function Start-ScheduledTask { param($TaskName, $ErrorAction); $script:scheduledStarts++ }",
    "function Start-Sleep { param([int]$Seconds) }",
    "function Get-Date { $script:clock = $script:clock.AddSeconds(60); return $script:clock }",
    "function Invoke-RestMethod { param($Uri, $TimeoutSec); if ($Scenario -eq 'unreachable') { throw 'Injected unreachable health endpoint.' }; return [pscustomobject]@{ status = 'Unavailable'; database = 'Disconnected' } }",
    "[System.IO.File]::WriteAllText((Join-Path $TestRoot 'active-payload.txt'), $script:activePayloadId)",
    "try {",
    restoreFunction,
    "  Restore-PreviousServerAfterFailure",
    "  throw 'Recovery unexpectedly reported success.'",
    "} catch {",
    "  if ($_.Exception.Message -notmatch 'previous payload was restored, but its service did not become healthy') { throw }",
    "}",
    "$pointer = [System.IO.File]::ReadAllText((Join-Path $TestRoot 'active-payload.txt')).Trim()",
    "if ($pointer -ne $script:previousPayloadId) { throw 'Failed recovery did not preserve the previous payload pointer.' }",
    "if ($script:scheduledStarts -ne 1) { throw 'Recovery did not attempt exactly one mocked scheduled start.' }",
    "if (-not $script:serverStopped) { throw 'Failed recovery was incorrectly marked healthy.' }",
    "Write-Output 'MOCKED_RECOVERY_FAILURE_PASSED'",
  ].join("\r\n");
}

test("recovery fails closed when health returns an unhealthy response", (context) => {
  const output = invokePowerShell(context, recoveryTestBody(), ["unhealthy"]);
  if (output === null) return;
  assert.match(output, /MOCKED_RECOVERY_FAILURE_PASSED/);
});

test("recovery fails closed when the health endpoint is unreachable", (context) => {
  const output = invokePowerShell(context, recoveryTestBody(), ["unreachable"]);
  if (output === null) return;
  assert.match(output, /MOCKED_RECOVERY_FAILURE_PASSED/);
});

test("server startup rejects a null process result from the mocked launcher", (context) => {
  const body = [
    "$nodePath = 'C:\\mock\\node.exe'",
    "$serverEntry = 'C:\\mock\\server.js'",
    "$serverDir = $TestRoot",
    "$stdoutLog = Join-Path $TestRoot 'stdout.log'",
    "$stderrLog = Join-Path $TestRoot 'stderr.log'",
    "function Start-Process { param($FilePath, $ArgumentList, $WorkingDirectory, $WindowStyle, $RedirectStandardOutput, $RedirectStandardError, [switch]$PassThru); return $null }",
    "try {",
    startupAttempt,
    "  throw 'Startup unexpectedly accepted a missing process.'",
    "} catch {",
    "  if ($_.Exception.Message -ne 'The BIG BITES POS server failed to start in the background.') { throw }",
    "}",
    "Write-Output 'MOCKED_PROCESS_START_FAILURE_PASSED'",
  ].join("\r\n");
  const output = invokePowerShell(context, body);
  if (output === null) return;
  assert.match(output, /MOCKED_PROCESS_START_FAILURE_PASSED/);
});

test("scheduled-task registration propagates a mocked registration failure", (context) => {
  const body = [
    "$taskName = 'BigBitesPosServer'",
    "$action = 'mock-action'",
    "$trigger = 'mock-trigger'",
    "$principal = 'mock-principal'",
    "$settings = 'mock-settings'",
    "function Register-ScheduledTask { param($TaskName, $Action, $Trigger, $Principal, $Settings, [switch]$Force); throw 'Injected scheduled-task registration failure.' }",
    "try {",
    taskRegistration,
    "  throw 'Task registration unexpectedly succeeded.'",
    "} catch {",
    "  if ($_.Exception.Message -ne 'Injected scheduled-task registration failure.') { throw }",
    "}",
    "Write-Output 'MOCKED_TASK_REGISTRATION_FAILURE_PASSED'",
  ].join("\r\n");
  const output = invokePowerShell(context, body);
  if (output === null) return;
  assert.match(output, /MOCKED_TASK_REGISTRATION_FAILURE_PASSED/);
});

test("existing lifecycle suite retains coverage for unsafe recovery and pointer rollback", () => {
  const lifecycleTests = fs.readFileSync(
    path.join(windowsDirectory, "lifecycle-config.test.cjs"),
    "utf8",
  );
  assert.match(
    lifecycleTests,
    /test\("unsafe database recovery restores the previous payload without restarting it"/,
  );
  assert.match(
    lifecycleTests,
    /test\("activation failure restores the previous payload and restarts its service"/,
  );
});
