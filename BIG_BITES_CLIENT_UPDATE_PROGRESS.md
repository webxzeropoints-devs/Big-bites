# BIG BITES Client Update Progress

Updated: 2026-10-14

## Safety and current worktree

- Repository: `C:\Users\vjsan\hotel-pos`
- Existing worktree was already substantially dirty before this task. Those edits are being preserved and were not reverted.
- This continuation added this progress file and performed read-only inspection/build checks; it did not modify application source because the requested client behaviors were already present in the existing dirty source changes.
- Source-only backup: `C:\Users\vjsan\.copilot\session-state\6c5de3d3-cc6b-4d50-9040-403b58719e23\files\big-bites-source-backup-20261013-235559.zip`
- Backup verification: 156 archive entries, 381,694 bytes; SHA-256 `0544801BBE94E23859EA02FE1BC1BDAC410DCB6B1E6493841E5A5C141A1BCFF1`; excluded environment files, credentials, database dumps/backups, dependency/build directories, and binary release artifacts.
- Production database, Render settings, installer, installed local server, and release APK have not been changed in this task.

## Architecture observed

- Backend source is Express/TypeScript/Prisma with PostgreSQL. The Prisma datasource provider is `postgresql`; runtime uses `DATABASE_URL` through Render's environment when deployed.
- Existing production URL `https://big-bites-server.onrender.com` returned health `OK` and database `Connected` during read-only inspection. The category API returned 15 categories; the active products API returned 129 products and 32 variants. Product responses include category, price, and stock fields. Counts were computed without printing menu item data.
- This health response does not independently prove which Neon project/branch/database is configured. That requires a secret-safe Render dashboard check of the environment-variable target and Neon project/branch metadata. Do not paste connection strings into chat.
- Desktop source defaults to `http://127.0.0.1:3000`; its existing `apps/desktop/.env` is configured for loopback. The Windows installer packages and launches the local backend and PostgreSQL service.
- Waiter source performs automatic UDP broadcast discovery on port 3001 and then calls the discovered restaurant desktop server on HTTP port 3000. No manual IP entry is required.
- Render cannot transparently replace this same-LAN ordering route: a waiter discovering the local server must continue calling that server for local tables/orders and LAN operation. Sending waiter operations to Render instead would be an intentional workflow/network architecture change and needs an explicit routing decision.
- Backend production-menu sync uses the Render API from the local backend, only when targeting the installed local database, and is guarded by admin authentication and schema checks.
- User-selected target: desktop production traffic should use Render/Neon; waiter must retain LAN auto-discovery; both must operate on the same authoritative orders, payments, stock, and billing data. Current architecture does not yet satisfy this: desktop defaults to loopback and the waiter uses a local server whose configured database is local PostgreSQL. A safe bridge (local server forwarding waiter requests to Render, or both server instances using the same verified Neon database) and treatment of existing local business records must be settled before changing release URLs.
- A read-only inspection of the installed local database was attempted but Windows denied access to its protected `.env` for the non-administrator process. No contents were read. Therefore local-vs-Neon order/user/payment counts and schema compatibility remain unverified; use an administrator read-only query before any routing migration.
- The administrator-provided metadata command returned `CONFIG_UNAVAILABLE` before connecting. That status is ambiguous: the script maps missing config, access denied, and file read failure to the same code. No database query or write was reported. First verify the shell is elevated and whether the installed config is readable, without displaying its contents; then rerun the read-only query only if access succeeds.
- Follow-up administrator check confirmed the shell is elevated and the installed `.env` file is readable. This rules out access denial; the earlier `CONFIG_UNAVAILABLE` most likely came from config-line detection/reading, but its exact source is not established. A revised command must distinguish `CONFIG_READ_FAILED` from `DATABASE_URL_NOT_FOUND` without printing the line or credentials.

## Requested feature audit (existing dirty source)

- Parcel bills render a centered `PARCEL` label and suppress the table row for parcel orders; dine-in receipts render the actual table number. Waiter reads `isParcel` from the selected table and submits that table ID; backend order responses include the associated table. Printing is triggered by `window.print()` from the Tauri webview; receipt print CSS handles 80 mm width, dashed dividers, and bold item names.
- Desktop and waiter cancellation UI and backend cancellation route are already present in dirty source. Backend checks roles, waiter ownership, payment/order status, serializes cancellation transactionally, restores stock in the same transaction, retains the order with `CANCELLED` status, and frees a table only if no other active order remains.
- Cash + UPI is represented in the existing Prisma schema (`PaymentMethod.CASH_UPI`, `cashAmount`, and `upiAmount`), accepted by billing routes, validated in minor units, persisted transactionally, and included in monthly Excel reports.
- Desktop login performs bounded backend health retries (four checks, two-second gaps) and provides an explicit unavailable-server message. Waiter startup performs health validation after automatic LAN discovery and allows retry; it does not bypass authentication.
- These behaviors are present in pre-existing dirty changes; they have not been rewritten during this audit. Test results below validate source code, not live production transactions or physical printing.

## Checks completed

- `apps/server`: `npm run test:financial` passed TypeScript build and 46 tests; 2 database-dependent tests were skipped; 0 failures.
- `apps/desktop`: `npm run build` passed TypeScript and Vite production build.
- `apps/waiter_app`: `flutter analyze` reported no issues.
- `apps/waiter_app`: `flutter test` passed (2 tests).
- Read-only Render health, category, and product endpoint checks completed. Health reported `OK` / `Connected`; product counts and response shape are verified. These checks do not verify Render's configured Neon project identity.
- `git diff --check` passed; only line-ending warnings were reported for existing changed files.

