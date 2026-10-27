# BIG BITES POS Migration Resolution Proposal

**Prepared:** 2026-10-23; evidence updated 2026-10-25
**Status:** Target identified, repair rehearsal and migration sequence remain
unapproved. No database action was performed.

This document records repository evidence and safe decision gates. The
installed service target is identified from sanitized, elevated evidence, but
that does not authorize changing it, importing data, or changing migration
history. Migration status for other intended/authoritative targets remains
**UNKNOWN**.

## Confirmed repository conflict

The canonical migration tree contains 16 directories; the standalone tree
contains 12. The standalone tree is missing:

- `20261006220000_add_gst_toggle_and_order_reports`
- `20261009230000_menu_variants_classification`
- `20261013010000_cash_upi_split_payment`
- `20261013213000_add_product_stock_movements`

All shared migration names have matching SQL SHA-256 digests. Both trees
contain byte-identical
`20261020100000_remove_product_stock/migration.sql`.

The canonical Prisma schema and TypeScript routes require inventory and stock
movement support. The standalone Prisma schema omits those models and fields;
its compiled routes perform stock deduction/restoration but do not record
stock movements or reference product variants. Its compiled billing route
handles cash amount received/change but not CASH + UPI split amounts. The
standalone schema also lacks GST/report fields that parts of its compiled
admin/order routes reference.

Tauri's current resource map and pre-build command select `apps/server`, not
`BIG-BITES-SERVER-CLIENT`. This establishes the configured source path, not
the contents or compatibility of an unbuilt installer.

## Exact migration effects

- `20260914084442_initial_hotel_pos` creates `Product.stock` as a non-null
  integer with default `0`.
- `20261009230000_menu_variants_classification` adds product metadata,
  including `stockUnit`, `lowStockThreshold`, and `lastStockUpdatedAt`;
  creates `ProductVariant`; and adds `OrderItem.variantId` and its
  relationship.
- `20261013213000_add_product_stock_movements` creates
  `ProductStockMovement` with `productId`, movement type, quantity,
  `previousStock`, `newStock`, reason, and timestamp, with a foreign key to
  Product. It does not contain an `orderItemId`.
- `20261006150000_payment_tender_details` adds `Payment.amountReceived` and
  `Payment.change`.
- `20261006220000_add_gst_toggle_and_order_reports` adds
  `RestaurantSettings.gstEnabled`, `RestaurantSettings.orderReportsPath`, and
  `Order.gstEnabled`.
- `20261013010000_cash_upi_split_payment` adds `CASH_UPI` to
  `PaymentMethod` and adds `Payment.cashAmount` and `Payment.upiAmount`.
- `20261020100000_remove_product_stock` runs:

  ```sql
  DROP TABLE IF EXISTS "ProductStockMovement";

  ALTER TABLE "Product"
    DROP COLUMN IF EXISTS "stock",
    DROP COLUMN IF EXISTS "stockUnit",
    DROP COLUMN IF EXISTS "lowStockThreshold",
    DROP COLUMN IF EXISTS "lastStockUpdatedAt";
  ```

The final migration directly destroys the stored stock values, stock metadata,
and movement history if applied. It does not directly drop variants, orders,
order items, payments, or settings. Their continued compatibility is still at
risk from schema/runtime mismatch and incomplete standalone migration
resources.

## Data and runtime risks

1. If the stock-removal migration is pending and deployed, each product's
   stock values and all movement history are dropped. A later additive schema
   migration cannot reconstruct that information by itself.
2. If it has already been applied, the canonical source schema expects fields
   and a table that may no longer exist. Runtime inventory queries can fail;
   restoring the shape alone would not restore prior values or history.
3. The standalone runtime lacks variant-aware order items, stock movement
   records, and split-payment persistence in its Prisma schema. Compiled
   routes and copied Prisma Client are not established as matching canonical
   source.
