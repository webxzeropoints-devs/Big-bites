# BIG BITES production-to-local data migration audit

**Audit and test date:** 2026-10-13
**Scope:** Read-only Neon audit followed by an isolated, disposable PostgreSQL
snapshot/import test. No production database write/migration or restaurant
installation change was performed.

## Current source and test reconciliation — 2026-10-22

This section supersedes any older statement below that conflicts with the
current importer, Prisma schema, migration files, or reproducible test results.

- The importer includes product stock fields. New products receive source
  stock; updates to matched local products omit stock fields and preserve
  local inventory. `ProductStockMovement` rows are imported only when present
  in the source. The table is optional because the audited source did not
  contain it; no movement history is invented. Conflicting movement IDs fail
  the enclosing transaction instead of overwriting local history. The target
  must have inventory columns and the movement table.
- `ProductStockMovement` has no `orderItemId` column in the Prisma model or in
  `20261013213000_add_product_stock_movements`. The importer tests now match
  that schema.
- The Prisma model again describes product stock and movement history.
  However, this workspace contains untracked copies of
  `20261020100000_remove_product_stock` under both
  `apps/server/prisma/migrations` and
  `BIG-BITES-SERVER-CLIENT/prisma/migrations`. They are byte-identical and
  drop the inventory columns and movement table. Their applied/pending status
  is not established here. Applying either migration contradicts the
  inventory-preserving model and importer. Do not run `prisma migrate deploy`
  until migration history is reconciled against each target's actual ledger
  and a reviewed, data-preserving plan is approved. Do not rewrite historical
  migrations based on this source-only inspection.
- The canonical `apps/server/src` routes and canonical Prisma schema include
  inventory and stock-movement behavior. The standalone Prisma schema omits
  inventory fields and the movement model, although its compiled routes retain
  stock deduction/restoration. Those compiled routes do not record movement
  history or implement variant-aware order items. Do not regenerate or deploy
  that bundle from the current source until its runtime behavior, generated
  Prisma Client, schema, and migrations are reconciled.
- The repeat-import and conflict-rollback integration cases were not run
  because isolated database endpoints were not configured. Earlier isolated
  API/import results below are historical and do not establish current
  inventory preservation or live-import safety. Integration endpoints must be
  disposable loopback databases on a non-default port; the importer rejects
  Neon as a source.
- Validation for this repair: `node --test
  tests/production-data-migration.test.cjs` reported **4 passed, 0 failed,
  2 skipped**; the two database-backed cases were skipped because isolated
  endpoints are unset. `npm test` (`tsc --noEmit`) passed, and
  `npx prisma validate --schema prisma/schema.prisma` passed. These checks
  did not access a database. Integration behavior remains unverified until
  isolated endpoints are configured and the database-backed cases actually
  run.

This report is not approval to import into the installed restaurant database,
Neon, or any other live database.

## Source-only safety review — 2026-10-23

No database was queried during this review. The migration status remains
**unknown for every intended deployment target**; the presence of migration
files, backups, or prior audit notes does not establish whether the destructive
migration was applied or whether a backup is current and restorable.

The canonical server and standalone bundle still have different schemas and
migration histories. The standalone bundle is missing the four canonical
migrations listed above and its Prisma schema omits inventory, stock movements,
variants, split tenders, and other canonical fields. No historical migration
was rewritten or removed.

### Canonical versus standalone files

