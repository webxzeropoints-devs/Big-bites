# BIG BITES POS Local Client Conversion Plan

**Prepared:** 2026-10-23
**Stage:** A — read-only repository and documentation inspection
**Status:** Planning only. No database, external service, build, export,
import, migration, or deployment was performed.

## 1. Current architecture

- Backend source is the Express/TypeScript service in
  [`apps/server/src`](../apps/server/src), using Prisma and PostgreSQL.
- Canonical Prisma schema and migrations are under
  [`apps/server/prisma`](../apps/server/prisma).
- Desktop is React/TypeScript/Vite with Tauri in
  [`apps/desktop`](../apps/desktop). Its source defaults to
  `http://127.0.0.1:3000` unless `VITE_API_URL` is overridden.
- Waiter is the Flutter application in
  [`apps/waiter_app`](../apps/waiter_app). Without a build-time
  `API_BASE_URL`, it discovers a private IPv4 server over UDP 3001 and checks
  its API/health endpoint over HTTP 3000.
- The current Windows installer resources are configured in
  [`apps/desktop/src-tauri/tauri.conf.json`](../apps/desktop/src-tauri/tauri.conf.json)
  to package `apps/server` build, dependencies, Prisma schema/migrations, and
  Windows setup scripts. It is configured for local PostgreSQL setup.
- The separate `BIG-BITES-SERVER-CLIENT` directory has a different schema,
  migration set, package scripts, generated/runtime assumptions, and compiled
  routes. It is not the configured Tauri resource source.
- The repository documents a separate local POS architecture: local orders
  and billing use the local backend/database; optional production catalog
  sync is disabled in standard local mode. These are source/configuration
  findings, not proof that a client installer works.

## 2. Canonical versus standalone differences

Verified repository differences:

| Area | Canonical | Standalone | Consequence |
| --- | --- | --- | --- |
| Prisma schema | [`apps/server/prisma/schema.prisma`](../apps/server/prisma/schema.prisma) includes product stock quantity/unit/threshold/timestamp, `ProductStockMovement`, variants, `OrderItem.variantId`, category ordering/classification, GST/report fields, and cash/UPI split-payment fields. | [`BIG-BITES-SERVER-CLIENT/prisma/schema.prisma`](../BIG-BITES-SERVER-CLIENT/prisma/schema.prisma) omits inventory fields and movement model, variants, `variantId`, category sort/classification, split-payment fields, and GST/report settings. | Schema/client compatibility is not interchangeable. |
| Migrations | 16 migration directories under `apps/server/prisma/migrations`. | 12 directories under `BIG-BITES-SERVER-CLIENT/prisma/migrations`. | Standalone is missing four migrations listed below. |
| Missing standalone migrations | — | `20261006220000_add_gst_toggle_and_order_reports`; `20261009230000_menu_variants_classification`; `20261013010000_cash_upi_split_payment`; `20261013213000_add_product_stock_movements`. | Histories are not feature-equivalent. Do not copy migrations blindly. |
| Destructive migration | Both trees contain `20261020100000_remove_product_stock`. | Same SQL in both trees. | It drops stock columns and `ProductStockMovement`; status on all targets is **UNKNOWN**. |
| Routes/runtime | TypeScript routes in `apps/server/src` implement stock movements, variant-aware orders, current lock behavior, and split tender support. | Compiled `dist` routes retain stock deduction/restoration but omit movement history and variant-aware order items; billing lacks split-payment handling. | The standalone runtime is not a valid substitute for canonical source. Do not hand-edit compiled JavaScript. |
| Build/start | Canonical package has a build/code-generation step and a guarded `prestart`. | Standalone build is separate; its own startup script has a guard. | Prisma Client and runtime must be produced from one reviewed canonical revision. |