4. Migration status and actual data/schema state remain unknown for every
   target other than the sanitized evidence reported above for installed
   `bigbites`. The presence of repository files, old audit text, or a backup
   directory is not evidence of target state or a restorable backup.

## Latest installed-target evidence and endpoint distinction

Sanitized, elevated process/service evidence identifies the installed
service's target as database `bigbites` at `127.0.0.1:5432`. PID 9544 remains
untouched. The target has 5 Category rows, 3 User rows, and 9
RestaurantTable rows; Product, Order, OrderItem, and Payment have zero rows.
`Product.stock` exists, while `Category.sortOrder`, `Product.slug`, stock
metadata, `ProductVariant`, and `ProductStockMovement` are absent. Its 12
successful migration entries end at
`20261006220000_add_gst_toggle_and_order_reports`. The later variants,
split-payment, stock-movement, and stock-removal migrations are not recorded
as applied.

At the same IPv4 endpoint, `hotel_pos` and `hotel_pos_recovery_check` have no
user tables. Earlier non-empty counts for those names came from IPv6 loopback
(`::1`). It is not established that the two loopback addresses reach the same
PostgreSQL cluster. Therefore those earlier databases are not a verified
backup or source for `bigbites`, and no cross-endpoint copy is proposed.
Preserve the existing categories, users, tables, `Product.stock` column, and
ledger. Zero Product/Order/OrderItem/Payment rows do not justify removing
inventory capability or treating the database as empty.

## Migration guards and limitations

- Canonical `npm start` uses `prestart`, which exits without migration in
  local/non-production mode and otherwise runs the canonical guard before
  invoking `prisma migrate deploy`.
- Standalone `npm start` has a separate prestart guard before its deploy
  invocation. Its required canonical migration set is incomplete in the
  current standalone tree, so the normal production startup path fails closed.
- The Windows installer validates required packaged schema/migration
  resources, scans migration SQL for known inventory-drop patterns, rejects
  the stock-removal migration, and checks required inventory schema before
  stopping the existing server and before its direct `migrate deploy`.
- Direct `prisma migrate deploy` invocations bypass these application and
  installer guards. Starting the server with `node dist/server.js` also
  bypasses npm's `prestart`, though that command does not itself run a
  migration.
- Static allowlists and SQL-pattern checks do not verify a target's migration
  ledger, checksums, actual schema, data, or backup. They are not proof of
  database compatibility. A later build/release must also validate packaged
  resources; no installer or APK was built in this review.

## Evidence required before selecting a correction

For each separately authorized target, its data owner/DBA must provide a
sanitized report containing:

1. Exact target identity and owner authorization, without sharing credentials.
2. `_prisma_migrations` entries, checksums, success/rollback state, and
   completion timestamps, including the stock-removal migration.
3. Actual schema evidence for Product stock columns; stock movement table,
   columns, indexes, and foreign keys; ProductVariant and
   OrderItem.variantId; payment enum and tender fields; GST/report settings;
   and required order relationships.
4. Sanitized counts/aggregates sufficient to reconcile products, variants,
   stock movements, orders, order items, and payments without exposing
   customer/person-level records.
5. Backup provenance and a demonstrated restore into a new, isolated target.
   A backup file's existence is insufficient.

Evidence must be gathered and authorized by the data owner. The installed
target facts above come from sanitized, elevated owner-provided evidence; this
task did not directly connect to or modify any database.

## Forward-only repair plan for `bigbites` (rehearsal only; live changes blocked)

The evidence supports a narrowly scoped additive schema rehearsal on a
verified disposable clone of `bigbites`; it does not yet support applying the
repair to the installed database.

1. With elevated owner authorization, make a custom-format `pg_dump` of the
   identified `bigbites` database into a new, access-restricted backup
   directory. Record its SHA-256 and restore it with `pg_restore --exit-on-error`
   into a uniquely named new database on the same verified PostgreSQL
   instance. Do not use `--clean`, overwrite, or drop any database.
