# BIG BITES POS Safe Windows Lifecycle Test Plan

**Status:** Test plan only. No installer, lifecycle script, database, or
external service was run or accessed while preparing this plan.

## Safety boundary and prerequisites

Run runtime testing only on an owner-approved, disposable Windows VM that can
be reverted to a clean snapshot. Keep it separate from restaurant machines
and production networks. Do not use Render, Neon, production credentials,
customer data, payment data, or a production backup.

Before testing installation or upgrades:

1. Resolve and approve the target-specific database migration strategy using
   sanitized owner/DBA evidence. The current
   `20261020100000_remove_product_stock` migration drops stock fields and
   stock-movement history, so the current installer must fail closed while it
   is present. Do not bypass that guard to exercise the installer.
2. Build a reviewed package revision only after that approval. Pre-stage the
   required Node.js and PostgreSQL installers/runtime in the VM; do not rely
   on `winget` or unrestricted internet access during the test.
3. Use a newly provisioned, isolated test database with synthetic data only,
   after separately approved provisioning. Keep a VM snapshot and verified
   test-only recovery path. Confirm the VM cannot reach any production host.
4. Record target labels and synthetic fixture outcomes only. Do not save
   secrets, connection strings, or application records in test logs.

The static tests in
[`../apps/desktop/src-tauri/windows/lifecycle-config.test.cjs`](../apps/desktop/src-tauri/windows/lifecycle-config.test.cjs)
do not manipulate Windows tasks, processes, services, files, or databases.
They check source/configuration relationships only.

## Stage 1: static and mocked checks

Run the lifecycle configuration test and PowerShell parser on the reviewed
scripts. Where Pester is available, add a separate mock-only test harness for
`Get-ScheduledTask`, `Stop-ScheduledTask`, `Get-CimInstance`, `Stop-Process`,
`Unregister-ScheduledTask`, `Start-Process`, and `Invoke-RestMethod`. Mock
commands must return synthetic tasks/processes and must never call Windows
task, process, service, network, or database APIs.

Cover these cases:

- Correct and incorrect Tauri resource destinations and NSIS resource paths.
- Expected root-folder `BigBitesPosServer` task/action; unrelated same-name
  task in another folder and unexpected root task action are left untouched.
- Exact server executable path match; a similarly named Node process is
  untouched.
- Existing server healthy, new server healthy after startup, unavailable
  process, health timeout, and database-disconnected health response.
- Installer rejects missing/unreviewed/destructive migration resources before
  stopping the existing server.
- Stop failure or unavailable task/process inspection fails closed.
- Uninstall removes only the approved POS task and stops only the matching
  POS server process. It never stops PostgreSQL, deletes the database, `.env`,
  backups, or `%ProgramData%\BIG BITES POS` data.

Mocked/static checks do not prove Windows permissions, task scheduler
behavior, database readiness, or actual network discovery.

The installer declares `Stage-ServerPayload`, which copies the backend into a
unique child of `%ProgramData%\BIG BITES POS\server\.staging`. It rejects
reparse points in the server/staging path, resolves directories through Windows
handles to compare physical paths, and captures the staging directory's volume
and file identity. Before creating staged content, it requires the existing
server root to have protected inheritance and rejects write-capable allow rules
for principals other than the current process identity, SYSTEM, and local
Administrators. It also requires the owner SID of the server root, staging
root, and operation directory to be the current process identity, SYSTEM, or
local Administrators. Before changing the staging-root ACL, it checks the
existing owner and write-capable allow rules; it does not change the owner.
It applies and verifies a protected staging-root ACL for those same principals,
and rechecks ACLs, identities, and reparse points before cleanup.

The ACL boundary is intended to prevent ordinary local principals that are not
explicitly allowed from creating, replacing, or changing staged content. It
does not protect against the current process identity, SYSTEM, local
Administrators, kernel-level actors, or other principals with equivalent
privilege; those actors can alter the ACL or race path-based operations. Cleanup
uses recursive path-based deletion after revalidation, not a handle-relative
deletion primitive. It is therefore not atomic and does not guarantee safety
against privileged concurrent path replacement. If revalidation fails, cleanup
is refused and the staging path is reported for manual investigation. Windows
ACL and race behavior require isolated runtime verification.

The helper is intentionally not called by the active install/upgrade flow; the
existing backend-copy behavior remains unchanged. The lifecycle tests run the
extracted helper functions against temporary payloads using Windows PowerShell,
not the installer. Owner-policy tests use synthetic ACL objects to exercise
trusted-owner acceptance and untrusted-owner rejection; staging tests also
exercise ACL setup on temporary directories. These tests do not establish
ownership or ACL behavior on an installed ProgramData tree. The tests cover
success, ACL verification, missing payloads, copy failure, preservation of
sentinel files, pre-existing junctions, and a redirected path before cleanup.
Dangling-link and reparse-point tests are reported as skipped if the environment
cannot create the required link; skipped cases remain unverified.

## Stage 2: isolated Windows lifecycle runtime

Use a clean VM snapshot and a synthetic test-only local database after the
database approval gate. Keep the test on an isolated private virtual LAN.
Capture only task state, process command-line match results, health status,
and synthetic test outcomes.

1. Inspect package contents before setup. Verify that the canonical server
   `dist`, dependencies, Prisma schema/migrations, and Windows setup, start,
   stop, and initialization scripts are present at the paths expected by the
   NSIS hook and installer.
2. Install and verify that setup registers the root `BigBitesPosServer` task
   with a SYSTEM startup trigger and hidden PowerShell action. Confirm local
   API health and LAN discovery from a second test device on the virtual LAN.
3. Reboot the VM. Verify the task starts the intended process and the health
   endpoint reports API and database connected before desktop login is used.
4. Exercise failure cases only with disposable fixtures: unavailable Node,
   API port conflict, database unavailable, invalid/missing health response,
   and discovery timeout. Verify clear diagnostics and no fallback to a
   production URL.
5. Test upgrade only with the reviewed, migration-approved package and a
   verified disposable database backup. Confirm synthetic stock fields,
   movement history, variants, orders, payments, split tender, GST, and report
   settings remain intact before and after upgrade.
6. Test uninstall while idle and while the server is responding to a test
   request. Verify the POS task/process stops, PostgreSQL remains running,
   and the database, `.env`, backups, and application data remain present.
   Reinstall from a fresh snapshot and verify persistence/recovery only using
   synthetic data.

If a check fails, preserve logs without secrets, revert only the disposable
VM snapshot, and stop. Never use a production or restaurant-local database
for a lifecycle test.

## Current blockers

- The stock-removal migration’s status remains **UNKNOWN** for every existing
  restaurant database. Never test an upgrade against one until its target,
  migration ledger, schema, and retained data have been verified. A fresh
  install test is allowed only in a disposable VM where the installer creates
  the local database and verifies that it has no public relations or migration
  ledger before applying migrations.
- The generated NSIS file table can be checked for resource destinations, but
  the executable payload has not been independently extracted or installed.
  Resource-table inspection is not an end-to-end installation test.
- Reboot behavior, Windows task permissions, firewall behavior, physical
  waiter discovery, and uninstall behavior remain unverified at runtime.