| Canonical file | Standalone counterpart | Difference |
| --- | --- | --- |
| `apps/server/prisma/schema.prisma` | `BIG-BITES-SERVER-CLIENT/prisma/schema.prisma` | Canonical schema has product stock fields, `ProductStockMovement`, product variants, category ordering, classification, GST-enabled/report settings, order-item variants, and cash/UPI payment amounts. Standalone schema omits these resources. |
| `apps/server/prisma/migrations/` | `BIG-BITES-SERVER-CLIENT/prisma/migrations/` | 16 versus 12 migration directories. Standalone lacks `20261006220000_add_gst_toggle_and_order_reports`, `20261009230000_menu_variants_classification`, `20261013010000_cash_upi_split_payment`, and `20261013213000_add_product_stock_movements`. SHA-256 comparison found matching SQL for each migration name shared by both trees. Both contain the identical destructive stock-removal migration. |
| `apps/server/src/routes/admin.ts`, `apps/server/src/routes/orders.ts` | `BIG-BITES-SERVER-CLIENT/dist/routes/admin.js`, `BIG-BITES-SERVER-CLIENT/dist/routes/orders.js` | Canonical TypeScript implements stock movement history, variant-aware order lines, and the current stock transaction/locking behavior. The compiled standalone routes include stock deduction/restoration but no matching `ProductStockMovement` or `variantId` references. These runtime implementations are not feature-equivalent. |
| `apps/server/package.json`, `apps/server/scripts/build.cjs` | `BIG-BITES-SERVER-CLIENT/package.json`, `BIG-BITES-SERVER-CLIENT/scripts/run-start-migrations.cjs` | Both define `prestart` migration hooks. Canonical build generates Prisma Client from the canonical schema and then runs TypeScript. Standalone build is `tsc`; its postinstall does not regenerate Prisma Client from an inventory-capable schema. |
| `apps/desktop/src-tauri/tauri.conf.json` | `BIG-BITES-SERVER-CLIENT/` | Tauri packages `apps/server` resources, not the standalone directory; its pre-build command builds the canonical server. The installer runs a direct Prisma deploy command only after its resource preflight. The separate standalone launcher starts compiled JS directly and does not itself invoke migrations. |
| `apps/server/src/config/database.ts`, `apps/server/src/server.ts`, `apps/desktop/src/App.tsx`, `apps/waiter_app/lib/services/api_service.dart` | Standalone startup/runtime | Current desktop default API is loopback port 3000; the waiter can discover a private-LAN server via UDP port 3001 and checks its health on port 3000. The server defaults to binding `0.0.0.0`; local/non-production DB configuration is restricted to loopback. These source settings do not establish that a deployed package or target database is compatible. |

Startup guards now fail closed if the destructive migration is present, any
of the 15 non-destructive canonical migration files are missing, any
migration directory lacks `migration.sql`, or any migration SQL drops product
stock fields or `ProductStockMovement` (even under a renamed directory). The
packaged schema checks require stock quantity, unit, threshold, last-update,
and movement model resources. Unknown migration directories are rejected
unless included in the reviewed canonical migration set. The installer
performs equivalent checks before stopping the server or reaching its direct
Prisma deployment command. These guards do not protect a direct Prisma CLI
invocation that bypasses the application entry points.

The standalone bundle is **not reconciled**. Proposed review sequence:

1. Preserve both migration histories and the destructive migration unchanged.
2. For each explicitly authorized target, have its data owner provide a
   sanitized migration-ledger and actual-schema report, including inventory
   columns and movement-table status, plus evidence of a verified restorable
   backup.
3. Review that target-specific evidence before deciding whether it needs a
   corrective migration. Do not infer or mark migration state.
4. After a separately approved strategy exists, prepare a reviewable forward
   change that makes the standalone runtime consume the canonical schema and
   migration set. Review migration checksums, sequencing, and target
   compatibility before any application.

Until those prerequisites are satisfied, no migration or database-backed
import test is authorized by this report, and source-level checks are not
evidence of data preservation or release readiness.

Source-only verification on 2026-10-23:

- `npm run test:financial` completed the backend build and reported 66 tests:
  64 passed, 0 failed, and 2 database-backed import cases skipped. The
  executed route tests use mocks; migration guard cases use disposable file
  fixtures and static entry-point checks. No database connection was made.
- `npx prisma validate --schema prisma/schema.prisma` passed using a
  loopback-only URL on port 1; schema validation does not establish database
  compatibility.
- The desktop frontend production build passed. Full Flutter analysis passed,
  and the focused currency unit file passed 2 tests.
- The installer PowerShell parser, migration-script Node syntax checks, and
  `git diff --check` passed. No installer, APK, or production release artifact
  was built.
- Product-row locking for admin stock-setting operations is covered by mocked
  route tests. PostgreSQL transaction/locking behavior remains unverified.
