# BIG BITES POS Client Database Safety Evidence Report

**Updated:** 2026-10-25
**Scope:** Source/runtime review and metadata-only inspection of the configured
loopback database. Backend/frontend/Android/NSIS builds and isolated source
tests were run. No Render or Neon service, installer execution, migration,
seed, production-data copy, or deployment was run.

## Executive status

**Database safety is not established; do not proceed with client database
setup, migration, import, or handover.** Sanitized, elevated evidence now
identifies the installed service's database as `bigbites` on
`127.0.0.1:5432`. The service still logs missing `Category.sortOrder` and
`Product.slug` columns. This database has 5 categories, 3 users, and 9
restaurant tables, but zero products, orders, order items, or payments.
`Product.stock` exists, but there are no product rows, the other inventory
metadata columns and `ProductStockMovement` are absent, and no stock
quantities or movement history can be inferred. Preserve the existing
categories, users, tables, schema, and migration ledger.

The earlier `hotel_pos` and `hotel_pos_recovery_check` counts were observed
through IPv6 loopback (`::1`). On the installed service's IPv4 endpoint,
both same-named databases have no user tables. The IPv4 and IPv6 results
therefore do not establish that those names refer to the same PostgreSQL
cluster. Do not use the earlier recovery database as a source for `bigbites`.
No backup/restore rehearsal or database change has been performed.

The latest NSIS candidate is under
`release-candidates/blocked-secure-postgres/` and is not a client deliverable. The
NSIS installer is unsigned and its packaged migration set is intentionally
blocked by the stock-removal migration guard. The waiter APK was rebuilt,
signed with the same certificate as the preserved prior APK, and assigned
version code 2; neither package was installed or tested against a live backend.
The installer source no longer passes the generated PostgreSQL superuser
password in `winget` arguments. It writes unattended settings to a temporary
response file in a GUID-named directory protected for SYSTEM, Administrators,
and the current installer identity, then removes that file and directory on
success and package failure. An isolated PowerShell harness verified the
argument shape, directory ACL, and cleanup paths without running `winget` or
installing PostgreSQL. The exact PostgreSQL package's response-file handling
and its installer logging behavior remain unverified; do not treat this
source-level test as proof of a successful PostgreSQL installation. No
credential value was read or recorded in this report.

The server obtains its database connection from the `DATABASE_URL` environment
variable. User-provided sanitized, elevated process/service evidence identifies
the installed process target as `bigbites` on `127.0.0.1:5432`; this does not
identify an authorized source for any import or make `bigbites` the approved
customer source of truth. Historical Render/Neon statements remain
unverified. Do not connect to, modify, or import from either provider.

## Facts verified from repository source and local metadata

### Database configuration and target

- `apps/server/src/config/database.ts` reads `DATABASE_URL` at runtime. It
  enforces loopback database hosts for local or non-production processes; the
  source does not hardcode a production database identity.
- The standalone package `.env` was used only in-process for read-only
  connections explicitly directed to `hotel_pos` and
  `hotel_pos_recovery_check`. Credentials and the original URL were not
  printed. Those counts came from IPv6 loopback (`::1`), not the installed
  service's IPv4 target.
- `docs/DATABASE_EVIDENCE_COLLECTION.md` describes Render as the proposed
  source and says the exact backing database must be confirmed out of band;
  it explicitly excludes Neon from that proposed transfer.
- `docs/PRODUCTION_DATA_MIGRATION_AUDIT.md` contains historical statements
  identifying Neon as a configured target. This source-only review did not
  validate those historical claims or contact either provider.
- The installed local service target is now identified as `bigbites` on
  `127.0.0.1:5432`; the authoritative source for customer data and the
  intended final deployment target remain **unresolved** until the owner/DBA
  confirms them. Local database names or recovered counts are not proof of
  production identity or data equivalence.

### Current API failure and local database comparison

The owner-provided elevated process evidence identifies PID 9544 as
`C:\Program Files\nodejs\node.exe` running
`C:\ProgramData\BIG BITES POS\server\dist\server.js`; it owns TCP 3000 and UDP
3001. `/health` returned `status: OK` and `database: Connected`, while the
categories and products endpoints returned HTTP 500. Sanitized server-log
entries identify Prisma error P2022:

- `/api/products/categories`: `Category.sortOrder` does not exist.
- `/api/products` and `/api/products/:id`: `Product.slug` does not exist.

