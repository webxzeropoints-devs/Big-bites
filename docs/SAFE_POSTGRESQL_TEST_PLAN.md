# BIG BITES POS Safe PostgreSQL Test Plan

**Prepared:** 2026-10-23
**Status:** PLAN ONLY — NOT APPROVED OR EXECUTED

This is a gated plan for a future isolated PostgreSQL verification. It does
not authorize database access, migration, import, or cleanup now. No database
was created or contacted while preparing this document.

## 1. Safety gate and owner approvals

Do not proceed to database commands until the data owner and test operator
record approval for all of the following:

- The exact isolated PostgreSQL server/cluster identity, administrator/owner,
  loopback-only bind/address, and a non-default port.
- A newly provisioned, unique test database name, e.g.
  `bigbites_release_test_<unique_suffix>`, with confirmation that it contains
  no restaurant/customer data and is not production, Neon, Render, staging,
  the existing `bigbites`, or `bigbites_neon_stage` database.
- A separate, explicitly authorized, consistent source snapshot. Its
  provenance and authorized fields must be documented without exposing
  credentials or personal data.
- A verified restorable backup for every pre-existing target that might be
  retained. Prefer a new empty target; do not overwrite any existing DB.
- A reviewed, forward-only migration strategy that resolves the destructive
  migration conflict without rewriting history or guessing target state.
- Test operator identity, permitted source/target databases, connection
  lifetime, network restrictions, and explicit disposal approval.

Approval is per environment and target; a test on one isolated database does
not prove any other target safe.

## 2. Current repository blocker — no migration sequence is approved

The canonical migration directories, in chronological order, are:

1. `20260914084442_initial_hotel_pos`
2. `20260922200000_remove_kitchen_role`
3. `20260922210000_add_parcel_table`
4. `20260928233000_ready_for_billing`
5. `20260928234000_pending_order_payments`
6. `20260929210000_add_gst_settings`
7. `20260929220000_add_restaurant_address`
8. `20261003120000_add_fssai_gstin_settings`
9. `20261003123000_add_order_discounts`
10. `20261003130000_remove_manager_role`
11. `20261006150000_payment_tender_details`
12. `20261006220000_add_gst_toggle_and_order_reports`
13. `20261009230000_menu_variants_classification`
14. `20261013010000_cash_upi_split_payment`
15. `20261013213000_add_product_stock_movements`
16. `20261020100000_remove_product_stock`

The last migration executes:

```sql
DROP TABLE IF EXISTS "ProductStockMovement";

ALTER TABLE "Product"
  DROP COLUMN IF EXISTS "stock",
  DROP COLUMN IF EXISTS "stockUnit",
  DROP COLUMN IF EXISTS "lowStockThreshold",
  DROP COLUMN IF EXISTS "lastStockUpdatedAt";
```

That conflicts with the canonical schema and required functionality. Both
migration trees include this migration; its status on every target is
**UNKNOWN**. Existing startup/installer guards reject the current set.
Therefore, this plan does **not** prescribe `prisma migrate deploy`, a
hand-selected migration subset, migration resolution, or a schema push.
Before a test database can be migrated, the data owner must review a
target-specific ledger/schema/backup report and approve a forward-only
strategy. Do not change historical migration files or checksums.

The actual SQL for all 16 directories must be reviewed against the approved
schema and target ledger before any application. A filename list or static
guard is not proof of schema/data compatibility.

No forward-only correction has been selected. If the destructive migration
is pending, ordinary `migrate deploy` would execute it; a later additive
migration cannot prevent that or independently reconstruct deleted values.
If already applied, compatible schema restoration alone cannot restore prior
stock values or movement history. The owner/DBA must first provide
target-specific ledger, actual-schema, sanitized inventory/history aggregate,
and verified-restore evidence and approve a separate resolution proposal.
Do not edit or resolve migration history as a shortcut.

## 3. Provisioning and target verification — future approved phase

After written approval only:

