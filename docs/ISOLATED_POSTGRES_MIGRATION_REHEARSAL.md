# BIG BITES POS Isolated PostgreSQL Rehearsal

**Status:** Procedure proposal only. No backup was restored, database was
created, migration/import was run, or external service was accessed while
preparing this document.

## Decision and scope

The repository has a PostgreSQL custom-format backup mechanism and a
test-restricted row importer, but it does **not** currently have an approved,
end-to-end production-to-local rehearsal sequence.

- The Windows installer uses `pg_dump --format=custom` for a local
  pre-migration backup and checks the archive with `pg_restore --list`.
  Listing an archive is not a restore test. This installer path is not a
  production export workflow.
- `apps/server/scripts/migrate-production-data.cjs` is a row importer, not a
  PostgreSQL backup/restore tool. It accepts only a loopback source named
  `bigbites_test_production_clone` and a loopback target named
  `bigbites_test_*`, both on non-default ports, with `NODE_ENV=test`.
  It reads the source in a repeatable-read read-only transaction and writes
  to the target in a serializable transaction. It does not create a database
  or its schema.
- The importer requires a target containing all tables and fields in its
  `DATABASE_FIELDS` manifest, including product stock, variants,
  `OrderItem.variantId`, payment tenders, and `ProductStockMovement`. There
  is no current approved target-schema provisioning command: normal migration
  paths fail closed on the stock-removal migration, and bypassing those guards
  is not an acceptable workaround.
- The importer does not require `ProductStockMovement` to exist in the source:
  if the source table is absent, it reads zero movement rows. A successful
  import therefore does not prove movement history was present or transferred.
  For a matched target product, updates deliberately omit stock, stock unit,
  threshold, and last-update fields, preserving target inventory; only a
  source-only product receives source stock fields. This is a merge policy,
  not a source-to-target inventory replacement.
- Some dimension IDs are mapped by business key (category name, product
  slug/name plus category, variant product/name, table number, and user
  username with name/role validation). Colliding IDs can be remapped for
  those dimensions, with dependent references mapped accordingly. Historical
  order/item/payment/movement IDs are not generally remapped: conflicting
  history causes the transaction to fail. This importer cannot promise
  universal primary-key preservation or safely merge arbitrary histories.
- The two database-backed importer tests in
  `apps/server/tests/production-data-migration.test.cjs` require separately
  prepared isolated endpoints and have not been run in this task.

Accordingly, a full backup restore can be rehearsed only after the approved
backup, source identity, format, and isolated destination are established.
The importer rehearsal remains blocked until the owner/DBA approves and
provisions a schema-ready disposable target without running or bypassing the
current migration guard. This document does not authorize either operation.

## Verified source facts

The canonical Prisma schema contains `Product.stock`, `stockUnit`,
`lowStockThreshold`, `lastStockUpdatedAt`, `ProductStockMovement`,
`ProductVariant`, optional `OrderItem.variantId`, order/payment history,
`CASH`, `UPI`, `CARD`, `CASH_UPI`, GST, and restaurant/report settings.

`apps/server/prisma/migrations/20261020100000_remove_product_stock/migration.sql`
drops `ProductStockMovement` and the four product stock fields. Its status in
every actual database is unknown. The canonical startup guard and Windows
installer reject the current migration set; do not remove, rewrite, resolve,
or deploy that migration to make a rehearsal proceed.

### Guard and entry-point trace

- `apps/server/package.json` runs `scripts/run-start-migrations.cjs` as
  `prestart`.
- That runner intentionally exits without migrations in local mode or
  non-production mode. Otherwise it calls
  `scripts/assert-safe-migrations.cjs` before invoking Prisma
  `migrate deploy`.
- The canonical guard rejects the named inventory-removal directory,
  destructive stock SQL (including a renamed directory), missing or
  unreviewed migration resources, and a packaged schema without the stock
  fields/model.
- `apps/desktop/src-tauri/windows/Install-BigBites.ps1` performs an
  equivalent migration/schema preflight before stopping the existing server.
  Its direct Prisma `migrate deploy` is later in the installer flow; the
  current migration is explicitly rejected before that point.
- `BIG-BITES-SERVER-CLIENT/scripts/run-start-migrations.cjs` contains a
  separate guard, but the standalone tree is not the configured canonical
  resource source and is not schema/runtime equivalent.
- Direct Prisma CLI invocation can bypass these wrapper guards. Guard
  results are checks of packaged source resources and ordering, not a query of
  a target database's migration ledger, schema, data, or restore state.

The removed resources are used by the canonical application:

- `apps/server/src/routes/products.ts` returns stock and thresholds, derives
  availability from stock, and queries variants.