- The renamed-migration guard regression was subsequently strengthened to test
  a table-only `DROP TABLE "ProductStockMovement"` statement (the closing
  quote previously caused a scanner false negative), a stock-column drop, and
  a safe but unreviewed directory. The focused
  `node --test tests/production-data-migration.test.cjs` run reported 11 tests:
  9 passed, 0 failed, and the same 2 database-backed cases skipped.
- Order stock deduction now locks the product row before reading stock and
  records movement `previousStock`/`newStock` from that locked value, avoiding
  a stale post-update read when concurrent sales update the same product.
  Regression coverage asserts lock/read/update ordering and movement values.
  The final `npm run test:financial` run reported 66 tests: 64 passed, 0 failed,
  and the same 2 database-backed importer cases skipped.

## Current schema update

The current Prisma model retains product stock fields and the
`ProductStockMovement` model. The stock-removal migration makes the database
sequence unsafe to apply as-is; this source change does not recover stock
values or movement rows from a database where that migration was already
applied.

## Findings

### Production database inventory

The configured server database target was identified as Neon without printing
or recording its connection string. Schema metadata and aggregate counts were
queried inside PostgreSQL `BEGIN READ ONLY`; the transaction reported
`transaction_read_only=on` and was rolled back. A later consistent
custom-format `pg_dump` snapshot was made with read-only dump access, stored
under the session-private directory, restored into a loopback-only disposable
clone, and never restored over Neon or the installed restaurant database.

The initial read-only count query preceded the snapshot. The snapshot captured
new activity in the meantime: orders changed from 82 to 83, order items from
131 to 134, and payments from 82 to 83. Snapshot counts below are the ones
used for the import test; do not treat the earlier counts as a fixed production
baseline.

| Production table | Rows |
| --- | ---: |
| `Category` | 15 |
| `Product` | 129 |
| `ProductVariant` | 32 |
| `RestaurantTable` | 9 |
| `User` | 5 |
| `RestaurantSettings` | 1 |
| `Order` | 83 |
| `OrderItem` | 134 |
| `Payment` | 83 |
| `_prisma_migrations` | 14 ledger rows |

All 129 products and all 32 variants are active. The consistent snapshot has
82 `COMPLETED` and 1 `CONFIRMED` order; 82 payments are `PAID` (35 cash, 47
UPI) and 1 is `PENDING`. The paid completed-order amount is ₹34,310.00; all
payment rows, including the pending payment, total ₹34,730.00. No payment
references or user/password values were printed. The nine business tables
total 491 rows. `_prisma_migrations` is destination-specific Prisma
bookkeeping, not restaurant data to copy.

The production public schema contains the nine business tables above and
`_prisma_migrations`. No other public base tables were found. In particular,
there is no production audit/report table or `ProductStockMovement` table.
Reports are derived from orders and payments.

### Schema compatibility

The current Prisma model was compared with the read-only Neon metadata. The
installed legacy schema comparison below uses the direct audit from the prior
investigation; direct access to its protected config was denied during this
session, so that column inventory was not re-read.

| Table/model | Neon vs. current Prisma | Previously audited installed legacy schema vs. current Prisma |
| --- | --- | --- |
| `User` | No column/enum difference found | No column difference reported |
| `RestaurantTable` | No column/enum difference found | No column difference reported |
| `Category` | Matches, including `sortOrder` | Missing `sortOrder` |
| `Product` | Matches current model fields | Missing `slug`, `description`, `stockUnit`, `lowStockThreshold`, `isVegetarian`, `classification`, `subcategory`, `isSignature`, and `lastStockUpdatedAt` |
| `ProductVariant` | Matches | Entire table/model is absent |
| `ProductStockMovement` | Entire table is absent | Entire table/model is absent |
| `Order` | Matches, including GST, discounts, and `READY_FOR_BILLING` | Missing `gstEnabled` |
| `OrderItem` | Matches, including nullable `variantId` and its FK/index | Missing `variantId` |
| `Payment` | Missing `cashAmount` and `upiAmount`; `PaymentMethod` lacks `CASH_UPI` | Missing `amountReceived`, `change`, `cashAmount`, and `upiAmount`; `PaymentMethod` lacks `CASH_UPI` |
| `RestaurantSettings` | Matches current model fields | Missing `gstEnabled` and `orderReportsPath` |
| `_prisma_migrations` | Present; has an earlier rolled-back variant-migration attempt followed by its successful application | Present; migration state requires a fresh read-only check before any test upgrade |