1. An authorized DBA provisions a new, disposable PostgreSQL **instance or
   isolated cluster**, bound to loopback and a non-default port. Do not select
   an existing service merely because a port appears unused.
2. The DBA creates a unique, empty test database and a least-privilege
   test-only role. No application or test role receives access to production,
   Render, Neon, staging, or the restaurant database.
3. Credentials are passed through a protected process environment or secret
   manager, never command-line arguments, source files, logs, screenshots, or
   reports. Do not print the connection URL.
4. Before connecting, the operator compares the approved host, port, database
   name, and role with the locally held target definition. The test harness
   must reject non-loopback hosts, default port 5432, unexpected database
   names, and any URL not explicitly approved.
5. Once connection is separately authorized, the harness queries only
   non-sensitive identity metadata (`current_database()`, server address,
   port, role, server version, and read-only status), prints sanitized
   identity fields, and aborts unless they exactly match the approved target.
   It also confirms the destination is empty before schema setup.
6. Restrict network access to loopback and the dedicated test process. Stop
   other application processes from inheriting or reading the test
   credentials.

No target is verified merely by a URL string, database name, or unused port.

## 4. Source snapshot and baseline

1. Obtain owner approval for the exact snapshot, extraction method, included
   tables/columns, and handling of authentication data. Never extract from a
   remote source during this plan.
2. Verify snapshot provenance and integrity out of band, using a recorded
   cryptographic digest and a source-side consistent snapshot method approved
   by the data owner.
3. Restore only into a new isolated disposable instance. Do not overwrite or
   connect the importer to any existing restaurant database.
4. Keep the source fixture immutable/read-only during tests. Use separate,
   uniquely named merge and conflict targets for importer cases.
5. Record a sanitized baseline: per-table counts, orphan-FK counts, product
   stock values (or approved aggregates), stock movement counts, variant and
   order-item links, payment totals by method, and financial aggregates.
   No customer/person-level rows or credentials go in reports.
6. If no authorized consistent snapshot exists, mark importer completeness
   blocked. Synthetic data may test code paths but cannot establish production
   data preservation.

## 5. Migration and schema verification — gated

No migration command is allowed until the migration-sequence blocker in
Section 2 is resolved in writing.

After the owner approves a versioned, forward-only plan:

1. Preserve a verified backup of the disposable target and prove it restores
   into another isolated target.
2. Record the exact source revision, schema digest, migration directory list,
   each migration SQL digest, Prisma version, and intended end schema.
3. Apply only the owner-approved migration plan to the approved disposable
   target, with the expected database identity rechecked by the operator and
   a fail-closed process wrapper. Do not execute it against another URL.
4. Capture the resulting migration ledger, including names, checksums,
   success/failure state, and finish timestamps. Compare against repository
   migration source without editing ledger rows.
5. Compare the resulting actual schema to the approved Prisma schema for
   Product stock fields, `ProductStockMovement`, ProductVariant,
   OrderItem.variantId, Payment tender fields/enum, GST/report settings,
   category ordering, indexes, and foreign keys.
6. Any mismatch, failed migration, unexpected ledger row/checksum, missing
   inventory column/table, or unexplained data movement stops the run.
   Restore only to another disposable target for investigation; do not
   “repair” history by marking migrations applied or reverted.

Because the destructive migration is present and applied status is unknown,
this phase is currently **BLOCKED**. No safe migration command or sequence is
provided here.

## 6. Importer integration tests — current harness constraints

The current importer integration tests are in
`apps/server/tests/production-data-migration.test.cjs`. They require
`NODE_ENV=test` and three environment URLs:

- `BIGBITES_MIGRATION_TEST_SOURCE_URL` — currently must be loopback, use a
  non-default port, and name exactly `bigbites_test_production_clone`.
- `BIGBITES_MIGRATION_TEST_MERGE_TARGET_URL` — loopback, non-default port,
  database name matching `bigbites_test_*`.