2. Before repair, compare the clone's table counts, schema, and migration
   ledger with the source. Require an exact match for existing data and the
   known target identity. Abort the rehearsal if the endpoint, ledger, or
   counts differ, or if restore reports an error.
3. On that clone only, rehearse the additive SQL from the unchanged canonical
   migrations, in order:
   `20261009230000_menu_variants_classification`,
   `20261013010000_cash_upi_split_payment`, and
   `20261013213000_add_product_stock_movements`. Check their preconditions
   and SQL checksums first. Do not run `20261020100000_remove_product_stock`.
   Do not edit or resolve `_prisma_migrations`; the rehearsal must leave the
   clone ledger as evidence of the actual unresolved history.
4. Verify on the clone that existing Category/User/RestaurantTable records
   are unchanged, `Product.stock` remains, the missing catalog fields and
   variant/payment schema are present, and the newly created movement table
   is empty (no historical movement data exists in the source to restore).
   Then run the canonical backend against only that clone on isolated test
   ports and verify `/health`, categories and products return successfully,
   and a nonexistent product detail returns the expected not-found response.
   This tests API compatibility, not production migration eligibility.
5. Leave `bigbites` and PID 9544 untouched. If a later owner-approved cutover
   is considered, retain the original database unchanged as the immediate
   fallback; validate the repaired clone and the restore procedure before any
   configuration switch. On failure, keep the service on the original
   database. Never restore over or delete the original.

This rehearsal does not make normal `prisma migrate deploy` safe. The
stock-removal migration remains pending and the existing guards must continue
to reject the migration set. Before any live repair, the database owner, DBA,
and application maintainer must approve a history-preserving mechanism for
the existing ledger that neither executes the stock-removal SQL nor fabricates
an applied migration record. No such mechanism is selected here. If they
cannot approve one without modifying historical SQL or the ledger, the
installed target remains blocked.

## Recommended source-of-truth architecture

Treat `apps/server/src`, its Prisma schema, migration tree, and reproducible
build as the sole reviewed backend source for desktop packaging. The current
Tauri configuration already points to `apps/server`; verify actual package
contents only in a separately approved release task. Do not hand-copy
compiled JavaScript or blindly copy migration directories into the standalone
bundle. Either retire that bundle from delivery through an approved
architecture decision or replace it in a future reviewed change with a
deterministic build/package output from the canonical source revision.

Do not change Render/Neon or local-server architecture as part of this
proposal.

## Approval-gated rollout and recovery

1. Obtain the per-target ledger/schema/aggregate report and verified-restore
   evidence above.
2. Have the owner/DBA and application maintainer approve the target-specific
   history-preserving resolution and exact end schema.
3. Separately authorize a disposable PostgreSQL database on the verified
   compatible instance, or a newly provisioned isolated instance; verify its
   identity and empty state before any test command.
4. Rehearse only the approved plan against that isolated target, then compare
   migration ledger and actual schema and test stock movement, concurrent
   orders, cancellation, payments, and rollback with real PostgreSQL
   transactions.
5. Compare sanitized pre/post aggregates and exercise restore into another
   isolated target before considering any non-disposable environment.
6. Require explicit owner authorization for any later deployment. Confirm
   target identity immediately before each authorized operation and retain a
   tested recovery path.

If any ledger/checksum/schema mismatch, missing stock data, failed restore,
unexplained aggregate change, or partial transaction is observed, stop and
recover only from the approved isolated backup. Production recovery or rollout
requires a separate authorization and execution plan.

## Current decision

The installed target is identified, but its repair and release remain
**BLOCKED**. No backup/restore rehearsal, migration, database write, import,
service restart, or production access has occurred. The exact next action is
for an elevated database owner/operator to create and verify the protected
backup and isolated clone described above, then return sanitized results
(backup hash, clone identity, before/after aggregate counts, schema/ledger
verification, and isolated API results). Credentials and connection strings
must not be returned. After rehearsal, a separate owner/DBA/maintainer
decision is still required for the migration-history conflict before any
live repair or release.