The relevant migration definitions include
[`20261013213000_add_product_stock_movements`](../apps/server/prisma/migrations/20261013213000_add_product_stock_movements/migration.sql),
which creates `ProductStockMovement`, and
[`20261020100000_remove_product_stock`](../apps/server/prisma/migrations/20261020100000_remove_product_stock/migration.sql),
which drops that table and Product columns `stock`, `stockUnit`,
`lowStockThreshold`, and `lastStockUpdatedAt`. The two trees' shared migration
SQL matched by digest in the prior source-only inspection. No live migration
ledger has been examined.

## 3. Unknown migration status

`20261020100000_remove_product_stock` is present in both repository trees and
its SQL conflicts with the canonical inventory schema. Its applied, failed,
pending, or rolled-back state is **UNKNOWN** for Render/Neon and every local
database.

Normal application startup/installer paths include guards that reject the
destructive migration and incomplete/unreviewed resources before their
migration command. A direct Prisma CLI invocation can bypass those guards;
they do not prove actual database compatibility. Do not run the installer,
`migrate deploy`, `db push`, migration resolution, or any SQL change until
per-target evidence and a separately approved resolution exist.

## 4. Inventory and historical-data preservation risks

- If the destructive migration is pending and applied, existing stock values,
  stock metadata, and stock-movement history are dropped.
- If it has already been applied, restoring empty columns/tables does not
  restore historical stock or movement records.
- A migration ledger alone does not prove actual schema; schema alone does
  not prove migration history. Compare both for each target independently.
- Export/import compatibility also depends on variants, order-item links,
  payments including CASH + UPI splits, GST/report settings, orders, and
  foreign keys.
- A successful export or backup command is not evidence that it restores.
  Require a verified restore into a separate isolated database before
  considering data-transfer validation.
- Never merge records from Render and Neon automatically. This plan proposes
  Render as the source only because the user selected it; an authorized DBA
  must confirm which database the Render service actually uses and whether
  it is the correct source of truth. Neon is not to be changed.

## 5. Required local runtime and installer work

The repository already has an installer-managed local backend/PostgreSQL
approach, including scripts:

- [`Install-BigBites.ps1`](../apps/desktop/src-tauri/windows/Install-BigBites.ps1)
- [`Start-BigBitesServer.ps1`](../apps/desktop/src-tauri/windows/Start-BigBitesServer.ps1)
- [`Initialize-BigBites.ps1`](../apps/desktop/src-tauri/windows/Initialize-BigBites.ps1)

The initializer is explicitly for an empty local database and creates
accounts/initial menu. It is not a production-data importer. The installer
currently validates packaged migration/schema resources and refuses the
current destructive migration before its migration/deployment stage; thus
the current migration conflict blocks a safe client installation using the
present tree.

Before any later implementation or packaging, review and test:

1. Supported PostgreSQL distribution/version, service lifecycle, local
   binding, least-privilege local role, secure credential generation/storage,
   and port-conflict handling.
2. Upgrade/reinstall behavior that preserves an existing client database and
   stops rather than overwrites an installation with uncertain state.
3. Startup order and health/error reporting without requiring a terminal;
   ensure the installed backend always uses the local database and never
   silently falls back to Render/Neon.
4. Automated local backup and documented restore procedure, including a
   verified restore rehearsal.
5. Migration/application startup behavior once an approved migration
   strategy exists. Preserve current guards; direct Prisma commands must not
   become an undocumented installer path.

The current installer and local initialization scripts have not been run in
this Stage A review.

## 6. Desktop and waiter API configuration

- Desktop source in [`apps/desktop/src/App.tsx`](../apps/desktop/src/App.tsx)
  defaults to `127.0.0.1:3000`; `VITE_API_URL` can override it. A client
  build must explicitly avoid a production URL override and must surface
  local backend health failures instead of silently switching to Render.
- Waiter source in
  [`apps/waiter_app/lib/services/api_service.dart`](../apps/waiter_app/lib/services/api_service.dart)
  supports UDP discovery on 3001 and health/API on 3000; explicit
  `API_BASE_URL` bypasses discovery. Standard client release should retain
  LAN discovery and avoid a production URL override.
