# BIG BITES POS Local Client Deployment Design

**Prepared:** 2026-10-23
**Scope:** Design-only review of the current local Windows desktop/server and
Android waiter setup. No application source, migration, or configuration was
changed for this design.

## 1. Summary and decision

The repository already contains a local deployment path: Tauri packages the
canonical `apps/server` runtime and Windows setup scripts; the installer
installs or reuses Node.js and PostgreSQL, configures a local database,
registers a startup task for the API, and configures LAN access for the waiter.
The desktop defaults to the local API and the waiter discovers it over the
local network.

The intended architecture is viable in principle, but **the present installer
must not be run or packaged for client delivery**. Its preflight intentionally
rejects the checked-in `20261020100000_remove_product_stock` migration before
stopping the existing server or changing the database. The actual migration
status on any database is **UNKNOWN**, and the schema/runtime parity and data
transfer strategy are unresolved. This design does not select a migration
sequence, authorize a data export/import, or establish release readiness.

Render and Neon must remain unchanged. The current selected direction is a
separate local client installation, with Render proposed as the data source
only after an authorized DBA confirms the actual backing database and the
owner approves the exact transfer. Neon is not selected as a transfer source
by this design and must not be changed.

## 2. Verified current behavior

### Windows installer and backend lifecycle

Evidence: [`Install-BigBites.ps1`](../apps/desktop/src-tauri/windows/Install-BigBites.ps1),
[`Start-BigBitesServer.ps1`](../apps/desktop/src-tauri/windows/Start-BigBitesServer.ps1),
[`installer.nsh`](../apps/desktop/src-tauri/windows/installer.nsh), and
[`tauri.conf.json`](../apps/desktop/src-tauri/tauri.conf.json).

- Tauri config builds the desktop frontend and canonical server, then bundles
  the server `dist`, `node_modules`, Prisma schema/migrations, and Windows
  scripts. It targets an NSIS per-machine installer.
- The NSIS post-install hook invokes PowerShell setup and launches the desktop
  only when setup returns success.
- Setup uses the bundled Node.js 24.19.0 x64 runtime and does not require a
  system Node installation or `winget`. If PostgreSQL is absent, it downloads
  and signature-verifies the official EnterpriseDB PostgreSQL 17.11 installer;
  internet access is then required. Fresh setup refuses to adopt an unrelated
  existing PostgreSQL service and leaves a port-5432 conflict untouched.
- New setup creates a `bigbites_app` role and `bigbites` database. It writes
  `DATABASE_URL`, `AUTH_SECRET`, and local-mode settings to
  `%ProgramData%\BIG BITES POS\server\.env`; it restricts the configuration
  folder ACL to SYSTEM and local Administrators. The application role is not
  the PostgreSQL superuser.
- For existing installs, setup requires the `.env` values to point to the
  expected local database identity. It checks migration ledger rows and
  compares applied names to packaged migration names. If migrations are
  pending, it creates a custom-format backup and verifies that
  `pg_restore --list` can read it; this is **not** a restore test.
- The installer temporarily adds a local `trust` rule for the PostgreSQL
  superuser when it must configure an existing PostgreSQL instance, restarts
  the identified service, and attempts to restore the original `pg_hba.conf`
  in cleanup/error handling.
- Before server replacement, it validates packaged schema/migration resources
  and scans migration SQL. The exact reviewed stock-removal migration is
  allowed only for a database created during the current setup run after a
  positive check confirms `127.0.0.1:5432/bigbites`, zero public relations,
  and no migration ledger. Existing configured databases must already have
  that migration applied and match the stock-free schema; setup stops before
  stopping the existing server if they do not. The installer does not reset or
  replace an existing database.
- It configures TCP 3000 and UDP 3001 firewall rules restricted to
  `LocalSubnet`, creates a SYSTEM startup scheduled task with retry settings,
  starts the API, checks `/health`, and tests LAN discovery/health.
- The current source includes an installer preflight block for the known
  destructive migration. Therefore the current migration tree causes setup to
  stop before the server is stopped or any database change occurs.

### Backend configuration and health

Evidence: [`database.ts`](../apps/server/src/config/database.ts),
[`server.ts`](../apps/server/src/server.ts),
[`run-start-migrations.cjs`](../apps/server/scripts/run-start-migrations.cjs),
and [`assert-safe-migrations.cjs`](../apps/server/scripts/assert-safe-migrations.cjs).

