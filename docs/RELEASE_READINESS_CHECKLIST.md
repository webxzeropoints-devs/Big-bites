# BIG BITES POS Release Readiness Checklist

**Review date:** 2026-10-25
**Scope:** Source review, local builds, static tests, and non-destructive
validation. This checklist does not authorize a live installer run, database
access, migration, import, or deployment.

Statuses:

- **PASS** — verified with the cited evidence and scope.
- **FAIL** — a confirmed defect or incompatibility exists.
- **BLOCKED** — cannot safely verify or proceed without approval/evidence.
- **NOT RUN** — intentionally not tested in this review.
- **UNKNOWN** — evidence is insufficient to decide.

## A. Source integrity

| Check | Status | Evidence / limitation |
| --- | --- | --- |
| Existing worktree changes preserved | PASS | The worktree contains pre-existing modified and untracked files. No reset, clean, checkout, or bulk restore was used. |
| TypeScript backend build | PASS | `npm run build` in `apps/server` passed through the NSIS build's `beforeBuildCommand`; Prisma client generation used a loopback port-1 code-generation URL. This is not database compatibility evidence. |
| Backend route/migration tests | PASS, scoped | `npm run test:financial`: 73 tests, 71 passed, 0 failed, 2 skipped. |
| Database-independent importer unit cases | PASS, scoped | Included in the focused backend test run; no database was contacted. |
| Database-backed importer tests | BLOCKED / SKIPPED | Two integration cases remain skipped because no explicitly authorized, verified disposable database and source fixture are configured. |
| Canonical Prisma schema syntax/validation | PASS, scoped | A prior source-only `prisma validate` used a loopback port-1 URL. Validation does not connect to or verify any target database. |
| Desktop frontend and Tauri NSIS build | PASS, artifact only | `npm run tauri -- build --bundles nsis` completed. The output installer is unsigned and not client-ready; it was not run. |
| Waiter analysis, tests, and release APK | PASS, artifact only | `flutter analyze` found no issues; `flutter test` reported 2 passed; release APK build succeeded with version code 2 and the same signing certificate as the preserved prior APK. No device/backend acceptance test was run. |
| Migration script syntax / installer PowerShell parsing | PASS | `node --check` passed for importer and migration guards; PowerShell parser accepted all four Windows lifecycle scripts. |
| Installer lifecycle tests | PASS, scoped | Latest focused run: 37 passed, 0 failed, 1 skipped (Windows symlink creation unsupported), including fresh Node/winget-absent runtime selection, installer failure/recovery, and PostgreSQL option-file/download verification mocks. |
| Private Node runtime packaging | PASS, source-only | The signed Node.js 24.19.0 x64 executable and its license are bundled; a pinned SHA-256, version, architecture, and node-less/winget-less regression check passed. The actual built installer still requires resource inspection and fresh-PC testing. |
| PostgreSQL package acquisition | PASS, mocked/source-only | The source downloads the official EnterpriseDB PostgreSQL 17.11 installer, verifies its Authenticode publisher, keeps the superuser password in a protected temporary option file, and rejects unrelated fresh-install services/port conflicts. The real 413 MB download, installer option-file parsing, and PostgreSQL service creation were not exercised. |
| Focused `git diff --check` | PASS | Passed for the credential and evidence-report changes. A later repository-wide check flags a pre-existing blank line at EOF in `BIG-BITES-SERVER-CLIENT/prisma/schema.prisma`; that unrelated file was not changed. |
| Sensitive data in new reports/logs | NOT RUN | No credentials or customer data were intentionally included. A full secret-scanning review was not part of this checklist. |

### Focused commands and results

Most recent combined focused run:

```text
cd apps/server
NODE_ENV=test
DATABASE_URL=<loopback port 1, not a live endpoint>
node --test tests/orders.test.cjs tests/production-data-migration.test.cjs
```