This establishes a runtime/database schema mismatch as the cause of the
catalog failures. Sanitized, elevated service evidence identifies the target
as `bigbites` on `127.0.0.1:5432`. PID 9544 was not stopped, and the protected
service files were not read from this session. Do not restart the process,
switch its database, or migrate it until the target-specific backup has been
restored and the forward-only repair path has been rehearsed.

The same-endpoint schema and ledger evidence for `bigbites` reports:

- 5 Category rows, 3 User rows, and 9 RestaurantTable rows; Product, Order,
  OrderItem, and Payment have zero rows.
- `Product.stock` exists. `Category.sortOrder`, `Product.slug`, stock metadata,
  `ProductVariant`, and `ProductStockMovement` are absent.
- 12 successful migration entries end at
  `20261006220000_add_gst_toggle_and_order_reports`. The canonical variants,
  split-payment, stock-movement, and stock-removal migrations are not recorded
  as applied.
- The same-endpoint `hotel_pos` and `hotel_pos_recovery_check` databases have
  no user tables. Earlier counts for those names came from `::1`; that
  endpoint discrepancy is unresolved, so those databases are not evidence of
  `bigbites` contents.

The target is populated and must not be treated as empty or initialized.
Although the observed catalog/transaction row counts are zero, the existing
categories, users, and tables must be preserved. The existing `Product.stock`
column must also remain; the empty product count does not justify removing
inventory support.

Read-only local database results:

| Endpoint | Database | Category | Product | Variants | Tables | Users | Orders | OrderItems | Payments | Inventory schema |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `::1` (earlier inspection) | `hotel_pos` | 5 | 11 | 0 | 10 | 4 | 23 | 52 | 23 | `Category.sortOrder` exists; Product stock fields and `ProductStockMovement` are absent. |
| `::1` (earlier inspection) | `hotel_pos_recovery_check` | 15 | 129 | 32 | 9 | 6 | 69 | 173 | 69 | Product stock fields and `ProductStockMovement` schema exist; movement row count is 0. |
| `127.0.0.1:5432` (installed service) | `bigbites` | 5 | 0 | 0 | 9 | 3 | 0 | 0 | 0 | `Product.stock` exists; other stock metadata and `ProductStockMovement` are absent. |

The canonical Prisma category query succeeded read-only against `hotel_pos`
at `::1` and returned 5 categories. Its product query failed with P2022
because `Product.stock` is absent. Both category and product queries
succeeded against `hotel_pos_recovery_check` at `::1`, returning 15 categories
and 129 products with 32 active variants. The installed `bigbites` target is
separate evidence on `127.0.0.1:5432`; do not treat either IPv6 database as a
copy or source for it. The recovery database's zero stock movement rows and
user-reported default-zero stock values remain data gaps.

The `hotel_pos` ledger reports
`20261020100000_remove_product_stock` as successful. The recovery ledger
instead reports `20261020101500_remove_product_stock` as successful with a
different checksum. Preserve both ledgers unchanged; do not apply, rename,
or mark migrations to reconcile them.

### Canonical schema and migration effects

The committed baseline schema declares:

- `Product.stock`, `stockUnit`, `lowStockThreshold`, and `lastStockUpdatedAt`.
- `ProductStockMovement`, with product link, movement type, quantity,
  previous/new stock, reason, and timestamp.
- `ProductVariant` and optional `OrderItem.variantId`.
- `PaymentMethod` values `CASH`, `UPI`, `CARD`, and `CASH_UPI`; payment fields
  include `amountReceived`, `change`, `cashAmount`, and `upiAmount`.
- GST fields on `Order` and `RestaurantSettings`, plus reporting path and
  restaurant compliance/address settings on `RestaurantSettings`.

Relevant canonical migration files add the movement table, variants and
variant links, payment tender fields, split CASH+UPI fields/enum, and GST/report
fields. The repository has 16 canonical migration directories. The separate
`BIG-BITES-SERVER-CLIENT` tree has 12 and is not schema/runtime-equivalent; it
does not provide a substitute evidence source for the canonical target.

The current source restores the Product stock fields and movement model, and
the bootstrap allowlist includes the movement table. Server order routes
conditionally deduct stock in the order transaction, record movement history,
and restore stock on cancellation. Admin stock adjustments and unpaid-order
deletion also record transactional movements; deleting a cancelled order does
not restore the same stock twice. Desktop admin/order views and the waiter
ordering view expose on-hand quantities and prevent selecting more than the
locally reported stock. Focused mocked tests and source builds pass, but they
do not establish transaction behavior against PostgreSQL.