- `apps/server/src/routes/admin.ts` creates/edits stock, records adjustment
  and restock movements, and exposes stock-movement history.
- `apps/server/src/routes/orders.ts` locks products, checks/decrements stock,
  records SALE movements, and restores stock with CANCELLATION movements.
- `apps/desktop/src/App.tsx` displays stock/low-stock state and limits waiter
  quantities to available stock.
- `apps/waiter_app/lib/main.dart` displays stock and disables unavailable
  product quantities.

The destructive SQL does not directly remove variants, order items, orders,
payments, users, settings, or their IDs. It does make the inventory-dependent
canonical routes and UI incompatible with the resulting database shape.

Related canonical migrations include
`20261009230000_menu_variants_classification` (stock metadata, variants,
`OrderItem.variantId`, category classification/order),
`20261013213000_add_product_stock_movements` (movement table and restrictive
Product foreign key), `20261006150000_payment_tender_details`
(`amountReceived` and `change`), `20261013010000_cash_upi_split_payment`
(`CASH_UPI`, `cashAmount`, `upiAmount`),
`20260929210000_add_gst_settings`,
`20260929220000_add_restaurant_address`,
`20261003120000_add_fssai_gstin_settings`,
`20261006220000_add_gst_toggle_and_order_reports`, and
`20260928234000_pending_order_payments`. The earlier
`20260922200000_remove_kitchen_role` converts KITCHEN users to WAITER;
`20261003130000_remove_manager_role` deletes MANAGER users if no orders
reference them. Their actual application on any target is unknown and must be
included in owner/DBA history review.

The repository contains `.dump` files, but their source, database identity,
consistency, exact format, integrity, and successful restorability have not
been established by this review. Do not use one as a rehearsal input until an
authorized owner/DBA approves its provenance and confirms that it is the
intended snapshot. No backup contents or application rows were inspected.

## Minimum approvals and evidence before any command

The authorized owner/DBA and test operator must record all of the following:

1. The authoritative source label, identity confirmation performed out of
   band, and written approval for the exact snapshot and its use. Render/Neon
   remain untouched by this procedure.
2. Sanitized per-target `_prisma_migrations` names, checksums, timestamps,
   completion/rollback status, and actual schema metadata. Explicitly state
   the status of `20261020100000_remove_product_stock`.
3. Confirmation that the approved snapshot contains the required stock
   columns and movement history, variants/order links, payments/tenders,
   orders, settings, and any report data in scope. A ledger alone or schema
   alone is insufficient.
4. Backup format, PostgreSQL source version, backup creation time, integrity
   digest, encryption/handling approval, and compatibility review for the
   isolated PostgreSQL version. Do not include credentials or private paths
   in this report.
5. A newly provisioned disposable PostgreSQL instance/cluster bound to
   loopback on a non-default port, approved operator/role, unique test
   database names, and disposal authorization. Verify that the instance and
   names are not production, staging, Neon, Render, or any existing restaurant
   database. Do not reuse an existing `bigbites` or uncertain database.
6. A reviewed, target-specific, history-preserving migration/schema plan.
   The current migration set is not runnable through guarded paths. A backup
   restore alone does not approve a schema migration or import.
7. An approved secure connection-secret delivery method. Do not place a
   connection URL, password, token, or customer data in commands, scripts,
   shell history, logs, screenshots, or reports.

If any item is absent or contradictory, stop. Keep target identity, migration
status, and restore outcome marked **UNKNOWN**.

## Proposed procedure — not executed

Commands below are templates for a separately approved test operator. They
must be adapted to the confirmed PostgreSQL version, approved archive format,
and locally protected PostgreSQL service configuration. Use unique database
names in a dedicated disposable cluster. Do not use `--clean`, `--create`,
`--if-exists`, `dropdb`, or an existing database.

### 1. Verify the approved archive and test target (read-only checks)

Set a protected PostgreSQL service-file location. The service definitions
`bb-rehearsal-admin`, `bb-rehearsal-source`, and
`bb-rehearsal-target` must be preconfigured by the authorized DBA with the
approved loopback address, non-default port, and least-privilege roles.
Credential material stays out of this document and command line.

```powershell
$env:PGSERVICEFILE = '<protected service-file path>'
Get-FileHash -Algorithm SHA256 -LiteralPath '<approved archive path>'
pg_restore --list '<approved archive path>'
psql --dbname='service=bb-rehearsal-admin' -X -v ON_ERROR_STOP=1 -c "SELECT current_database(), inet_server_addr(), inet_server_port(), current_setting('server_version'), current_setting('transaction_read_only');"
```