- Validate Windows Firewall rules, private LAN behavior, retries/timeouts,
  app startup/reboot, phone-to-PC discovery, internet-disconnected operation,
  and clear errors in a later authorized acceptance stage.
- The desktop defaults to loopback while waiter traffic uses LAN discovery;
  confirm the server's LAN listener/firewall behavior for the approved
  client layout without changing the architecture by assumption.

No API configuration was changed in this inspection.

## 7. Secure local database setup requirements

- Use a new, empty, isolated local PostgreSQL target for any rehearsal; do not
  assume an existing local `bigbites` or `bigbites_neon_stage` is disposable.
- Confirm local target identity before any database command. Never use
  production/Neon credentials or URLs in client configuration.
- Generate a unique local secret and least-privilege database account
  securely; do not hardcode credentials in source, APK, installer logs, or
  reports.
- Bind PostgreSQL to the required local interface only; expose only the
  server's intended LAN API/discovery ports to the private subnet.
- Do not create the database, run the initializer, or run migrations during
  Stage A.

## 8. Data transfer and validation requirements

Before data movement, an authorized owner/DBA must:

1. Confirm the Render backend's actual database identity out of band, and
   confirm the source is authoritative. Do not inspect private environment
   configuration or expose credentials in this workflow.
2. Provide separate sanitized ledger/schema evidence for each relevant
   target, including stock columns/table, variants, payment enum/tender
   fields, and settings, plus the exact stock-removal migration status.
3. Demonstrate a backup restore into a separate isolated target.
4. Approve the exact source data scope, export format, handling of
   authentication data, destination identity, transfer operator, and
   retention/disposal policy.
5. Approve a history-preserving schema/migration plan for the new local
   target. Do not assume a pristine database can safely run the current full
   migration tree: the destructive migration exists in that tree.

After a separate approval, validate sanitized counts and relationships for
users/roles, categories/products, stock fields and movement history,
variants/order-item links, orders/items, payments/tenders, settings, and
financial totals. Do not include customer/person records or actual payment
details in logs. Verify rollback/recovery against the isolated target.
Never treat a zero exit code as sufficient proof of a correct import.

Use
[`DATABASE_EVIDENCE_COLLECTION.md`](DATABASE_EVIDENCE_COLLECTION.md),
[`MIGRATION_RESOLUTION_PROPOSAL.md`](MIGRATION_RESOLUTION_PROPOSAL.md), and
[`SAFE_POSTGRESQL_TEST_PLAN.md`](SAFE_POSTGRESQL_TEST_PLAN.md) as supporting
gates; none authorizes operations.

## 9. Testing stages and approval gates

| Stage | Scope | Gate / stop condition |
| --- | --- | --- |
| A — Read-only inspection | Repository, configuration, docs, migration SQL, tests, worktree. | This document; no database/service access. |
| B — Local deployment design | Installer-managed backend/PostgreSQL, local-only URLs, LAN discovery, backup/restore design. | Owner review before implementation; do not provision DB. |
| C — Source evidence | Per-target ledger/schema evidence and verified restore evidence, collected by an authorized DBA. | Explicit authorization to collect read-only evidence; keep each environment separate. |
| D — Isolated target | Provision a new disposable PostgreSQL instance/database and verify identity/empty state. | Separate explicit owner authorization for exact target and disposal plan. |
| E — Migration/import rehearsal | Apply only an approved, reviewed strategy; test data preservation and transaction behavior. | Separate approval for exact migration/import, target, snapshot, operator, and recovery plan. Stop on any mismatch or destructive SQL. |
| F — Packaging/acceptance | Build installer/APK and test clean Windows/Android, startup/reboot, local billing, waiter LAN, offline internet, printing, persistence, backup/restore. | Only after schema/runtime parity and isolated database tests pass; explicit release approval. |

No stage authorizes changes to Render or Neon. Do not progress from one stage
to the next based on this plan alone.

## 10. Files likely to need review or modification later

This is a candidate list, not permission to edit them. Exact scope depends on
Stage B decisions and DBA evidence.