Result: **20 tests; 18 passed, 0 failed, 2 skipped**. The two skipped tests
are database-backed importer cases. Route behavior was exercised with mocks;
migration checks used file fixtures/static source checks.

The command was run from PowerShell with all three
`BIGBITES_MIGRATION_TEST_*_URL` variables set to empty values. `DATABASE_URL`
was set to a dummy loopback port-1 value needed for importing the Prisma
module in the mocked tests; no database connection was made. The placeholder
above is descriptive only; no connection string is included in this report.

`npm run build` in `apps/server` passed in the preceding source-only
verification. That build's Prisma code-generation URL is a loopback port-1
placeholder; it does not establish database compatibility.

The latest focused catalog validation ran `npm run build` in `apps/server`
with a loopback port-1 Prisma code-generation URL, followed by
`node --test tests/products.test.cjs`: build passed and 1 mocked route test
passed. Read-only Prisma probes against local databases found 5 categories in
`hotel_pos`; the canonical category query succeeded, while the product query
failed with P2022 because `Product.stock` is absent. Against
`hotel_pos_recovery_check`, category and product queries succeeded with 15
categories, 129 products, and 32 active variants. No migration or write query
was run.

Latest backend verification ran `npm test` (TypeScript check) and
`npm run test:financial` (73 tests; 71 passed, 0 failed, 2 database-backed
importer tests skipped). `npm run test:orders` also passed all 9 tests.
`node --check` passed for the importer and canonical migration scripts.
PowerShell parsing passed for the installer, initializer, startup, and
shutdown scripts. The desktop NSIS build and signed Flutter release APK build
completed; their isolated artifact paths and hashes are recorded in the
release-candidate workspace, not approved for client distribution.

## B. Database compatibility