- The database module requires `DATABASE_URL`; local mode and non-production
  processes reject non-loopback PostgreSQL URLs.
- The server defaults to HTTP port 3000, UDP discovery port 3001, and binds to
  `0.0.0.0` unless `HOST` is set. It answers the LAN discovery request with a
  private IPv4 address and reports both API and database health on `/health`.
- The installed task starts `node dist/server.js` directly from the server
  directory. The server loads its `.env`; this direct invocation does not run
  npm's `prestart`.
- `npm start` has a `prestart` guard for production auto-migration. Local
  installation mode disables that npm startup migration path. Direct Prisma
  CLI calls bypass the app-level guard; installer checks are a separate guard.
- Health checks verify an API response and a database query, but an installer
  health response alone does not prove which process owns the port. Runtime
  ownership/port-conflict checks need acceptance testing and may require
  hardening.

### Desktop

Evidence: [`App.tsx`](../apps/desktop/src/App.tsx),
[`lib.rs`](../apps/desktop/src-tauri/src/lib.rs), and Tauri configuration.

- The desktop API defaults to `http://127.0.0.1:3000`; `VITE_API_URL` can
  override this at build time.
- The UI checks backend health, retries, and presents a local server
  unavailable message. Standard local build configuration must not set a
  production API override.
- The optional production catalog sync is controlled by a build-time flag;
  standard local mode leaves it disabled. Local startup also sets the server
  catalog-sync flag false. Do not enable this feature in the standard client
  package.
- Tauri also writes monthly report files to a user-selected folder without
  overwriting same-named reports. Receipt printing and financial/admin
  workflows still require end-to-end acceptance testing.

### Waiter Android app

Evidence: [`api_service.dart`](../apps/waiter_app/lib/services/api_service.dart),
[`AndroidManifest.xml`](../apps/waiter_app/android/app/src/main/AndroidManifest.xml),
[`build.gradle.kts`](../apps/waiter_app/android/app/build.gradle.kts), and
[`main.dart`](../apps/waiter_app/lib/main.dart).

- If build-time `API_BASE_URL` is empty, the app broadcasts
  `BIGBITES_POS_DISCOVERY_V1` over UDP 3001, accepts a private IPv4 discovery
  response for API port 3000, then performs an HTTP `/health` check.
- Discovery timeout is 5 seconds and health timeout is 8 seconds. Failure
  reports that the user should connect to restaurant Wi-Fi/LAN and ensure the
  POS server is running. There is no manual-IP screen in this flow.
- A non-empty build-time `API_BASE_URL` bypasses discovery and connects to
  that URL. Standard local APK builds must leave it unset; no Render/Neon
  fallback is present in the inspected API service.
- Android manifest requests `INTERNET` and enables cleartext HTTP. That
  supports the current local HTTP design but is a security tradeoff on a
  shared/untrusted network. Use a trusted private LAN and restrict firewall
  scope; evaluate authenticated/encrypted transport as a future hardening
  decision without changing the existing API architecture silently.
- Release signing is configured through environment variables and the Gradle
  task rejects a release build if the signing inputs are missing. The APK
  package identifier is `com.bigbites.familyrestaurant.waiter`.

## 3. Proposed local architecture

1. **One Windows POS host** runs the canonical backend and PostgreSQL. Desktop
   API calls use loopback TCP 3000. The waiter uses private-LAN UDP discovery
   on 3001 and HTTP API traffic to the host on TCP 3000.
2. **PostgreSQL remains local to the POS PC.** Bind its listener to loopback
   only; do not expose port 5432 to the LAN. The API is the only application
   process that should access the database. Use a dedicated non-superuser
   role for normal runtime.
3. **Server and database start automatically.** Prefer an installer-managed
   Windows service for PostgreSQL and a service or tightly controlled
   startup task for the API. If retaining the current scheduled-task design,
   prove SYSTEM task permissions, restart/recovery behavior, clean shutdown,
   logs, and boot ordering. Do not run a second API if one is already healthy.
4. **No remote fallback.** A local connection/health failure must be visible
   and actionable; neither client should silently route billing/order
   requests to Render or Neon. Production catalog sync remains disabled.