## Schema and production safety

- Workspace Prisma schema contains parcel tables, product variants/classification, stock movement records, cash/UPI split fields, and order-item variant references.
- Workspace has migrations newer than the installed local server. The local database was previously reported to lack the variant/classification, stock-movement, and split-payment schema. Do not run local or production migrations or the current installer without a separately reviewed migration/backup plan.
- No production migration, catalog sync, seed, data write, installer run, or deployment has been performed.
- Never run `npm start`/Render deploy workflows from this workspace until the intended `DATABASE_URL` target and migration action are explicitly reviewed; the server `prestart` script runs `prisma migrate deploy`.

## Current Git state note

At the start of this task, existing changes included modified desktop, server, waiter, deployment documentation, and a modified tracked release APK, plus untracked tests, migrations, scripts, and documents. This task additionally adds `BIG_BITES_CLIENT_UPDATE_PROGRESS.md`; current feature behavior must be reviewed against the existing changes; do not reset, clean, or overwrite them.

## Pending work / blockers

1. Run an administrator-only, read-only check of the installed local database metadata and aggregate row counts. Confirm no writes, migrations, or service changes.
2. Secret-safely verify in Render dashboard that `DATABASE_URL` targets the intended Neon project, branch, and database; verify deployed migration state there. Do not share the URL or credentials.
3. Compare local business-record counts with the canonical Neon database and decide how existing local records remain available. Do not point local server to Neon or proxy traffic until this is reviewed.
4. Implement the minimum approved route so desktop calls Render and waiter LAN requests reach the same authoritative API/data; add tests for forwarding, health, and authentication. Preserve LAN discovery.
5. Test authenticated production reads only if an authorized session is available. Do not perform production writes as a test.
6. Review migration compatibility; do not apply pending migrations without approval and a verified backup.
7. Run an APK release build to a separate output location so the already-modified tracked APK is not overwritten. Build the Windows installer only after routing is verified; do not run its installer.
8. Physical printer, device LAN discovery, real login, production orders/payments/cancellation, and restart timing remain unverified.

## Investigation update — cloud-only production request (2026-10-14)

- No source or production configuration was changed in this investigation. No build, migration, deployment, or database write was run.
- Current Render checks recovered: four consecutive `/health` requests returned HTTP 200 with `OK` / `Connected` (response times approximately 0.3–2.3 seconds). `/api/products/categories` returned 15 entries; `/api/products` returned 129 products and 32 variants. This establishes current public API availability and a DB query, not the active database vendor/Neon project identity.
- The earlier 503/timeout is not diagnosable from this workspace. The later successful retries show transient unavailability, but Render service events/logs are not available here. No repository Render manifest or GitHub Actions workflow/run was found.
- A prior read-only audit in `docs/PRODUCTION_DATA_MIGRATION_AUDIT.md` reports that the source database was Neon and records production schema/migration status from 2026-10-13: 14 migration ledger rows including a rolled-back menu migration attempt and its successful retry; `20261013010000_cash_upi_split_payment` was not applied; `ProductStockMovement` was absent and `20261013213000_add_product_stock_movements` was not applied. The audit says production schema matched the model in other checked areas, but split-payment enum/columns and stock-movement table were outstanding. This is historical evidence, not a fresh direct database query. Do not treat the deployed schema as fully compatible until reverified.
- Workspace `apps/server/package.json` defines `prestart: prisma migrate deploy` and `start: node dist/server.js`. Thus a Render start command invoking `npm start` will attempt migrations before serving. Render's actual configured build/start commands and current migration ledger cannot be inspected from source; do not redeploy until Render settings and outstanding migrations are reviewed/approved.
- Existing desktop release source currently falls back to `http://127.0.0.1:3000`; the development `.env` is loopback. The previously built desktop bundle also contains loopback. Tauri config bundles the server, Prisma runtime/migrations, installer scripts, and a startup helper; the NSIS hook invokes the backend installer. This production installer requires local server/PostgreSQL setup.
- Current waiter source defaults `API_BASE_URL` to empty and discovers a local backend over UDP port 3001, then uses HTTP port 3000. The Android manifest permits internet and cleartext traffic. No release-specific `--dart-define API_BASE_URL` configuration was found, and the existing modified APK was not unpacked or rebuilt. Therefore neither current release configuration is verified cloud-only.
- GitHub Actions inspection found no workflows or workflow runs. There is no available Render deployment evidence from the repo/CI tools beyond the live public API responses and prior audit document.
- Blockers before production-facing configuration edits or deployment: (1) verify the current Render `DATABASE_URL` target is the intended Neon project/branch using dashboard metadata without sharing secrets; (2) requery Neon migration ledger/schema read-only and compare with the outstanding additive migrations; (3) inspect Render's actual build/start command and deployment events; (4) confirm release configuration strategy for both clients and remove local services from installer only after desktop/waiter compatibility is reviewed.
- Smallest expected future file set, subject to blocker clearance: `apps/desktop/src/App.tsx` for a production-only Render API default with a development-only override; `apps/waiter_app/lib/services/api_service.dart` plus release build configuration for the same Render host and no production LAN fallback; `apps/desktop/src-tauri/tauri.conf.json` and `apps/desktop/src-tauri/windows/installer.nsh` to stop packaging/launching local backend setup; likely `apps/desktop/src-tauri/windows/Install-BigBites.ps1` only if the supported install flow still invokes it. Do not remove backend source needed by Render.
