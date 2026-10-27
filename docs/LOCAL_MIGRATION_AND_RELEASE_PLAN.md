# BIG BITES POS Local Migration and Client Release Plan

**Prepared:** 2026-10-23
**Status:** Planning only. No production connection, export/import, database
operation, migration, installer, build, or deployment was performed.

## 1. Decision summary

**NO-GO for data transfer, local cutover, and client release at this time.**
Continue operating the existing Render/Neon service as-is while the owner and
DBA establish the exact production target, migration ledger/schema state, and
verified backup recovery evidence. The repository contains a migration that
drops inventory fields and stock-movement history. Its status on every actual
target remains unknown.

The current canonical source contains POS models and routes for inventory,
stock movements, variants, orders, payment tenders including CASH+UPI, GST,
and reporting. The current Windows installer is a local empty-database setup
path, not a production-data migration tool. Its migration preflight rejects the
checked-in stock-removal migration, so an installer operation is not a safe
way to test or transfer data. The existing `migrate-production-data.cjs` is
limited to isolated loopback test databases and is not approved for production
export/import.

This plan does not select a target-specific migration sequence or authorize
changes to Render, Neon, or any local database.

## 2. Verified current architecture

### Canonical backend and persistence

- Canonical Express/TypeScript source: `apps/server/src`.
- Canonical Prisma schema and migrations:
  `apps/server/prisma/schema.prisma` and `apps/server/prisma/migrations/`.
- Runtime database configuration is read from `DATABASE_URL` in
  `apps/server/src/config/database.ts`. Local/non-production mode enforces a
  loopback PostgreSQL URL. This source does not identify the production
  provider or database identity.
- Canonical models include:
  - Product stock quantity, unit, threshold, and last-update time.
  - `ProductStockMovement` linked to Product.
  - `ProductVariant` and nullable `OrderItem.variantId`.
  - Users and roles, tables, orders/items, payments, restaurant settings,
    GST, discounts, restaurant compliance/address settings, and report path.
  - `PaymentMethod` values CASH, UPI, CARD, and CASH_UPI, with received,
    change, cash, and UPI amount fields.
- User passwords are stored as password hashes. Authentication tokens are
  signed using `AUTH_SECRET`; the token implementation is stateless and the
  Prisma schema has no server-side session model. The migration operator must
  preserve hashes as authorized and decide whether the local cutover rotates
  `AUTH_SECRET` (which invalidates existing tokens).

### Production target identity is unresolved

- `docs/DATABASE_EVIDENCE_COLLECTION.md` proposes the Render-connected
  database as a possible source, subject to DBA confirmation.
- `docs/PRODUCTION_DATA_MIGRATION_AUDIT.md` includes historical statements
  naming Neon as the configured target.
- The runtime uses `DATABASE_URL`; no provider identity is hardcoded in the
  canonical database module.
- These statements do not prove the current backing database, whether Render
  and Neon are related, or which contains the authoritative client data.
  Owner/DBA confirmation is required; neither target was accessed for this
  plan.

### Desktop, Windows host, and waiter

- Tauri configuration in `apps/desktop/src-tauri/tauri.conf.json` builds the
  desktop frontend and canonical server and packages server `dist`,
  `node_modules`, Prisma schema/migrations, and Windows lifecycle scripts.
  It targets a per-machine NSIS installer.
- The installer script expects local PostgreSQL on loopback port 5432 and
  creates/uses a `bigbites_app` role and `bigbites` database. It writes local
  `DATABASE_URL`, `AUTH_SECRET`, and local-mode configuration under
  `%ProgramData%\BIG BITES POS\server\.env`.
- The installer checks existing local migration state and creates a custom
  format backup before pending migrations. It validates that archive with
  `pg_restore --list`; that is not a restore rehearsal.