5. **Local secrets are generated per installation.** Generate a unique
   database role password and `AUTH_SECRET`; store them only in a
   machine-protected configuration location with least-privilege ACLs. Never
   package production credentials or put secrets in client logs, UI, command
   history, source, APK, or support reports.
6. **Updates preserve customer state.** Application binaries can be updated
   independently from database files. Before any schema update, verify the
   target identity and approved ledger/schema state, create a backup, and
   prove restore to another isolated target. If an installation or database
   identity is ambiguous, stop and retain it unchanged.
7. **Local operations are independent of internet after install**, subject to
   local hardware and LAN availability. Installer package/runtime acquisition
   requires internet only to acquire PostgreSQL when that runtime is absent;
   the bundled Node runtime and app/server resources are available offline.

## 4. Smallest required changes before implementation can be planned

No code changes are made in this design. Based on inspected source, the
following are the minimum design-level issues to resolve:

| Area | Required change or decision | Reason / evidence |
| --- | --- | --- |
| Database strategy | Resolve the destructive migration by per-target evidence and an approved forward-only strategy before enabling installation or import. | Installer guard blocks the current migration set; status is UNKNOWN. |
| Source/runtime | Use only canonical `apps/server` source/build/client/schema/runtime for the local installer. Retire or explicitly exclude the stale standalone bundle from client delivery unless it is later rebuilt through a deterministic canonical pipeline. | Tauri currently packages canonical resources; standalone schema/migrations/routes omit required functions. |
| Installer idempotency | Separate program files from persistent data; preserve an existing local DB/config on update. Add an explicit backup/restore rehearsal before any approved schema update, and abort before file replacement if the install identity is uncertain. | Current script replaces server payload and uses fixed local DB identity. Archive listing is not restore validation. |
| PostgreSQL lifecycle | Pin/verify the supported PostgreSQL major version, identify the service/data directory, verify startup type/port, and avoid silently adopting an unrelated existing PostgreSQL cluster. Handle occupied 5432 as a hard diagnostic rather than guessing a different server. | Fresh setup downloads signed EDB PostgreSQL 17.11, assigns a dedicated service name, and rejects a detected unrelated installation or occupied 5432; existing configured POS databases remain subject to migration and identity checks. |
| Port/process checks | Before startup, positively identify any listener on 3000/3001 and PostgreSQL 5432. Health must be tied to this installation's process; do not accept another process's `/health` response as success. | Current configuration uses fixed ports; health check is URL-based. |
| Secret handling | Replace password-bearing command-line/SQL arguments and plaintext-configuration assumptions with protected secret input/storage; review transcript and process-argument exposure. | PostgreSQL superuser password is kept in a protected temporary option file, not process arguments; app role password is still embedded in `psql -c` SQL, and URL/secret are stored in `.env` protected by ACL. ACL reduces access but does not encrypt the file. |
| Database authentication bootstrap | Avoid temporary broad/trust authentication where possible; if unavoidable, tightly scope duration and prove restoration even after process termination/reboot. | Existing setup prepends a local `trust` rule to `pg_hba.conf`, restarts PostgreSQL, then restores the original bytes through cleanup handling. |
| Service/reinstall flow | Make setup transactional/recoverable: stage new payload, verify it, then switch; keep last known-good runtime. Do not recursively replace server files before all non-database setup checks pass. | Current upgrade stops task/process and removes packaged payload paths before recopying. |
| Startup UX | Expose service health and actionable startup errors to the desktop; define retry/backoff and log rotation/retention. | Desktop retries and reports unavailable server; background process logs are date-named, and installer performs initial health/discovery checks. |
| Client release configuration | Make local-only API/sync configuration explicit and verifiable in release provenance. | `VITE_API_URL` and `API_BASE_URL` can override defaults; the sync toggle is a build-time flag. |
| Network | Restrict firewall rules to private network profiles/subnet; verify no PostgreSQL LAN exposure and confirm Android discovery on supported Wi-Fi routers. | Installer uses `LocalSubnet` firewall rules with profile `Any`; API server binds `0.0.0.0`. |
| Backups | Add a documented scheduled backup/retention and restore workflow; validate with a restore to an isolated database, not `pg_restore --list` alone. | Current installer only creates a pre-migration dump when pending migrations exist and verifies archive readability. |
| Source data | After the owner approves exact source/scope, create a sanitized export/import plan and reconciliation; never import directly into an existing client DB. | Initializer only supports create-only bootstrap into an empty local database. |