An earlier IPv6 loopback (`::1`) inspection found a stockless 129-Product
database. The earlier read-only comparison at that endpoint distinguishes
`hotel_pos` (11 Products and no stock schema) from
`hotel_pos_recovery_check` (129 Products and stock schema, but no movement
rows). These are not established as the IPv4 cluster that hosts `bigbites`.
The schema, routes, and UI changes do not alter any database or apply
migrations.

The installed service's `dist/server.js`, `dist/routes/products.js`, and
`dist/config/database.js` SHA-256 fingerprints match the local
`BIG-BITES-SERVER-CLIENT` compiled files dated October 23, 2026. The installed
`package.json` is dated October 6, while the local standalone manifest is
dated October 22. This is a mixed-age installed payload; it does not by itself
justify replacing the active runtime.
A separate isolated startup attempt using the developer-side
`BIG-BITES-SERVER-CLIENT` directory exited before listening because its
installed `node_modules` lacked `exceljs`, which its compiled reporting module
requires. The standalone manifest does not declare `exceljs`; this is distinct
from the running `ProgramData` process and from the canonical Tauri build
source (`apps/server`), which does declare the dependency. No dependency or
live runtime was changed.
The Windows installer rejects the known stock-dropping migration and any
database that does not match the inventory schema. A customer deliverable
cannot be produced safely until a target-specific backup has been restored
into an isolated database, the additive repair has been rehearsed there, and
the unresolved migration-lineage gate has an approved, history-preserving
resolution.

The exact SQL in
[`20261020100000_remove_product_stock`](../apps/server/prisma/migrations/20261020100000_remove_product_stock/migration.sql)
drops `ProductStockMovement` and the four Product stock fields above. It would
destroy their stored values/history if applied. Recreating empty fields or a
movement table later cannot reconstruct the deleted records.

The source SHA-256 for the stock-removal migration in this checkout is
`06364D5F7BCF2E4C105F8D5D74A185BF26017B2D9B5648E6439F61F86F7E58DF`.
The `hotel_pos` ledger reports
`20261020100000_remove_product_stock` successful with that checksum. The
`hotel_pos_recovery_check` ledger instead reports
`20261020101500_remove_product_stock` successful with checksum
`98c0f088b6a25779eff60a5f618750ce8b2caee557334c316a68d41a1c9fa751`, and
contains a rolled-back and subsequently successful
`20261009230000_menu_variants_classification` entry. The recovery ledger's
stock-removal name/checksum does not match the repository migration. No ledger
rows were changed. No product/order/payment row values were queried.

### Migration guards and their limits

- Canonical production `npm start` runs
  `apps/server/scripts/run-start-migrations.cjs`, which calls
  `assertSafeMigrationSet` before invoking `migrate deploy`.
- The canonical guard rejects the named stock-removal migration, recognized
  stock-destructive SQL, incomplete or unreviewed migration directories, and
  schemas missing required stock fields or the movement model.
- The Windows installer rejects stock-destructive SQL for fresh and existing
  databases, checks ledger names/checksums and refuses pending migrations for
  an existing database, and validates inventory schema before stopping the
  existing server.
- The standalone production startup runner also has a migration preflight,
  but that tree has a different/incomplete migration and schema set.
- Direct Prisma CLI invocation can bypass application and installer guards.
  Static guards check repository resources and command ordering; they do not
  prove a target's data equivalence or that its backup can be restored.

## Facts requiring authorized owner/DBA evidence

Provide a separate sanitized evidence package for **each** intended source and
destination. Do not include credentials, connection strings, hostnames,
passwords, tokens, application rows, or private backup paths.

### 1. Target identity and source-of-truth approval

The owner must provide:

- A neutral target label and environment category for each database.
- Confirmation, out of band, of the actual provider/database identity and
  which service/application uses it.
- Written approval identifying the authoritative source for the client
  transfer, plus the owner authorization/ticket reference and collection
  operator.
- A clear statement of whether Render or Neon is in scope. Do not treat
  current documentation or a previous report as sufficient identity proof.

### 2. Migration names, checksums, and status

For each target, the authorized DBA should provide sanitized rows from
`public."_prisma_migrations"` containing only:

- `migration_name`
- `checksum`
- `started_at`
- `finished_at`
- `rolled_back_at`