| Check | Status | Evidence / limitation |
| --- | --- | --- |
| Canonical Prisma schema reviewed | PASS, source only | `apps/server/prisma/schema.prisma` declares inventory, stock movement, variants, split-payment amounts, and current settings/order fields. |
| Canonical/standalone runtime parity | FAIL | Standalone schema omits inventory, movement, variants, category sort/classification, split-payment fields, and GST/report settings. Standalone compiled order/admin routes still include stock deduction/restoration, but not movement history or variant-aware order items; compiled billing lacks split tender support. |
| Guard coverage for normal migration entry points | PASS, source-only | Canonical/standalone `npm start` prestart scripts and installer preflight reject the current unsafe/incomplete migration resources before their migration command. Static guards do not establish target compatibility. |
| Migration bypass limitation | BLOCKED / DOCUMENTED | Direct Prisma CLI invocation bypasses app/installer guards. Direct `node dist/server.js` bypasses npm prestart but does not itself invoke migrations. |
| Installed local database target identified | PASS, evidence provided | Sanitized, elevated process/service evidence identifies `bigbites` at `127.0.0.1:5432`. This does not identify the authoritative source for customer data or approve a live repair. |
| IPv4/IPv6 database identity reconciled | BLOCKED | Same-name `hotel_pos` and `hotel_pos_recovery_check` databases have no user tables on the installed service's IPv4 endpoint. Earlier populated results came from `::1`; whether this is the same PostgreSQL cluster is unverified. |
| IPv6 `hotel_pos` ledger/schema | FAIL / BLOCKED | Read-only inspection at `::1` found 5 categories, 11 products, 23 orders, 52 order items, and 23 payments. `Category.sortOrder` and `Product.slug` exist, but Product stock columns and `ProductStockMovement` are absent. Its ledger marks `20261020100000_remove_product_stock` successful. This is not established as the installed service's PostgreSQL cluster. |
| IPv6 `hotel_pos_recovery_check` ledger/schema | BLOCKED | Read-only inspection at `::1` found 15 categories, 129 products, 32 variants, 69 orders, 173 order items, and 69 payments. Product stock columns and `ProductStockMovement` schema exist, but the movement table has 0 rows; the ledger instead marks `20261020101500_remove_product_stock` successful with a different checksum and includes a rolled-back migration attempt. This is not an authorized source for `bigbites`. |
| Database used by installed service | IDENTIFIED / BLOCKED | PID 9544 owns TCP 3000 and UDP 3001 and runs `C:\ProgramData\BIG BITES POS\server\dist\server.js`. Sanitized, elevated evidence identifies `bigbites` at `127.0.0.1:5432`; it has 5 categories, 3 users, 9 restaurant tables, and zero products/orders/items/payments. |
| Installed target schema and migration checksums | PARTIAL / BLOCKED | Missing `Category.sortOrder` and `Product.slug` explain catalog P2022. `Product.stock` exists, but stock metadata, variants, and movement table are absent. Twelve successful migrations end at `20261006220000_add_gst_toggle_and_order_reports`; later canonical variants, split-payment, movement, and stock-removal migrations are pending. Full schema/checksum review and migration strategy are unresolved. |
| Inventory columns and stock-movement table on installed target | FAIL / PARTIAL | `bigbites` has `Product.stock` but no Product rows, other stock metadata, or `ProductStockMovement`. Do not invent quantities/history; preserve the existing stock column. The IPv6 recovery database is not established as a source for this target. |
| Variant, payment, GST/report, and settings fields on installed target | PARTIAL / BLOCKED | The variants/split-payment migrations are absent from the target ledger; complete column/enum/constraint verification is still required on the isolated clone. |
| Restorable backup verified against an isolated destination | NOT VERIFIED | No target-specific backup/restore rehearsal has occurred. Required next step: make a protected custom-format backup of `bigbites`, restore to a new uniquely named database, and compare sanitized counts/schema/ledger before repair rehearsal. |
| Safe migration sequence | BLOCKED | The four later migrations are absent from the target ledger. Normal `migrate deploy` would encounter `20261020100000_remove_product_stock`, which drops required inventory columns and movement history. Do not run it; no production migration-history resolution is approved. |
| Production database state | UNKNOWN / BLOCKED | No production, Neon, Render, restaurant, or unidentified database was accessed. A read-only migration-history check declined to connect because the configured local server target did not identify the expected production database. |

## C. Inventory and stock

| Check | Status | Evidence / limitation |
| --- | --- | --- |
| Product stock, unit, threshold, and timestamp in canonical schema | PASS, source only | Present in canonical Prisma schema. |
| Admin stock changes and movement history | PASS, mocked/source | Canonical admin route and mocked route tests cover adjustments and movement records. No PostgreSQL behavior established. |
| Order stock deduction and insufficient-stock response | PASS, mocked/source | Mocked order tests cover successful deduction, rejection, and rollback behavior. |
| Stock movement before/after values | PASS, mocked/source | Tests verify before/after values from conditional stock updates and locked admin adjustments. |
| Cancellation restoration and authorization | PASS, mocked/source | Route tests cover history retention, paid-order rejection, and cancellation outcomes. Not a database transaction test. |
| Concurrent oversell prevention | BLOCKED | Orders use a conditional atomic decrement with a stock lower bound inside a transaction. Mock tests verify rollback paths; real concurrent PostgreSQL transactions have not been tested. |
| Variant stock/price behavior | PASS, mocked/source | Canonical route tests cover variant pricing and variant-linked items. Schema/runtime target compatibility remains unknown. |
| Admin deletion and cancellation stock restoration | PASS, mocked/source | Unpaid active-order deletion restores stock transactionally; deleting an already cancelled order does not restore it again. Completed/paid/refunded orders are not restored. |
| Existing stock values preserved on target | PARTIAL / BLOCKED | `Product.stock` exists, but the target has zero Product rows. No values are present to reconstruct; keep the column and preserve the entire target database. |

### Opening stock and combo policy