For the installed legacy schema, the menu migration also needs to add the
`ProductClassification` enum, `ProductVariant` table and constraints, and the
`OrderItem.variantId` index/FK. These are not represented as fields missing
from the legacy tables because some are whole schema objects.

The production `PaymentMethod` enum contains `CASH`, `UPI`, and `CARD`; the
current source additionally declares `CASH_UPI`. The repository's
`20261013010000_cash_upi_split_payment` migration is not recorded as applied in
Neon. Production has the expected variant table, product classification/catalog
fields, GST/discount fields, and `READY_FOR_BILLING` order status.

Prisma declares `ProductStockMovement` and a product relation, but the table is
absent from Neon and the previously checked-in migrations did not create it.
No application route currently uses this model. This is repository schema
drift; do not invent or backfill stock movement history. A new additive
destination migration, `20261013213000_add_product_stock_movements`, now
creates the empty table and FK so the current Prisma schema matches the
upgraded destination. The source snapshot had no stock movement records; the
test import moved zero such rows. Schema/client generation alone does not
prove the live database is fully aligned.

The production migration ledger contains a rolled-back attempt and a later
successful application of `20261009230000_menu_variants_classification`.
Treat only successfully applied, non-rolled-back entries as applied migrations.

The installed desktop server is separate from Neon and uses local PostgreSQL.
Its legacy schema was previously audited as having five categories and zero
products, orders, order items, or payments. Its old `Product` lacks `slug`,
`description`, `stockUnit`, classification/catalog fields, and variants;
`Category` lacks `sortOrder`; and `OrderItem` lacks `variantId`. The current
local API was checked with GET requests during this audit: health is OK,
`/api/products` returns 0 products, and `/api/products/categories` returns 5
categories. Direct access to the installed server's protected `.env` was
denied by Windows ACLs, so this audit did not open it or attempt a direct
database connection. Counts for installed users, tables, and settings must be
read safely in the isolated test setup before any import test.

### Data-model and conflict implications

- Order IDs are displayed as order/bill numbers (`Order #<id>`), and reports
  use the same ID. They are historical identifiers, not disposable sequence
  values. Do not remap or renumber production orders to resolve a collision.
- `OrderItem` references orders and products and can reference a variant;
  `Payment.orderId` is unique. Preserve amounts, statuses, timestamps,
  historical unit prices/subtotals, and every foreign-key relationship.
- Products own stock; variants have their own prices but share their parent's
  stock. Keep variants as related rows and preserve `OrderItem.variantId`.
- Unique constraints include user username, table number, category name,
  product slug, `(ProductVariant.productId, name)`, and payment order ID.
  Production IDs may collide with existing local IDs even when the local row
  count is small. Do not blindly insert or upsert by ID.
- The current local database must remain authoritative for local-only records
  and live operational state. In particular, never replace local stock,
  settings, open-table status, users, orders, or payments merely to make source
  and destination counts equal.

## Implemented migration plan and tested importer

1. **Snapshot and target restriction.** A consistent custom-format snapshot was
   restored to a dedicated PostgreSQL 18 cluster bound only to `127.0.0.1` on
   port 55432. Snapshot and backup files are in the ACL-restricted session
   directory, not the repository. The importer only accepts a Neon source (or
   the exact test clone under `NODE_ENV=test`) and writes only to a loopback,
   non-5432 database named `bigbites_test_*` under `NODE_ENV=test`.
2. **Schema upgrade.** On a production clone and on fresh disposable targets,
   `prisma migrate deploy` applied the outstanding cash/UPI tender migration
   and new empty stock-movement migration. `prisma migrate diff` detected no
   difference between the current Prisma model and either migrated schema.
   Migrations were not run against Neon or the installed restaurant database.
3. **Conflict rules.** Matching categories map by exact name; products map by
   slug, with a unique exact-name/category fallback for legacy local products;
   variants map by parent/name. Matching products take production catalog
   fields but retain local stock and stock timestamp. New products get source
   stock. Tables map by number but retain local state; users map by username
   and require matching name/role while retaining the local password. Exact
   local settings are retained; differing settings block the import, except
   the explicit test-only option for the known settings row inserted by a
   fresh Prisma migration. Order, item, and payment IDs remain exact. Any
   differing order-ID or payment conflict stops the transaction rather than
   renumbering history.