- `BIGBITES_MIGRATION_TEST_CONFLICT_TARGET_URL` — loopback, non-default port,
  database name matching `bigbites_test_*`.

The source fixture name and target naming restrictions must be reconciled
with the owner-approved disposable instance before tests are configured.
Do not set these variables to any existing or ambiguous database. Do not put
secrets in shell history or logs. The test harness itself is not proof of
disposability; the owner must verify each target.

The current suite has two DB-backed cases:

1. Repeatable full-data merge, preserving destination inventory/history and
   verifying source-only rows and movement handling.
2. Conflicting settings/order IDs reject the import and leave no partial
   inserted rows.

They remain skipped until all three authorized targets pass independent
identity verification. Do not count skipped cases as passed.

## 7. Database-backed workflow scenarios

Run each only after Sections 1–5 pass, with isolated deterministic fixtures
and transaction-scoped cleanup:

### Inventory and orders

- Seed test-only Product rows and movements; record initial stock.
- Create table and parcel orders; verify stock deduction and before/after
  movement values.
- Attempt an order above available stock; verify rejection and no writes.
- Force a later item/order write to fail; verify order, items, payment,
  movements, and stock all roll back.
- Add items; verify price, variant ID, stock, and payment/order totals.
- Cancel an unpaid authorized order; verify exactly-once restoration and
  retained order/item history.
- Attempt cancellation by a non-owner waiter, after payment, and after prior
  cancellation; verify no second restoration.
- Run concurrent transactions whose total requested quantity exceeds stock.
  Verify PostgreSQL row locks/conditional updates prevent oversell and
  movement records exactly match committed stock changes.
- Exercise variant pricing and product-level stock behavior according to the
  current canonical source; do not invent variant-specific stock semantics.

### Payments and reports

- Cash, UPI, and card payment cases where supported.
- CASH + UPI split whose amounts equal the invoice total; reject mismatches.
- Exercise payment failure/rollback and verify no partially paid order.
- Verify stored payment method, paid amount, cash/UPI components, change,
  status, and timestamps.
- Compare report totals to persisted paid orders and payment records.

### Referential integrity and history

- Verify category/product, product/variant, order/order-item, variant/order
  item, order/table, order/waiter, and order/payment relations.
- Verify unique constraints and foreign keys.
- Compare source/destination counts and financial/stock aggregates, recording
  only sanitized summaries.
- Do not assume or test automatic migration rollback unless the approved
  migration plan explicitly defines and proves it.

Existing HTTP route tests use mocked Prisma clients; they are not replacements
for these real concurrent transaction, locking, and rollback tests.

## 8. Cleanup and disposal

1. Export sanitized test results and digests before disposal.
2. Confirm all test processes have exited and test credentials are revoked.
3. The owner explicitly approves disposal of the disposable instance.
4. The authorized DBA disposes of only the exact approved test instance and
   confirms its identity immediately beforehand.
5. Do not run broad cleanup, wildcard deletion, or destructive commands
   against any uncertain target. Retain or destroy test backups only under
   the same explicit approval.

## 9. Current outcome

- No database was provisioned or contacted.
- No migration, import, reset, SQL write, or deployment was run.
- The two importer integration tests remain **SKIPPED/BLOCKED**.
- The focused source-only Node run reported 20 tests: 18 passed, 0 failed,
  and 2 skipped. The skipped cases above require the three separately
  authorized test database endpoints. The passing order route tests use
  mocks and do not establish PostgreSQL locking, concurrency, or rollback.
- PostgreSQL transaction, isolation, stock-locking, concurrency, and rollback
  behavior remain **NOT VERIFIED**.
- The destructive migration’s target status remains **UNKNOWN**.
- Standalone schema/routes remain incompatible with canonical inventory,
  variants, and split-payment behavior.
- The next action is owner review of sanitized per-target ledger/schema and
  verified backup evidence, plus explicit authorization of a new disposable
  instance. Only then can a safe forward-only test schema/migration strategy
  be reviewed. Do not execute the plan automatically.