These are requirements for later reviewed implementation, not permission to
edit scripts or perform any operations now.

## 5. Database and inventory safety

The canonical schema is expected to preserve:

- Product `stock`, `stockUnit`, `lowStockThreshold`, and
  `lastStockUpdatedAt`.
- Product stock movement records and their product relationship.
- Product variants and `OrderItem.variantId`.
- Orders, order items, payments, and cancellation history.
- `PaymentMethod.CASH_UPI`, `cashAmount`, and `upiAmount`, plus amount
  received/change fields.
- GST/report settings and order fields.

The migration
[`20261020100000_remove_product_stock`](../apps/server/prisma/migrations/20261020100000_remove_product_stock/migration.sql)
drops the stock columns and `ProductStockMovement` table. Its applied or
pending state for each target is **UNKNOWN**. Do not run the current migration
tree or initialize a local DB with it. The canonical/standalone difference
and exact SQL are detailed in
[`MIGRATION_RESOLUTION_PROPOSAL.md`](MIGRATION_RESOLUTION_PROPOSAL.md).

Before any local schema setup, import, or migration:

1. Obtain separately authorized, sanitized migration-ledger and actual-schema
   evidence per source/target using
   [`DATABASE_EVIDENCE_COLLECTION.md`](DATABASE_EVIDENCE_COLLECTION.md).
2. Compare migration names/checksums with the exact repository revision and
   verify the stock-removal migration state independently of schema shape.
3. Verify a source backup by restoring it into a separate isolated database.
4. Have the data owner, DBA, and application maintainer approve an exact
   history-preserving local initialization/import strategy. Do not infer a
   migration sequence from an empty destination.
5. Provision only a newly approved isolated target, confirm its identity and
   empty state, and rehearse changes there. Stop on any mismatch.

Mocked tests and migration guards cannot prove real PostgreSQL locking,
concurrency, transaction rollback, import correctness, or data preservation.

## 6. Controlled data transfer and local backups

### Source and destination identification

- The current proposed source is Render's backing database, but a data owner
  or DBA must identify the actual database target out of band. The public
  service URL does not establish it.
- Neon remains untouched. Do not export from or write to Neon as part of the
  selected path; do not assume Render and Neon are independent data stores
  until the DBA identifies their relationship.
- The destination must be a newly created, empty local PostgreSQL instance
  with a unique approved label. Never overwrite an existing local `bigbites`
  or `bigbites_neon_stage` database.
- Record target labels/approval references, not URLs, credentials, or secrets
  in logs or reports. Reconfirm source and destination identity immediately
  before any separately approved operation.

### Approval-gated transfer outline

1. Owner approves the exact source, read-only export, included entities,
   treatment of user password hashes, operator, export format, encryption,
   and transfer retention.
2. DBA captures a consistent source snapshot and preserves an immutable
   original. Store the export encrypted and access-controlled; do not place it
   in the repository, installer, APK, or ordinary logs.
3. Restore/rehearse only into the new isolated local target after the
   migration/schema strategy and target identity are approved. Never import
   into Render or Neon.
4. Validate counts and foreign-key relationships for users/roles, menu,
   variants, stock and movements, settings, orders/items, and payments.
   Compare financial totals and stock/movement aggregates without disclosing
   personal or payment details. Verify duplicate/conflict handling and
   idempotency only if the approved importer explicitly supports it.
5. If any data mismatch, partial write, missing inventory field/history, or
   failed health/function test appears, stop. Preserve the source export,
   discard or restore only the authorized isolated destination, and document
   the mismatch. Do not "repair" migration history to make import pass.
6. For client recovery, provide an operator-approved backup schedule,
   encrypted backup location, retention period, restore steps, and periodic
   restore test on a separate isolated database. Back up before application
   upgrades; preserve data across uninstall/reinstall.

No transfer, backup, restore, provisioning, or database command is authorized
by this design.

## 7. Packaging, support, and client experience

### Minimum client deliverables

- Signed Windows x64 NSIS desktop installer containing the reviewed desktop,
  canonical backend, Prisma Client/runtime and approved schema resources, and
  Windows setup/service scripts.
- Signed waiter Android APK for package identity
  `com.bigbites.familyrestaurant.waiter`, with release signing verified.