The inventory migration gives legacy products a numeric `stock` default of
zero but leaves `lastStockUpdatedAt` null. That null marker means “not
initialized”: existing menu items remain orderable without stock limits until
an administrator records an owner-confirmed physical count. Do not initialize
counts from migration defaults or historic sample data. The repository's
available backups do not establish current opening stock. The restaurant owner
must provide the on-hand count for each item to track, its stock unit, and any
desired low-stock threshold; an explicit count of zero marks an item out of
stock. Uninitialized items remain unlimited until counted.

Combo products are tracked as separate sellable stock-keeping units. Ordering
two combos deducts two combo units and cancellation restores those same units.
The displayed/snapshotted component list does not consume stock from the
component products. The owner must provide an on-hand count for each combo
product they want constrained.

## D. Orders and payments

| Check | Status | Evidence / limitation |
| --- | --- | --- |
| Table/parcel order flows and authorization | PASS, mocked/source | Mocked canonical route tests cover table and parcel creation. |
| Add-items stock deduction and variant pricing | PASS, mocked/source | Covered by mocked route tests; no PostgreSQL verification. |
| Cash, UPI, card, and split payment API support | PASS, source only | Canonical billing route and Prisma schema contain these paths/fields. |
| Persisted payment totals/history and reporting | UNKNOWN | Requires database-backed integration verification and target schema evidence. |
| Cancellation and stock-restoration transaction atomicity | UNKNOWN | Mock rollback is not proof of PostgreSQL rollback/isolation. |
| Historical orders/items/payments retained | PASS, aggregate only | Sanitized counts for installed `bigbites` are zero for Order, OrderItem, and Payment. Existing categories, users, and restaurant tables must still be preserved. Other IPv6 database counts do not describe this target. |

## E. Desktop application

| Check | Status | Evidence / limitation |
| --- | --- | --- |
| Frontend compilation | PASS | Desktop TypeScript/Vite build passed through the Tauri `beforeBuildCommand`. |
| Billing, administration, receipts, printing, and offline error handling | UNKNOWN | Compilation is not end-to-end UI/printing acceptance evidence. |
| API configuration | PASS, source | Tauri desktop uses `http://127.0.0.1:3000`; LAN runtime was not exercised. |
| Live local catalog API | FAIL | `/health` returned `OK`/`Connected`, but `/api/products/categories`, `/api/products`, and `/api/products/1` returned HTTP 500. Elevated logs report P2022 for missing `Category.sortOrder` and `Product.slug` in installed target `bigbites`. No live schema repair or service restart was performed. |
| Tauri server resource mapping | PASS, config/test/build scope | Tauri resource paths passed lifecycle static checks and the NSIS bundler completed. The installed payload was not extracted or run. |
| Installer startup, upgrade, PostgreSQL persistence, and recovery | BLOCKED / NOT RUN | Built installer cannot pass its unconditional stock-removal migration guard; no live installer run was attempted. |

## F. Waiter application

| Check | Status | Evidence / limitation |
| --- | --- | --- |
| Flutter static analysis | PASS | `flutter analyze`: no issues found. |
| Focused currency unit tests | PASS | `flutter test`: 2 passed. |
| Login, ordering, variants, cancellation, and sync against backend | UNKNOWN | No device/LAN end-to-end test was run. |
| Automatic discovery/configuration | PASS, source review only | Waiter source supports UDP discovery on port 3001 and HTTP health/API on port 3000; explicit `API_BASE_URL` can override. Network behavior was not exercised. |
| Approved runtime/API architecture | BLOCKED | Desktop defaults to loopback, waiter defaults to private-LAN discovery, and intended deployment configuration must be confirmed before release. |

## G. Release packaging