4. **Transactional import.** `apps/server/scripts/migrate-production-data.cjs`
   reads a repeatable-read, read-only source snapshot and writes destination
   rows in one serializable transaction. It imports dependencies first, keeps
   ID mappings for remapped dimensions/catalog rows, does not copy
   `_prisma_migrations`, validates source row mappings, row read-backs,
   financial aggregates, payment-method/status groups, FK integrity, and
   sequences, and then commits. A repeat with identical source rows is a
   no-op. Product stock movements are copied only if present in the source;
   none existed in this snapshot. The source preflight now requires all nine
   source business tables and their required columns; it permits only the two
   known missing historical tender columns (`cashAmount`, `upiAmount`) and an
   absent `ProductStockMovement` table. It refuses partial sources before any
   destination rows are written. Destination preflight checks the required
   tables/columns; migration-ledger and full Prisma schema-diff verification
   remain separate deployment checks.
5. **Validation on isolated targets.** A clean migrated target received the
   complete snapshot with the same counts for every business table. A second
   target with synthetic local-only catalog rows, a matched product with
   local stock 777, a differing variant price, a same-username user with a
   local password, local table state, custom setting row, and local order/item/
   payment retained those records and stock. Re-running imported no new rows.
   A conflicting `Order.id` test and a differing-settings test both rolled
   back all attempted source inserts. These fixtures are synthetic and are
   not records from the restaurant installation.
6. **Application API exercise.** Against the isolated imported database, a
   synthetic administrator login succeeded; product/categories APIs returned
   130 products, 16 categories, and 32 variants (the extra product/category
   were local-only fixtures). Order history returned 84 orders including the
   one synthetic local order; completed billing returned its latest 50-row
   page. A historical variant-linked bill preserved its variant ID and line
   price. The October workbook was generated in memory, parsed with ExcelJS,
   and contained 82 paid completed orders with ₹34,310 income. No report file
   was written to a production path.
7. **Not a live deployment.** The isolated API/database test does not verify
   the packaged Windows UI or a physical waiter APK. Do not install or import
   into the restaurant POS as part of this work. Those checks require a
   dedicated Windows/Android test LAN; any real local DB import requires a
   separate approved backup and conflict review.

## Current status

| Item | Status | Evidence / remaining action |
| --- | --- | --- |
| Production table/schema/count audit | PASS | Read-only Neon audit and consistent export; snapshot counts listed above |
| Production data changed | PASS (unchanged) | Read-only dump only; no Neon/Render write or migration |
| Isolated PostgreSQL target | PASS | Loopback-only UTF-8 cluster, port 55432; target backups validated |
| Schema compatibility | PASS (isolated) | Fresh target and production clone have no Prisma diff after migrations |
| Full snapshot imported in isolated DB | PASS | All nine business tables match source snapshot counts; zero orphan FKs |
| Variants, stock and repeat import | PASS (isolated) | 32 variants retained; local matching stock preserved; second import no-op |
| Conflict rollback | PASS (isolated) | Different settings and conflicting historical order ID rejected transactionally |
| ProductStockMovement | PASS (no history invented) | Absent in source; destination table created empty; 0 source rows |
| Application API/auth/history/report exercise | PASS (isolated) | Synthetic admin login, menu APIs, billing/history, variant bill, workbook parse |
| Current source-schema guard | PASS | Latest `test:financial` run passed required-table/column checks; missing-table and missing-field rejection covered |
| Current database-backed importer tests | BLOCKED — NOT TESTED | Both repeat-import/preservation and rollback integration tests skipped because isolated DB test URLs were not configured |
| Installed API read-only check | PASS | Health OK; still 0 products, 5 categories; live DB unchanged |
| Installed full local schema/count audit | BLOCKED | Protected config ACL denied access; no live local DB write attempted |
| Packaged desktop UI / physical waiter LAN | NOT TESTED | No isolated Windows package install or Android device test |
| Full-data import to restaurant-local DB | BLOCKED | Requires approved local inventory/backup and resolution of settings/order conflicts |