- Required PostgreSQL/Node runtime installed or packaged through an approved,
  version-pinned distribution process. The client must not manually install
  PostgreSQL, enter a DB URL, start a terminal server, or type a phone IP.
- Client installation guide, troubleshooting/connection guide, local backup
  and restore guide, and release validation report.

Tauri currently targets NSIS and packages resources from `apps/server`. The
APK signing is not considered proven from source configuration alone. No
installer/APK was built or inspected in this Stage B design.

### Acceptance tests before client release

**Clean Windows install and lifecycle**

- Install on a clean supported Windows x64 machine without a pre-existing
  PostgreSQL service; verify exact PostgreSQL version/service, local-only
  database listener, restricted app role, secrets ACLs, and successful
  startup.
- Install where another PostgreSQL instance exists and where ports 5432,
  3000, or 3001 are occupied; verify setup identifies conflicts and stops
  safely without connecting to or altering an unrelated instance.
- Reboot; verify PostgreSQL starts before the API, API task/service recovery
  works, the desktop reports clear errors if either service is down, and logs
  do not reveal credentials.
- Run upgrade/reinstall with a populated local test DB; prove application
  file update preserves database and settings, verifies a backup restore, and
  stops on unexpected schema/ledger state.
- Uninstall/reinstall must not delete or silently replace client data.

**Functional regression**

- Login and admin/cashier/waiter role restrictions.
- Menu/categories/products/variants and ordering.
- Stock display/adjustment, stock deduction, insufficient-stock rejection,
  movement history, cancellation restoration, and transaction rollback.
- Table and parcel orders, order status, billing, cash/UPI/card and supported
  cash-plus-UPI split payments, GST, history, and reports.
- Receipt formatting, printer selection/printing, and error/retry behavior.
- Persistent data survives app/server/PC restart and a tested local backup
  restores into a distinct test destination.

**Waiter LAN and offline**

- Phone discovers the correct POS host automatically over approved private
  Wi-Fi; no manual IP entry.
- Verify UDP discovery and TCP API through Windows Firewall on supported
  router/AP configurations, with client isolation disabled as required.
- Verify timeout, retry/manual retry, database-disconnected, server-stopped,
  and wrong-server messages.
- Disconnect internet while keeping LAN active; login, ordering, status, and
  local billing must continue without a Render/Neon fallback.
- Confirm the phone cannot send application traffic to an unintended
  production URL in the standard APK configuration.

**Artifact integrity**

- Build from one reviewed source revision; record source revision and hashes.
- Verify installer and APK signatures, package identity/version, and
  provenance. Do not overwrite existing artifacts during build.
- Install artifacts on separate clean Windows and Android devices and repeat
  the acceptance scenarios.

## 8. Dependencies and unresolved decisions

### Must be resolved before database implementation

1. Per-target sanitized migration ledger/checksum and actual-schema evidence,
   including inventory, movement history, variants, payment fields, and
   settings.
2. Verified restore of a source backup into a separate isolated database.
3. Data owner confirmation of Render's actual backing database and approval
   of the exact export scope. Do not access Render/Neon in this design.
4. Approved target-specific strategy for the destructive migration and a
   fresh local database schema. Until then, migration status remains
   **UNKNOWN** and database changes are blocked.
5. Explicit authorization for a new isolated PostgreSQL instance, later test
   migrations/import, and eventual client deployment—each separately.

### Must be decided for productized installer

- Supported Windows versions/privileges and PostgreSQL version/distribution.
- Whether PostgreSQL should also be bundled for fully offline installation;
  the current installer downloads it only when absent.
- Service account, local DB/listener binding, API LAN bind strategy, and
  firewall profiles/ports.
- Port-conflict policy and how the installer proves the responding API is
  this installation.
- Secret protection at rest and secure setup input; local `.env` ACL alone is
  not encryption.
- Backup frequency, encryption, retention, off-device copy, restore owner,
  and support procedure.
- Source-of-truth policy for catalog and transfer of employee credentials.
- Android version/device support and network conditions for broadcast
  discovery.
- Client printer models, receipt expectations, signing ownership, versioning,
  and release/update channel.

## 9. Staged implementation and approval gates