- It bundles a private Node.js runtime and downloads/signature-verifies the
  official PostgreSQL 17.11 installer when PostgreSQL is absent; neither path
  depends on `winget`. Internet access is required for that fresh PostgreSQL
  download.
  configures TCP 3000 and UDP 3001 firewall rules scoped to `LocalSubnet`,
  registers a SYSTEM startup task, and checks API/database health and LAN
  discovery. These behaviors have not been runtime-validated in this plan.
- The current active installer replaces backend files in the active server
  directory before later migration/firewall/task/health operations. A staging
  helper exists but is not integrated. Do not describe current upgrades as
  atomic or fully recoverable.
- Server defaults to TCP 3000 and UDP discovery 3001 and binds to `0.0.0.0`
  unless overridden. `/health` queries PostgreSQL and reports API/database
  status. Startup task invokes `node dist/server.js` directly.
- The desktop Tauri API default is loopback TCP 3000. A build-time
  `VITE_API_URL` can override it.
- The waiter uses UDP broadcast discovery on 3001, accepts a private IPv4
  response for HTTP API port 3000, then checks `/health`. A non-empty build
  time `API_BASE_URL` bypasses discovery. Android manifest permits cleartext
  HTTP, so the proposed local layout requires a trusted LAN and scoped
  firewall; transport security remains a separate security decision.

### Render/Neon runtime dependency

- `apps/server/src/routes/admin.ts` contains an optional production catalog
  sync endpoint that fetches categories/products/variants from the fixed
  Render service URL. The endpoint is gated by
  `BIGBITES_ENABLE_PRODUCTION_CATALOG_SYNC` and requires the installed local
  database. The Windows startup script sets the flag to false.
- The inspected waiter API service has no Render/Neon fallback; standard
  discovery uses the local LAN API. Desktop requests use its configured API
  URL.
- Therefore, source supports local billing without an intentional remote
  fallback under the intended local configuration, but a complete claim of
  internet-independent operation requires package/configuration inspection
  and offline acceptance testing. Optional production catalog sync is an
  explicit external dependency when enabled.

## 3. Schema and migration conflict

The canonical migration directory has 16 migration directories; the
standalone `BIG-BITES-SERVER-CLIENT` tree has 12. The standalone schema/runtime
is not feature-equivalent and must not be used as the data-transfer or release
source. It lacks inventory movement model/history, variants and variant
order-links, split tender fields, and other current settings. Four canonical
migration directories are absent from standalone:

- `20261006220000_add_gst_toggle_and_order_reports`
- `20261009230000_menu_variants_classification`
- `20261013010000_cash_upi_split_payment`
- `20261013213000_add_product_stock_movements`

Both migration trees contain `20261020100000_remove_product_stock`. The
canonical SQL drops `ProductStockMovement` and Product columns `stock`,
`stockUnit`, `lowStockThreshold`, and `lastStockUpdatedAt`. The repository
file's SHA-256 in this checkout is
`06364D5F7BCF2E4C105F8D5D74A185BF26017B2D9B5648E6439F61F86F7E58DF`.
This checksum identifies only the local migration file; it is not the
database ledger checksum or proof of application state.

Canonical and standalone startup preflights reject destructive/incomplete
migration sets in their guarded production startup paths. The installer also
rejects this migration and inventory-incomplete resources before stopping the
current server or reaching its direct `migrate deploy` operation. Direct
Prisma CLI commands can bypass these guards. Guard tests prove repository
checks and ordering—not target compatibility, actual schema, stored data,
backup validity, or migration ledger state.

**Do not run `migrate deploy`, `db push`, `migrate resolve`, reset, or seed to
work around this conflict.** If the migration is pending, applying it destroys
stock values and movement history. If it already ran, restoring empty fields
or an empty movement table cannot recover that data. Any target-specific
correction requires reconciled ledger and actual-schema evidence, a verified
restore, and a separately approved forward-only plan.

## 4. Existing data-transfer code assessment

`apps/server/scripts/migrate-production-data.cjs` is an existing importer, but
it is not a production transfer path:

- `validateEndpoints` requires both source and target to be loopback
  PostgreSQL databases on non-default ports, `NODE_ENV=test`, with a
  specifically named isolated source clone and `bigbites_test_*` destination.
  It must remain test-only; do not relax these checks to point it at production.
- It uses a repeatable-read read-only source transaction and a serializable
  target transaction. It validates schema, maps records, verifies IDs,
  foreign keys, counts and financial totals, advances sequences, and commits
  or rolls back the target transaction.
- It preserves target-local stock fields when matching products, and transfers
  stock fields for new products; movement history is imported when present.
  Conflicts and support for optional legacy payment fields are implemented in
  code but not fully validated against a real database in this task.
- Two database-backed integration tests are skipped without explicitly
  configured disposable endpoints. Existing tests do not establish production
  import safety or behavior under real PostgreSQL locking/rollback.
- It assumes a target schema with all required current tables and fields. It
  does not resolve Prisma migration history or apply a safe schema conversion.
- It includes password-hash fields in the mapped user data; any future transfer
  requires explicit owner approval for authentication data scope and secure
  handling. Never export clear-text passwords or log user/payment records.

`apps/server/prisma/seed/seed.ts` and
`apps/desktop/src-tauri/windows/Initialize-BigBites.ps1` are for explicitly
confirmed empty local databases. They create initial accounts/menu and are
not import tools. Do not use them against an existing target or imported
production snapshot.

## 5. Approval-gated data-preserving migration proposal

No executable sequence is approved while target identity, ledger, schema, and
backup evidence are unknown. After separately approved evidence collection:

1. **Identify each target.** Owner/DBA confirms actual production backing
   database, authoritative source, local destination label, and that Render
   and Neon are not being conflated. Keep each environment's evidence
   independent.
2. **Capture a consistent source snapshot.** Authorized DBA uses an approved
   read-only source role and a consistent PostgreSQL backup/export method.
   Preserve the immutable original, record a cryptographic digest, encrypt it
   in transit and at rest, restrict access, and define retention/destruction.
   No production writes, migrations, or seeds are part of capture.
3. **Restore to an isolated rehearsal target.** Provision a separately
   approved disposable PostgreSQL instance/database isolated from production
   networks. Restore the snapshot there; verify PostgreSQL version, extensions,
   encoding/collation, ownership/privileges, sequences, enums, constraints,
   and schema. Preserve the source ledger; do not blindly apply the repository
   migration tree to imported data.
4. **Reconcile migration history and schema.** Compare full ledger names and
   checksums with a pinned canonical source revision, then compare actual
   catalog metadata. Specifically determine stock-removal status and inventory
   data presence. Owner, DBA, and application maintainer must approve any
   history-preserving correction before it is authored or applied. Do not
   alter migration history to make a deploy pass.
5. **Choose one transfer model.** If the approved source backup is already a
   complete database image and a compatible, reviewed schema/runtime can
   operate on that restored image, validate it as such rather than importing
   duplicate rows. If a selective data import is required, first reconcile
   schema and migration history, then review the importer field-by-field and
   authorize a separate target-only rehearsal. The current importer is
   test-only and is not authorized for production-source URLs.
6. **Preserve identity and references.** Preserve primary keys where safe;
   map references if local data is to be merged. Preserve timestamps,
   user/password hashes only with owner approval, categories/products,
   stock quantities and movement history, variants, table/order/item
   relationships, payments, tender values, settings and report metadata.
   Never infer missing movements or overwrite local-only stock/history.
7. **Reconcile results without exposing records.** Compare per-table counts,
   key/foreign-key integrity, inventory totals and per-product stock,
   movement counts/quantity deltas, variant/order-item links, order totals,
   payment totals by status/method/tender, and GST/report configuration.
   Record only aggregate outcomes and sanitized discrepancies. Confirm
   sequence next values and idempotency/conflict behavior.