These commands read the archive or query server metadata. They do not prove
that a restore will succeed. Confirm the returned database/address/port match
the approved disposable instance before proceeding; do not print credentials
or the service-file contents. If `pg_restore --list` rejects the file, the
archive format is not supported by that command; stop and have the DBA select
the correct restore utility. Do not guess or convert the archive.

### 2. Create a new disposable database (writes database metadata)

Use an isolated, newly provisioned cluster. First have the DBA confirm
out-of-band that the selected name does not exist and that the admin service
targets only that cluster. `createdb` must fail rather than reuse an existing
name.

```powershell
createdb --maintenance-db='service=bb-rehearsal-admin' bigbites_test_production_clone
```

This creates an empty database. It does not alter the source archive or any
other database. If the name already exists, the command fails; stop rather
than dropping or reusing it.

### 3. Restore the full approved backup to the isolated source clone (writes data)

For an approved custom-format archive:

```powershell
pg_restore --exit-on-error --no-owner --no-privileges --dbname='service=bb-rehearsal-source' '<approved archive path>'
```

The `bb-rehearsal-source` service must target only
`bigbites_test_production_clone` on the confirmed loopback non-default port.
This command writes the archive's schema and data into that new database.
It does not run Prisma migrations. Do not add cleanup/drop options. If the
archive is plain SQL or another format, stop and obtain an owner/DBA-approved
command for that format rather than substituting a guessed restore command.

Immediately after restore, run the metadata identity query from step 1 using
the source service. Then compare the restored schema, migration ledger, and
sanitized aggregates against the approved evidence. Stop on missing tables or
columns, a stock/movement mismatch, an unexpected ledger/checksum, role or
payment enum discrepancy, or unexplained count/financial differences.

### 4. Prepare an importer target (currently blocked)

The importer needs a separate empty `bigbites_test_*` target on the same
isolated non-default-port loopback test setup, with every required table and
column. The repository does not currently provide an approved command to
create that schema: applying the canonical migration tree is blocked by
`20261020100000_remove_product_stock`, and bypassing the guard or editing
migration history is prohibited.

Do **not** run `prisma migrate deploy`, `db push`, a seed, or the importer until
the owner/DBA and application maintainer approve a written target-specific
schema/history resolution and its exact provisioning steps. A schema-only
restore from a backup is not automatically approved; it requires separate
review of its source schema, migration ledger effects, and compatibility with
the canonical importer.

Once a schema-ready target has been separately approved and prepared, the
only importer invocation is:

```powershell
$env:NODE_ENV = 'test'
# SOURCE_DATABASE_URL and TARGET_DATABASE_URL are injected securely by the
# approved test runner; do not paste or echo their values in this shell.
node apps\server\scripts\migrate-production-data.cjs
```

Before that command can run, the injected source must resolve to
`bigbites_test_production_clone`; the target must resolve to a distinct
`bigbites_test_*` database. Both must be loopback on non-5432 ports. The
importer itself validates these restrictions and the destination database
identity, verifies the source transaction is read-only, checks target schema,
maps IDs/relationships, checks foreign keys and financial aggregates, updates
sequences, and commits the target transaction only after its validations
succeed. It rolls the target transaction back on failure. It is a data merge,
not a schema migration or full backup restore; it must not be pointed at
production, a real client database, or a non-test target.

Do not enable `REPLACE_DEFAULT_SETTINGS_FOR_TEST` unless the specifically
approved disposable fixture requires it. The importer test suite also mutates
its merge target to construct a fixture, so only run the database-backed tests
against dedicated disposable test databases prepared for those exact cases.

### 5. Post-restore and post-import checks (read-only queries)

Run checks separately against the source clone and approved target. Capture
only sanitized counts, totals, match/mismatch counts, schema metadata, and
neutral target labels. Do not select or print person-level rows, password
hashes, addresses, order details, or payment records.

Required comparisons:

- **Products/inventory:** row count; count of products with all four stock
  fields; aggregate stock by approved unit/classification; missing/extra
  product IDs or approved product keys.
- **Stock history:** movement row count and counts/quantity totals by movement
  type; product foreign-key orphan count; compare exact movement IDs and
  fields in a protected test process, reporting only mismatch counts.
- **Variants:** variant counts; per-product variant counts; counts of order
  items with/non-null `variantId`; orphan variant/product/order references.
- **Users/roles:** user counts grouped by role only; compare identifier and
  role match counts without selecting names, usernames, or password hashes.
- **Orders/bills:** counts by status; aggregate order totals, item subtotals,
  and order counts by approved date range. Preserve IDs and timestamps;
  report only difference counts and sums.