| Stage | Work | Approval / exit gate |
| --- | --- | --- |
| A — Read-only inspection | Completed in [`LOCAL_CLIENT_CONVERSION_PLAN.md`](LOCAL_CLIENT_CONVERSION_PLAN.md); repository and worktree review only. | No DB/external access; existing work preserved. |
| B — Deployment design | This document: architecture, current installer/API evidence, gaps, tests, and approvals. | Owner reviews this design; no implementation or DB operation yet. |
| C — Source evidence | Authorized DBA collects separate sanitized ledger/schema reports and verified-restore evidence. | Explicit authorization for read-only collection; Render and Neon remain unchanged. |
| D — Migration/data strategy | Application maintainer and DBA propose exact history-preserving new-local initialization and import; reconcile all mismatches. | Owner approves exact source, data scope, target strategy, backup/recovery, and test plan. No automatic migration selection. |
| E — Isolated implementation/rehearsal | After approval, implement minimal installer/API changes; create a new isolated DB; rehearse approved schema/import and integration tests. | Separate explicit approval for target provisioning and exact DB operations; stop on discrepancies. |
| F — Packaging and acceptance | Build signed installer/APK, install on clean devices, run Windows/LAN/offline/function/restore tests, record hashes and results. | Only after Stage E evidence; release owner approves final artifacts. |
| G — Client rollout | Deliver packages and guides; preserve local data through upgrades and support. | Client acceptance and documented backup/restore ownership. |

No stage authorizes changes to Render or Neon. Approval for one stage does
not imply approval for later database, import, or release operations.

## 10. Relevant files inspected

- Planning/evidence: `docs/LOCAL_CLIENT_CONVERSION_PLAN.md`,
  `docs/DATABASE_EVIDENCE_COLLECTION.md`,
  `docs/MIGRATION_RESOLUTION_PROPOSAL.md`,
  `docs/PRODUCTION_DATA_MIGRATION_AUDIT.md`,
  `docs/SAFE_POSTGRESQL_TEST_PLAN.md`,
  `docs/RELEASE_READINESS_CHECKLIST.md`.
- Installer/runtime: `apps/desktop/src-tauri/tauri.conf.json`,
  `apps/desktop/src-tauri/windows/Install-BigBites.ps1`,
  `apps/desktop/src-tauri/windows/Start-BigBitesServer.ps1`,
  `apps/desktop/src-tauri/windows/Initialize-BigBites.ps1`,
  `apps/desktop/src-tauri/windows/installer.nsh`.
- Backend: `apps/server/src/config/database.ts`,
  `apps/server/src/server.ts`,
  `apps/server/scripts/run-start-migrations.cjs`,
  `apps/server/scripts/assert-safe-migrations.cjs`,
  `apps/server/prisma/schema.prisma` and migration tree.
- Clients/signing/network: `apps/desktop/src/App.tsx`,
  `apps/desktop/src-tauri/src/lib.rs`,
  `apps/waiter_app/lib/services/api_service.dart`,
  `apps/waiter_app/lib/main.dart`,
  `apps/waiter_app/android/app/src/main/AndroidManifest.xml`,
  `apps/waiter_app/android/app/build.gradle.kts`,
  `apps/waiter_app/pubspec.yaml`.

The source/runtime comparison is documented in
[`MIGRATION_RESOLUTION_PROPOSAL.md`](MIGRATION_RESOLUTION_PROPOSAL.md) and
[`RELEASE_READINESS_CHECKLIST.md`](RELEASE_READINESS_CHECKLIST.md). The
standalone bundle is not recommended as a client runtime without a separately
reviewed deterministic rebuild from canonical source.

## 11. Current status

- **Local architecture:** present in source/configuration; end-to-end behavior
  not verified by this design.
- **Migration status:** **UNKNOWN** on all databases.
- **Canonical/standalone parity:** **FAIL**; Tauri's configured resource
  source is canonical, but package contents have not been built/verified.
- **Data transfer:** **BLOCKED** pending source identity, owner approval,
  schema/ledger evidence, verified restore, and an approved import strategy.
- **Client package:** **NOT READY / BLOCKED**; no artifact compatibility or
  end-to-end acceptance is established.
- **Render/Neon:** untouched; no external service or database was accessed.

The safest next step is owner/DBA review of the per-target evidence form and
verified backup-restore evidence. Do not run the installer, initialize a
database, migrate, export/import, or build client artifacts until the required
gates are met.
