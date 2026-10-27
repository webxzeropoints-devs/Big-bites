# BIG BITES POS Database Evidence Collection

**Prepared:** 2026-10-23
**Status:** Read-only evidence procedure; not authorization to connect to or
change any database.

## Purpose and safety boundary

This procedure is for the authorized data owner or DBA to collect the minimum
sanitized evidence needed to compare each intended database's Prisma migration
ledger with its actual schema and the repository migration SQL.

The migration status of every target remains **UNKNOWN** until target-specific
evidence is collected and reviewed. Do not assume that
`20261020100000_remove_product_stock` has or has not run.

This document does not authorize any database connection, SQL execution,
backup/restore, test database provisioning, migration, import, deployment,
or production change. Do not send credentials, connection strings, URLs,
passwords, tokens, customer data, or application records in the evidence
report.

## Scope selected for the current request

The user selected the Render-connected production database as the proposed
authoritative source, a newly created isolated local PostgreSQL database as
the eventual destination, and evidence collection as the first step. Neon is
not selected for this transfer and must not be accessed or changed. Have the
authorized DBA confirm the exact source target identity out of band; the
public Render service URL alone does not identify or prove the state of its
backing database.

This first step is limited to separately authorized, read-only per-target
ledger/schema evidence and backup-restore evidence collected by the owner's
DBA. It does not provision the local destination or authorize data export,
import, migration, or deployment. Those actions require review of this
evidence and their own explicit approvals.

## Collection rules

1. Collect a separate report for **each** intended database/environment.
   Do not combine local, staging, production, or other target results into one
   inferred state.
2. The authorized DBA should use an already approved, read-only connection
   method and role. Do not put credentials in this report, command history,
   screenshots, SQL output, or chat.
3. Run only the read-only catalog/ledger queries below, if separately
   authorized by the data owner. Do not run DDL, DML, Prisma commands,
   migrations, imports, seeds, or reset/push commands.
4. If the migration ledger or any required table cannot be read, report it as
   unavailable; do not infer a result from application code, a migration
   directory, logs alone, or a different environment.
5. Return only the requested schema metadata, ledger fields, sanitized
   comparison results, and backup-verification facts. Do not return actual
   product, customer, order, order-item, or payment rows or values.

## Per-target evidence form

Copy and complete this section independently for each intended database.
Use a neutral target label such as `local-install-A`, `staging-A`, or
`production-A`. Do not include a host, URL, username, password, account
identifier, or secret in the label.

```text
Target label:
Environment category (local / staging / production / other):
Evidence collected by (name or approved operator identifier):
Collection date and time with timezone:
Owner authorization reference (ticket/reference only; no secrets):
Read-only access confirmed by owner/DBA: YES / NO / UNKNOWN
Database identity confirmation performed by DBA: YES / NO / UNKNOWN
Identity details included in this report: NO
Prisma migration ledger readable: YES / NO
Actual schema metadata collected: YES / NO
20261020100000_remove_product_stock ledger state:
  - row absent / successful / failed or incomplete / rolled back / unknown
  - evidence source:
Stock columns present and types:
ProductStockMovement table and columns present:
ProductVariant table and OrderItem.variantId present:
Payment fields and PaymentMethod values:
GST/report setting fields:
Repository-vs-ledger/schema mismatches:
Backup restore verification reference:
  - separate isolated destination used: YES / NO
  - restore completed and validation passed: YES / NO
  - validation date and operator:
  - reference to approved evidence (no backup contents/credentials):
Unresolved items:
```

For statuses, distinguish `UNKNOWN` from `NO`: `UNKNOWN` means evidence was
not obtained or could not be interpreted; `NO` means the requested
read-only evidence directly confirmed absence or failure.

## Migration ledger evidence

The DBA should provide the relevant rows from that target's
`public."_prisma_migrations"` table, if present, with only:

- `migration_name`
- `checksum`
- `started_at`
- `finished_at`
- `rolled_back_at`

Do not provide `logs` or other free-text/error fields; they may contain
environment or sensitive details. Do not edit, insert, delete, or resolve
ledger rows.

The following query is a read-only example for an authorized DBA. It does not
connect to a database by itself and must not be run by this source-only task:

```sql
SELECT
  migration_name,
  checksum,
  started_at,
  finished_at,
  rolled_back_at
FROM public."_prisma_migrations"
ORDER BY started_at, migration_name;
```

Report the state of
`20261020100000_remove_product_stock` exactly as the ledger indicates:

- **Absent:** no row exists in the queried ledger. This alone does not prove
  the SQL never ran; compare with actual schema and any authorized execution
  evidence.
- **Successful:** row exists, `finished_at` is populated, and
  `rolled_back_at` is null.
- **Failed/incomplete:** row exists without a successful completion timestamp
  and is not recorded as rolled back.
- **Rolled back:** row exists with `rolled_back_at` populated.
- **Unknown:** table/query unavailable or the row cannot be reliably
  interpreted.

Do not translate a failed, absent, or rolled-back row into approval to rerun,
mark applied, or mark rolled back. Escalate any inconsistency for review.

## Actual schema evidence

For each target, the DBA should report whether the following tables exist in
the expected `public` schema:

- `Product`
- `ProductStockMovement`
- `ProductVariant`
- `OrderItem`
- `Payment`
- `RestaurantSettings`
- `Order`

The following read-only catalog query returns table presence without reading
application records:

```sql
SELECT
  requested.table_name,
  to_regclass(format('%I.%I', 'public', requested.table_name)) IS NOT NULL
    AS table_present
FROM (
  VALUES
    ('Product'),
    ('ProductStockMovement'),
    ('ProductVariant'),
    ('OrderItem'),
    ('Payment'),
    ('RestaurantSettings'),
    ('Order')
) AS requested(table_name)
ORDER BY requested.table_name;
```