8. **Restore rehearsal and sign-off.** Rehearse backup restore into another
   separate disposable target and demonstrate validation/recovery. Owner,
   DBA, and application maintainer sign off on exact source, target, migration
   files/checksums, expected effects, backup/restore evidence, stop conditions,
   and rollback before any production data transfer or cutover.
9. **Controlled cutover only after separate approval.** Keep Render/Neon
   untouched and available until local acceptance. Approve a maintenance
   window, define a write freeze or final consistent-delta strategy, reconcile
   the final source snapshot, and decide how to prevent split-brain writes.
   Do not call a one-time earlier snapshot current if production continued
   changing.

### Compatibility evidence to include

- PostgreSQL major version, extensions, encoding, collation, timezone
  assumptions, enum labels/order, identifier casing, sequences, and required
  privileges.
- Schema and migration checksum parity; `ProductStockMovement`,
  Product stock columns, variants, `OrderItem.variantId`, payment fields and
  `PaymentMethod` values, GST/report fields, and all required foreign keys.
- Password-hash algorithm compatibility from `apps/server/src/utils/password.ts`.
  Do not transfer clear-text credentials. Decide whether changing local
  `AUTH_SECRET` is required; it invalidates previously issued stateless tokens.
- Any file-backed report artifacts and paths are not carried by PostgreSQL
  data alone. Owner decides whether historical workbooks need separate
  controlled transfer; verify report path is appropriate for the local host.

## 6. Combined local installation design

Retain the existing architecture: canonical Node/Express backend and local
PostgreSQL on the POS Windows host; desktop uses loopback API; waiter uses
private-LAN discovery and API. Do not substitute the standalone tree.

Required decisions and acceptance before release:

- **Database lifecycle:** define whether PostgreSQL is installed/managed by
  this package or an existing service is supported. Current installer may
  install PostgreSQL 17 or reuse a detected instance, uses fixed port 5432,
  and configures PostgreSQL authentication as part of setup. Validate service
  ownership, local-only binding, least-privilege app role, credential
  generation/storage, existing-instance protections, and restoration of
  `pg_hba.conf` in an isolated VM.
- **Import-aware setup:** current initializer rejects non-loopback endpoints
  and seeds only an empty database. Do not run it after production restore.
  Design a separately approved import/restore workflow that verifies the
  exact local target and never invokes seed on populated data.
- **Backups/recovery:** define encrypted automated local backup cadence,
  retention, access control, off-device copy policy, restore rehearsal, and
  incident responsibility. `pg_restore --list` checks archive readability,
  not restorability. Application-file rollback must not be treated as database
  rollback.
- **Server lifecycle:** test PostgreSQL boot ordering, SYSTEM task ownership,
  Node path, process identity, port conflicts, retries, logs, stop/uninstall,
  recovery after crashes, and health endpoint process identity. Current
  installer directly replaces active backend files before later setup steps;
  staged helper remains unintegrated and does not protect current upgrades.
- **Network:** test firewall restrictions on TCP 3000 and UDP 3001, private
  IPv4 discovery across actual client Wi-Fi, reconnects, duplicate requests,
  concurrent orders, and clear failure behavior. Keep PostgreSQL port 5432
  unavailable to LAN clients.
- **Secrets/authentication:** generate unique per-installation DB credentials
  and `AUTH_SECRET`; protect local configuration with ACLs. Do not reuse
  production credentials or include them in installers, APKs, logs, reports,
  screenshots, or shell history.
- **No remote fallback:** standard desktop and waiter must use local API only.
  Keep production catalog sync disabled in the packaged local runtime. Test
  with internet disconnected after installation; document any dependency on
  initial `winget` runtime downloads, licensing, or update checks.
- **Release packaging:** pin/review a source revision, verify package contents
  and resource paths, record hashes/signing identity/provenance, and build
  only after schema/migration approval. Never overwrite existing EXE/APK
  artifacts or modified/untracked files during preparation.