| Check | Status | Evidence / limitation |
| --- | --- | --- |
| Canonical/standalone runtime parity | FAIL | Standalone schema/routes omit inventory movement and variant functionality and its migration tree lacks four canonical migrations. |
| Destructive migration excluded from safe deploy sequence | FAIL / BLOCKED | `20261020100000_remove_product_stock` exists in both trees and drops stock columns and the movement table. Guards block normal guarded paths, but target migration status remains unknown. |
| NSIS candidate build | PASS, candidate only | Rebuilt after the credential change at `release-candidates/blocked-secure-postgres/tauri-target/release/bundle/nsis/Big Bites Restaurant_0.1.0_x64-setup.exe` (63,000,452 bytes; SHA-256 `F7B3754FDA235AAB6EB4C1EC5D544CEB75CBC648FAEA7FB489B78619C45E7C9D`); Authenticode status is `NotSigned`. Installer setup runs PowerShell hidden. Not run; migration guard blocks setup. |
| Waiter APK candidate build and signing | PASS, candidate only | Version code 2; APK signature verifies and matches the archived existing APK certificate. APK was not installed on a device or tested over restaurant Wi-Fi. |
| Artifact hashes/provenance | PARTIAL | Candidate APK and installer SHA-256 hashes were computed. No signed Windows installer or client handover manifest/package is approved. |
| Client-ready release | BLOCKED | The installed API currently returns HTTP 500 for catalog requests due missing database columns; the service's DB target is unidentified. The two known local databases differ, the recovery database has zero movement history and zeroed stock per owner report, and no verified restorable backup or approved migration plan exists. The installer guard blocks the unsafe migration set; installer is unsigned; exact PostgreSQL response-file compatibility, end-to-end LAN, and database acceptance remain unverified. |

## Migration and source/runtime findings

The canonical tree has 16 migration directories; the standalone tree has 12.
Standalone lacks:

- `20261006220000_add_gst_toggle_and_order_reports`
- `20261009230000_menu_variants_classification`
- `20261013010000_cash_upi_split_payment`
- `20261013213000_add_product_stock_movements`

Both trees contain `20261020100000_remove_product_stock`. Its SQL drops
`ProductStockMovement` and the Product columns `stock`, `stockUnit`,
`lowStockThreshold`, and `lastStockUpdatedAt`. Do not infer whether it was
applied on any target.

Canonical TypeScript routes are the behavior source for `apps/server`; the
standalone compiled routes are not feature-equivalent. Tauri currently maps
the canonical `apps/server` directory. This mapping does not prove that its
generated Prisma Client, migration set, startup environment, or database are
compatible.

## Required approvals and evidence

Before database-backed testing or any migration decision:

1. Owner identifies each intended database and explicitly authorizes the
   test target; no connection strings or credentials should be sent in chat.
2. Owner supplies a sanitized per-target migration ledger, including failed
   rows/checksums, and actual schema evidence for inventory, movements,
   variants, payment fields/enums, orders, and settings.
3. Owner confirms a consistent source snapshot is authorized and identifies
   its provenance. A verified restore must target a new isolated instance.
4. Owner confirms backup restorability and approves an explicit forward-only
   migration strategy after comparing the evidence to repository history.
5. Owner approves a distinct disposable PostgreSQL instance, loopback-only
   endpoint, non-default port, database names, and cleanup/disposal procedure.

The installed target is identified, but a verified backup/restore, isolated
repair rehearsal, and migration-history resolution remain **BLOCKED**.
Database-backed integration checks remain **BLOCKED / SKIPPED**. The IPv4
versus IPv6 endpoint discrepancy must not be resolved by copying or switching
databases.

## Current release decision

The NSIS and APK outputs are isolated **blocked candidates**, not client
deliverables. The installer has not been run and must continue to fail closed
on the current stock-removal migration. `bigbites` is the installed target,
but migration execution remains blocked until its backup is restored into an
isolated database, additive repair/API checks pass there, and the owner/DBA/
maintainer approve a history-preserving resolution. See
`docs/MIGRATION_RESOLUTION_PROPOSAL.md`; it intentionally selects no migration
sequence for live deployment.