Then report column names, PostgreSQL data types, nullability, and default
metadata for those tables. This query returns schema metadata only:

```sql
SELECT
  table_name,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'Product',
    'ProductStockMovement',
    'ProductVariant',
    'OrderItem',
    'Payment',
    'RestaurantSettings',
    'Order'
  )
ORDER BY table_name, ordinal_position;
```

At minimum, explicitly record these checks, including exact observed types:

| Table | Required fields to report |
| --- | --- |
| `Product` | `stock`, `stockUnit`, `lowStockThreshold`, `lastStockUpdatedAt` |
| `ProductStockMovement` | table presence; `id`, `productId`, `movementType`, `quantity`, `previousStock`, `newStock`, `reason`, `createdAt` |
| `ProductVariant` | table presence; `id`, `name`, `price`, `isActive`, `productId` |
| `OrderItem` | `id`, `orderId`, `productId`, `quantity`, `unitPrice`, `subtotal`, `variantId` |
| `Payment` | `amount`, `amountReceived`, `change`, `cashAmount`, `upiAmount`, `method`, `status`, `orderId` |
| `RestaurantSettings` | `gstEnabled`, `orderReportsPath`, `gstRate`, `restaurantAddress`, `fssaiEnabled`, `fssaiNumber`, `gstinEnabled`, `gstinNumber` |
| `Order` | `gstEnabled`, `status`, `total`, `tableId`, `waiterId` |

Also report the actual values of the PostgreSQL enum type used by
`Payment.method` (expected repository type name: `PaymentMethod`) without
reading payment records. A read-only catalog example is:

```sql
SELECT
  type.typname AS enum_name,
  enum.enumlabel AS enum_value,
  enum.enumsortorder
FROM pg_type AS type
JOIN pg_enum AS enum ON enum.enumtypid = type.oid
WHERE type.typname = 'PaymentMethod'
ORDER BY enum.enumsortorder;
```

If actual constraint/index evidence is available, report only metadata for
the foreign keys and unique/index relationships connecting Product to
ProductStockMovement and ProductVariant, and ProductVariant to
OrderItem.variantId. Do not query the rows those constraints reference.

## Backup and restore evidence

For each target whose data may need preservation, provide a reference to
owner-approved evidence that a backup was restored successfully into a
**separate isolated database or instance**. Report only:

- backup identifier or approved evidence/ticket reference (not a file path
  that exposes private storage or credentials);
- backup creation time and source target label;
- restore completion time and operator;
- isolated destination label, distinct from the source and all live targets;
- validation outcome and the approved validation procedure/reference; and
- whether the restore was read-only or otherwise prevented from altering the
  source.

Do not attach backup contents or records. A backup file's existence, a
successful backup command, or an unverified claim is not proof of
restorability. If a separate isolated restore has not been completed and
validated, state **NOT VERIFIED**.

## Repository comparison and discrepancy report

Compare each target report independently against the reviewed canonical
schema and migration resources. The current repository has 16 canonical
migration directories and 12 in the standalone bundle; standalone lacks:

- `20261006220000_add_gst_toggle_and_order_reports`
- `20261009230000_menu_variants_classification`
- `20261013010000_cash_upi_split_payment`
- `20261013213000_add_product_stock_movements`

Both trees contain `20261020100000_remove_product_stock`, whose SQL drops the
`ProductStockMovement` table and Product stock columns. This repository fact
does not establish application state on any database.

For each target, list:

1. Ledger migration names absent from the expected repository tree, repository
   migrations absent from the ledger, and any checksum mismatch. Compare
   checksums only where the migration name and available checksum are
   comparable; report missing checksum as unavailable.
2. Tables/columns/types/defaults/enum values that differ from the canonical
   schema or relevant migration SQL.
3. The exact status of the stock-removal migration based on ledger evidence,
   separately from whether stock columns and movement table currently exist.
4. Contradictions between the ledger and actual schema, with evidence source.
5. Any unavailability or ambiguity as **UNKNOWN**, not as presumed absence
   or success.

Do not infer whether a migration ran solely from current schema shape: manual
changes, partial failures, restores, and later changes can make schema and
ledger diverge. Do not infer actual schema from migration ledger entries.

## Approval gates — no database work is authorized here

The following are separate explicit approvals, not implied by collecting or
reviewing this evidence:

1. **Evidence access:** owner authorizes the named DBA to collect the
   read-only per-target ledger and catalog metadata and confirms the target
   label/identity out of band.
2. **Correction decision:** owner, DBA, and application maintainer review
   each target's evidence and approve a specific, history-preserving
   correction proposal. No correction can be selected while status,
   affected data, or restore evidence remains unknown.
3. **Test provisioning:** owner explicitly authorizes a newly created,
   disposable PostgreSQL instance/database, gives it a unique label, and
   approves its isolation, network boundary, operator, purpose, lifetime,
   and disposal plan. Do not reuse production, Neon, Render, staging, the
   restaurant database, `bigbites`, `bigbites_neon_stage`, or any target of
   uncertain ownership.
4. **Migration execution:** owner separately approves the exact migration
   files/checksums, target identity, expected schema/data effects, backup and
   tested restore path, operator, execution window, and stop/recovery
   conditions. Approval to collect evidence is not migration approval.
5. **Deployment:** any deployment requires its own target-specific approval
   after isolated integration evidence and release compatibility are reviewed.

Until the applicable approvals are recorded and evidence reviewed, perform
no test-database provisioning, migration, import, or deployment. Keep
migration status **UNKNOWN** wherever target-specific evidence has not been
verified. This document alone establishes neither database compatibility nor
release readiness.