## 7. Feature-parity acceptance matrix

Run only against synthetic data in a separately approved disposable
environment. Capture pass/fail and aggregate counts, not customer data.

| Area | Acceptance evidence |
| --- | --- |
| Admin/cashier/waiter authentication | Login, role authorization, password-hash verification, token invalidation decision, recovery after restart. |
| Menu/catalog | Categories/order, active products, classification, variants/prices, optional production sync disabled in local mode. |
| Inventory | Initial quantities, unit/threshold/last update, stock adjustments, before/after movements, audit history, low-stock behavior. |
| Orders | Table and parcel order creation, additions, variants, cancellation authorization, historical orders/items, duplicate/retry handling. |
| Payments | CASH, UPI, CARD, CASH_UPI; amount received/change; persisted totals/history and payment status. |
| GST/reports/settings | Order GST snapshots, settings, report summaries/export, restaurant address and FSSAI/GSTIN fields. |
| Concurrency | Real PostgreSQL stock locking, insufficient-stock prevention, concurrent order/payment behavior, transaction rollback. |
| Desktop | API recovery/errors, billing/admin, receipt flow, report save without overwrite, restart behavior. |
| Waiter/LAN | Discovery without manual IP, health validation, login/order flow, reconnect and duplicate requests, network loss handling. |
| Persistence/recovery | Reboot, backup, restore to separate test DB, reinstall/upgrade/uninstall preserving database, `.env`, logs, backups, stock and order history. |

## 8. Rollback and cutover controls

- Keep the source Render/Neon system unchanged and available through rehearsal
  and formal client acceptance.
- Store immutable source backup and a tested restore path separately from the
  target; record access and retention policy.
- During rehearsal, discard or restore only the explicitly approved disposable
  target. Never overwrite a live source or ambiguous local database.
- Before cutover, define who can authorize a stop, how the final snapshot/delta
  is captured, and how billing/waiter writes are paused to prevent split-brain
  operation.
- If local acceptance fails before the new system accepts real writes, route
  the client back to the unchanged online system under the approved plan.
- Once local writes begin, do not simply switch back: reconcile local writes
  back to the source or keep local authoritative under an owner-approved
  recovery plan. No automatic reverse migration or data rollback is assumed.
- Preserve database backups, `.env`, logs, report files, and PostgreSQL data
  during application upgrades/uninstall. Test on a disposable VM.

## 9. Exact owner/DBA approvals and evidence still required

Before any implementation that changes database behavior or any transfer:

1. Confirm actual provider/database identity, service association, intended
   source of truth, and owner authorization out of band. Resolve Render versus
   historical Neon references.
2. Provide a sanitized per-target `_prisma_migrations` report containing
   migration names, checksums, started/finished/rolled-back timestamps and
   explicit stock-removal status.
3. Provide actual schema metadata for stock columns/table, stock movements,
   variants and order-item links, all payment/tender fields and enum values,
   GST/report settings, relationships, indexes, sequences, and relevant
   PostgreSQL extensions/version.
4. Provide evidence of a source backup restored and validated in a different,
   isolated database/instance, with operator, time, destination label, and
   validation reference.
5. Approve exact data scope, including historical orders/payments and password
   hashes, export format, encryption, transfer operator, retention/disposal,
   and client identity/user handling.
6. Approve a target-specific, history-preserving migration/schema plan; exact
   files/checksums; isolated test target; expected before/after state; recovery
   path; execution window; stop conditions; and owner/DBA/application sign-off.
7. Separately approve production read-only evidence collection, disposable
   database provisioning, migration/import rehearsal, and later cutover.
   Approval for one is not approval for the next.
8. Confirm the local deployment contract, supported Windows/PostgreSQL
   versions, hardware/LAN/firewall, Android devices, printer/report
   expectations, backup retention, support owner, and client acceptance
   criteria.