Include all rows needed to compare the complete target history with the
reviewed repository set, not just the stock-removal migration. Explicitly
state the target status of `20261020100000_remove_product_stock` as absent,
successful, failed/incomplete, rolled back, or unknown, using the collection
rules in [DATABASE_EVIDENCE_COLLECTION.md](./DATABASE_EVIDENCE_COLLECTION.md).
Report any repository migrations absent from the ledger, ledger migrations
absent from the repository, checksum mismatches, and missing/unreadable
ledger evidence. Do not infer migration status from schema shape alone.

### 3. Actual schema metadata

For the same target, provide read-only catalog metadata—not application
records—showing tables, columns, PostgreSQL types, nullability, defaults,
enum values, and relevant constraints/indexes for:

- `Product`: `stock`, `stockUnit`, `lowStockThreshold`,
  `lastStockUpdatedAt`.
- `ProductStockMovement`: presence and `id`, `productId`, `movementType`,
  `quantity`, `previousStock`, `newStock`, `reason`, `createdAt`; include the
  product foreign key.
- `ProductVariant`: presence and `id`, `name`, `price`, `isActive`,
  `productId`; include its product relationship.
- `OrderItem`: `id`, `orderId`, `productId`, `quantity`, `unitPrice`,
  `subtotal`, `variantId`; include the variant relationship and nullability.
- `Payment`: `amount`, `amountReceived`, `change`, `cashAmount`, `upiAmount`,
  `method`, `status`, and `orderId`; include the exact `PaymentMethod` enum
  values and ordering, including whether `CASH_UPI` exists.
- `Order`: `gstRate`, `gstEnabled`, `status`, `total`, `tableId`, and
  `waiterId`.
- `RestaurantSettings`: `gstRate`, `gstEnabled`, `orderReportsPath`,
  `restaurantAddress`, `fssaiEnabled`, `fssaiNumber`, `gstinEnabled`, and
  `gstinNumber`.

Compare actual schema metadata with the canonical schema and migration SQL.
Record ledger/schema contradictions separately. Missing or inaccessible
metadata must be marked **UNKNOWN**, not presumed present or absent.

### 4. Verified backup and restore

For each source whose data may need protection, provide an owner-approved
evidence reference showing a backup was restored and validated in a separate,
isolated database/instance. Include only:

- Approved backup/evidence reference and source target label.
- Backup time, restore time, and responsible operator.
- A destination label proving it is separate from the source and all live
  targets.
- The approved validation procedure/reference and pass/fail outcome.
- Confirmation that the operation did not alter the source.

A backup file or successful backup command alone is insufficient. If no
isolated restore and validation evidence exists, mark it **NOT VERIFIED**.

## Unresolved risks and required approvals

1. **Do not apply the stock-removal migration blindly.** If pending, ordinary
   migration deployment would drop live inventory fields and movement history.
   If already applied, restoring an empty schema does not restore deleted stock
   or movement records. A migration ledger and actual schema can also disagree
   because of manual changes, partial failures, restores, or later changes.
2. **Do not bypass guards.** Direct Prisma commands are not protected by
   application entry-point preflights. No migration, migration resolution,
   `db push`, seed, import, or data change is authorized by this report.
3. **Do not assume provider/source identity.** Resolve the documentation
   conflict and approve the exact target independently for each environment.
4. **Do not select a correction yet.** The owner, DBA, and application
   maintainer must review the per-target ledger, schema, discrepancies, and
   verified restore evidence, then approve an exact history-preserving plan.
5. **Keep environments separate.** Evidence from one database cannot establish
   another database's state. Do not merge Render and Neon data or use a live
   target as a rehearsal environment.

## Exact next request to the authorized database owner/DBA

Please provide, through an approved secure channel and without secrets:

1. The intended source and destination labels, target identity confirmation,
   and owner approval of the source of truth.
2. Per-target migration ledger rows with names, checksums, timestamps, and
   applied/failed/rolled-back state, explicitly covering
   `20261020100000_remove_product_stock`.
3. Per-target catalog metadata for the stock fields/table, variants and
   `OrderItem.variantId`, payment fields and enum values, and GST/report fields
   listed above, including relevant relationships.
4. A reference and outcome for a successful restore of the approved backup to
   a distinct isolated database, with validation and operator details.
5. Any discrepancies or unavailable evidence clearly marked **UNKNOWN**.

Until this evidence is reviewed and the owner separately approves a
target-specific, history-preserving plan, the database safety decision remains
**BLOCKED**. This report does not certify client readiness.