- Local backend/build/runtime: `apps/server/src/config/database.ts`,
  `apps/server/src/server.ts`, `apps/server/package.json`,
  `apps/server/scripts/build.cjs`, `apps/server/scripts/run-start-migrations.cjs`,
  `apps/server/scripts/assert-safe-migrations.cjs`.
- Canonical persistence and behavior, only after migration strategy:
  `apps/server/prisma/schema.prisma`,
  `apps/server/prisma/migrations/` (new forward-only migration only after
  review/approval), and relevant route/import code and tests under
  `apps/server/src/routes/`, `apps/server/scripts/`, and `apps/server/tests/`.
- Installer/runtime: `apps/desktop/src-tauri/tauri.conf.json`,
  `apps/desktop/src-tauri/windows/Install-BigBites.ps1`,
  `apps/desktop/src-tauri/windows/Start-BigBitesServer.ps1`,
  `apps/desktop/src-tauri/windows/Initialize-BigBites.ps1`,
  and `apps/desktop/src-tauri/windows/installer.nsh`.
- Desktop API/startup UX: `apps/desktop/src/App.tsx`,
  `apps/desktop/src-tauri/src/lib.rs`, and desktop UI tests/configuration.
- Waiter connectivity/UX: `apps/waiter_app/lib/services/api_service.dart`,
  `apps/waiter_app/lib/main.dart`, Android network permissions/configuration,
  and waiter tests/build configuration.
- Documentation to reconcile after approved implementation:
  `docs/WINDOWS_CLIENT_DEPLOYMENT.md`,
  `docs/PRODUCTION_DATA_MIGRATION_AUDIT.md`,
  `docs/SAFE_POSTGRESQL_TEST_PLAN.md`,
  `docs/RELEASE_READINESS_CHECKLIST.md`, and
  `docs/DATABASE_EVIDENCE_COLLECTION.md`.
- Standalone `BIG-BITES-SERVER-CLIENT` should not be patched by copying
  compiled files or migrations. Decide its supported status and source-of-
  truth relationship separately before any changes.

Do not overwrite existing APK/EXE files or other untracked/modified work.

## 11. Render and Neon protection

Render and Neon remain untouched by this plan and by the Stage A inspection.
No external connection, configuration read/change, export, import, migration,
or deployment was performed. Future local conversion must leave both
unchanged. The proposed Render source still requires the authorized DBA to
identify the actual backing database and approve a read-only export
separately.

## 12. Questions/evidence required before implementation

1. Which data owner/DBA can confirm the actual Render backing database and
   authorize a read-only evidence collection?
2. Is that exact database authoritative for the client data, or does another
   environment contain unique/newer records? Do not merge Render and Neon
   without a reconciliation plan.
3. For each intended target, what are the sanitized migration ledger,
   checksums/status, actual schema, and stock-removal migration state?
4. Has a backup from the selected source been successfully restored to a
   separate isolated database, with validation evidence?
5. What exact data scope can be copied (including users/authentication,
   historical orders/payments, variants, inventory, and settings), and who
   authorizes that transfer?
6. Who approves creation/disposal of a new isolated local PostgreSQL
   database and the exact migration/import rehearsal?
7. Who will verify on-site hardware, Windows version/permissions, private LAN,
   firewall, Android devices, printer, and client acceptance?
8. Which client rollout/backup retention/recovery policy is required?

Until these are answered and the migration conflict has a reviewed
target-specific resolution, local database provisioning, import, migration,
installer/APK packaging, and client-ready claims remain **BLOCKED**.

## Stage A result

- Worktree contained existing modified and untracked files; none were
  discarded or overwritten.
- This plan is documentation-only and does not constitute an implementation
  or migration plan approval.
- Migration status remains **UNKNOWN**.
- No database, Render, Neon, or other external service was accessed or
  changed. No build, export, import, migration, installer, or APK was run.
- The safest next action is for the authorized owner/DBA to complete the
  sanitized evidence procedure for the selected source and separately verify
  backup restoration before any later stage.