Use [DATABASE_EVIDENCE_COLLECTION.md](./DATABASE_EVIDENCE_COLLECTION.md) for
the sanitized evidence form. Do not send credentials, URLs, passwords, tokens,
customer rows, payment details, or backup contents in chat or reports.

## 10. Candidate files for later approved implementation

This is a review list, not permission to edit or execute them:

- **Schema/migration:** `apps/server/prisma/schema.prisma`,
  `apps/server/prisma/migrations/`, `apps/server/scripts/assert-safe-migrations.cjs`,
  `apps/server/scripts/run-start-migrations.cjs`, and corresponding migration
  tests. Do not delete, rewrite, rename, or reorder historical migrations.
- **Data transfer:** `apps/server/scripts/migrate-production-data.cjs` and
  `apps/server/tests/production-data-migration.test.cjs`. Keep current
  loopback/test-only restrictions; any separate production transfer proposal
  requires its own review and authorization.
- **Local DB lifecycle:** `apps/desktop/src-tauri/windows/Install-BigBites.ps1`,
  `Initialize-BigBites.ps1`, `Start-BigBitesServer.ps1`,
  `Stop-BigBitesServer.ps1`, and `installer.nsh`. Review staging/recovery,
  PostgreSQL binding/authentication, backups/restores, task/firewall lifecycle,
  and existing-data preservation.
- **Packaging/configuration:** `apps/desktop/src-tauri/tauri.conf.json`,
  desktop API config in `apps/desktop/src/App.tsx`, server config in
  `apps/server/src/config/database.ts` and `apps/server/src/server.ts`.
- **Waiter:** `apps/waiter_app/lib/services/api_service.dart`,
  `apps/waiter_app/lib/main.dart`, Android manifest/build signing
  configuration, and isolated device tests.
- **Documentation/release evidence:** reconcile
  `docs/WINDOWS_CLIENT_DEPLOYMENT.md`,
  `docs/RELEASE_READINESS_CHECKLIST.md`,
  `docs/PRODUCTION_DATA_MIGRATION_AUDIT.md`,
  `docs/DATABASE_EVIDENCE_COLLECTION.md`, and this plan after approvals.
- **Standalone tree:** do not copy compiled files or migration resources into
  `BIG-BITES-SERVER-CLIENT`. Resolve its supported status and parity
  separately; use canonical source for a release only after a pinned review.

## 11. Safe checks and approval-gated actions

Safe source-only checks that can run without a database or network include:

- `node --test apps/server/tests/production-data-migration.test.cjs` with all
  `BIGBITES_MIGRATION_TEST_*_URL` variables empty. The DB-backed tests must
  remain skipped; a test result is not permission to configure endpoints.
- `node --test apps/desktop/src-tauri/windows/lifecycle-config.test.cjs`;
  staging tests use temporary directories and extracted helper functions.
- `node --check` for migration guard/startup scripts.
- PowerShell parser-only syntax validation for installer/lifecycle scripts.
- `git diff --check` and source/config path review.

Do not run installer/setup/initialize/start/stop scripts, builds, seed scripts,
Prisma migration/status/deploy/resolve/reset/push commands, database imports,
exports/backups/restores, or network/service calls in this planning phase.

The following require separate explicit owner approval and a reviewed
runbook: read-only production database evidence collection; backup/export;
isolated database provisioning; restore rehearsal; schema/migration correction;
data import; installer integration; production cutover; deployment; and
client handover.

## 12. Result

- Existing Git changes and untracked files were preserved; no application or
  production configuration was edited.
- No database, Render, Neon, or external service was contacted. No installer,
  migration, seed, import/export, build, or deployment was run.
- Migration state is **UNKNOWN** for every intended target.
- Local installation source and the existing importer do not currently form an
  approved production-data transfer workflow.
- Client data migration, local cutover, and release remain **BLOCKED** pending
  owner/DBA evidence, a history-preserving plan, an isolated restore/import
  rehearsal, and Windows/Android acceptance.