- **Payments:** counts and amount totals grouped by method/status, including
  `CASH_UPI`; compare `cashAmount`, `upiAmount`, `amountReceived`, and `change`
  aggregates where present. Do not print payment rows or references.
- **GST/settings/reports:** settings row count and field-equality results for
  GST enablement/rate, FSSAI/GSTIN flags, and report configuration; do not
  print compliance numbers or private report paths. Confirm whether report
  files outside PostgreSQL are in transfer scope.
- **IDs/relationships:** compare ID-preservation and foreign-key orphan
  counts for categories/products/variants, tables/users/orders/items/payments,
  and stock movements. Confirm sequences will generate IDs above existing
  maxima using an approved read-only check rather than consuming `nextval`.

The importer performs field comparisons for records it maps, checks relevant
foreign keys, and compares order/item/payment totals and payment method/status
aggregates. These source checks do not substitute for an independent
pre/post reconciliation, a real backup restore, or local POS workflow tests.

## Migration `20261020100000_remove_product_stock`

The migration drops `ProductStockMovement` and `Product.stock`,
`stockUnit`, `lowStockThreshold`, and `lastStockUpdatedAt`. Its target status
is unknown. The current canonical schema and importer require these resources,
and guarded startup/installer paths reject this migration set.

The smallest safe action now is **no migration-file or ledger change**:
preserve the migration history and obtain target-specific ledger, schema, and
restored-backup evidence. Then the owner/DBA and application maintainer must
approve a precise, history-preserving resolution for each target. If the
migration is pending, ordinary deploy would execute destructive SQL; if
already applied, recreating empty columns/table does not recover lost stock
or movement history. Do not delete/rewrite/rename the migration, mark it
applied or rolled back, or bypass guards. No generic forward migration can be
selected safely while the actual target state and recoverable data are
unknown.

### Resolution options (no option selected)

1. **Keep the migration history and files unchanged.** This preserves
   repository/ledger history but does not make the current full migration set
   safe to deploy: guarded startup and installer stop when the destructive
   migration is present, and an unguarded deploy would execute its SQL if it
   is pending. If it is already recorded as successful, the canonical schema
   still conflicts with the database unless compatible schema and the lost
   inventory data have been independently restored and verified. Do not
   modify ledger entries to manufacture either state.
2. **Approved forward corrective migration.** Consider only after
   target-specific ledger and schema evidence. If the destructive migration
   already ran, a forward change could restore schema shape only when stock
   quantities and movement history can be recovered from an approved source
   and reconciled. Empty replacement columns/table are not preservation. If
   the destructive migration is pending, merely adding a later migration
   cannot prevent deploy from running it first. Any history-preserving method
   to prevent that execution needs its own reviewed, approved strategy; do not
   edit historical SQL or falsify migration status.
3. **Restore a complete approved backup as an isolated clone without running
   migrations.** This can test backup restorability and preserve the schema,
   data, identifiers, and ledger contained in that snapshot, if it is
   complete, consistent, authorized, and verified to contain required
   inventory/history and compatible schema. It does not resolve a pending
   repository migration or provision a fresh canonical target. A snapshot
   that already lacks stock/history cannot recover it.
4. **Other evidence-supported process.** A logical export/import or schema
   baseline may be proposed only after reviewing its exact effects on enums,
   constraints, identifiers, sequences, records, and `_prisma_migrations`.
   The existing row importer is test-restricted and has the merge/remapping
   limits above; it is not a generic lossless merge. Documentation alone
   cannot select this approach.

Before selecting any option, the owner/DBA must provide the target-specific
ledger (names, checksums, completion/rollback state), actual schema catalog,
confirmation whether stock fields and movement data exist, and successful
restore evidence for the approved backup in a separate isolated database.
The owner, DBA, and application maintainer must then approve the exact
target-specific plan, expected schema/ledger effects, reconciliation,
stop conditions, and recovery path. Until then, no migration or import
sequence is safe to recommend or execute.

## Current outcome and next action

**No rehearsal was run and no client-readiness claim is supported.** The full
backup restore path is technically available through PostgreSQL custom-format
tools, but the repository has no evidence that any existing archive is the
approved source or has restored successfully. The row importer is isolated by
code-level endpoint checks, but its integration cases remain unverified and
its schema-ready target is blocked by the unresolved migration conflict.

**Next safe action:** the authorized owner/DBA provides the sanitized
target-specific ledger/schema report, approves the source snapshot, and
demonstrates or authorizes a restore rehearsal to a newly provisioned
loopback-only disposable PostgreSQL instance. The owner/DBA and maintainer
must then approve the exact schema/history resolution and test-target setup
before any migration or importer command is run.
