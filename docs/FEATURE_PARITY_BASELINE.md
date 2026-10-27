# BIG BITES POS Feature-Parity Baseline

**Baseline date:** 2026-10-23
**Evidence scope:** Current repository source, schema, migrations, route tests,
desktop frontend, waiter Flutter source, and packaging configuration. No
production application, database, Render, Neon, installer, or APK was queried
or run for this baseline.

**Source update (2026-10-24):** This dated baseline predates removal of product
inventory from the active application. Its stock endpoints, menu fields,
ordering limits, and UI references describe the earlier baseline, not current
runtime behavior. Current server/client Prisma schemas and active desktop,
waiter, and server code are stock-free. Historical migrations, migration
safety checks, and migration evidence remain for database-safety review.

## How to read these statuses

- **Verified in existing source** means the checked-in source contains the
  model, route, UI/API call, or test evidence described. It does **not** prove
  current production behavior or local runtime compatibility.
- **Requires production-owner confirmation** means the owner/operator must
  identify the live capability and its intended business rules, including any
  behavior or data not represented by this checkout.
- **Requires local runtime testing** means the complete behavior must be
  exercised against the reviewed local server and isolated PostgreSQL with
  synthetic data before delivery.

Unless explicitly noted, every row below is **Verified in existing source**,
**Requires production-owner confirmation**, and **Requires local runtime
testing**. Source evidence cannot certify production parity by itself.

## 1. Application and API inventory

The canonical Express server mounts products, tables, authentication, orders,
billing, and admin routes under `/api`. `optionalAuth` parses bearer tokens;
route middleware enforces the roles shown below.

| Capability and API surface | Source baseline | Production owner | Local runtime |
|---|---|---|---|
| Health: `GET /health` queries the configured database and reports API/database status. | Verified in existing source (`apps/server/src/server.ts`). | Confirm expected health and monitoring contract. | Requires Windows startup, recovery, and database-down tests. |
| Login: `POST /api/auth/login`; password verification and token issue. | Verified in existing source (`routes/auth.ts`, auth middleware). | Confirm existing users, roles, password compatibility, and session/token expectations. | Test all roles, invalid credentials, restart, and `AUTH_SECRET` cutover behavior. |
| Menu read: `GET /api/products/categories`, `GET /api/products`, `GET /api/products/:id`; category/product/variant/stock data exposed. | Verified in existing source (`routes/products.ts`). | Confirm active/inactive and menu visibility rules. | Test values and variants from the restored local schema. |
| Table read: `GET /api/tables`, `GET /api/tables/:id`; status and parcel metadata. | Verified in existing source (`routes/tables.ts`). | Confirm table numbering/status and parcel workflow. | Test table and parcel lifecycle. |
| Waiter order creation: `POST /api/orders`; roles WAITER/ADMIN. | Verified in existing source (`routes/orders.ts`) and mocked route tests. | Confirm order ownership, duplicate/retry, and billing handoff expectations. | Test with local PostgreSQL, stock, variants, and concurrent requests. |
| Active/table orders: `GET /api/orders/table/:tableId/active`, `GET /api/orders/table/:tableId`; roles WAITER/ADMIN. | Verified in existing source. | Confirm which open statuses and history users expect to see. | Test status transitions and refresh/reconnect behavior. |
| Add order items: `PATCH /api/orders/:id/add-items`; roles WAITER/ADMIN. | Verified in existing source and mocked tests for exact line totals/stock deduction. | Confirm production rules for additions after order creation. | Test transaction rollback and concurrent stock changes in PostgreSQL. |
| Send to cashier: `PATCH /api/orders/:id/send-to-cashier`; roles WAITER/ADMIN. | Verified in existing source. | Confirm handoff workflow and whether edits remain allowed. | Test billing queue visibility and status transitions. |
| Cancel order: `PATCH /api/orders/:id/cancel`; roles WAITER/ADMIN/CASHIER. | Verified in existing source and mocked tests for unpaid cancellation, retained history, and parcel release. | Confirm cancellation permissions, paid/refund exceptions, and audit expectations. | Test paid/unpaid, table/parcel release, stock restoration, and real transaction atomicity. |
| Order lists/details: `GET /api/orders`, `GET /api/orders/:id`; roles ADMIN/CASHIER. | Verified in existing source. | Confirm historical filtering and visibility rules. | Test full history and related records after restore. |
| Billing queue/completed: `GET /api/billing/orders`, `/api/billing/completed`; roles ADMIN/CASHIER. | Verified in existing source and billing tests. | Confirm cashier queue ordering/status conventions. | Test queue, completed history, receipt data, and database persistence. |
| Individual bill and discount: `GET /api/billing/orders/:id`, `PATCH /api/billing/orders/:id/discount`; roles ADMIN/CASHIER. | Verified in source; discount validation and financial behavior have mocked tests. | Confirm discount policies and historical bill behavior. | Test against local PostgreSQL and GST settings. |
| Single-order payment: `POST /api/billing/orders/:id/pay`; roles ADMIN/CASHIER. | Verified in source and tests for CASH, UPI, CARD, CASH_UPI, amount received/change, and retries. | Confirm tender and duplicate-payment business rules. | Test persisted payment/tenders and rollback/retry against local PostgreSQL. |
| Table bill/payment: `GET /api/billing/tables/:tableId`, `POST /api/billing/tables/:tableId/pay`; roles ADMIN/CASHIER. | Verified in source and mocked tests for combined bills, split tender, and table release. | Confirm multi-order settlement and rounding expectations. | Test multi-order totals, per-order payment rows, table state, and transactions. |
| Admin order reports: `GET /api/admin/order-reports`; report export endpoints `POST /api/admin/order-reports/export` and `/export/:month`; admin-only router. | Verified in source and focused mocked report tests. | Confirm report periods, historical totals, required workbook contents, and storage expectations. | Test export, local folder selection, file naming/no-overwrite, and financial reconciliation. |
| Admin settings: `GET/PATCH /api/admin/settings`; admin-only router. | Verified in source/schema for GST, address, FSSAI, GSTIN, and report settings. | Confirm actual production settings and legal invoice requirements. | Compare restored values and test their effect on bills/receipts/reports. |
| Admin dashboard: `GET /api/admin/dashboard`; admin-only router. | Verified in source; dashboard revenue/count logic has mocked coverage. | Confirm production KPIs and financial definitions. | Reconcile values with local orders/payments and owner-approved aggregates. |
| User administration: `GET/POST /api/admin/users`, `PATCH/DELETE /api/admin/users/:id`; admin-only router. | Verified in source and user tests for role, hash handling, and deletion safeguards. | Confirm account list, roles, password/reset process, and accounts to preserve. | Test least privilege, password hashes, last-admin/self-delete protections, and login. |
| Category administration: `GET/POST/PATCH /api/admin/categories`; admin-only router. | Verified in source. | Confirm names, order, and history-dependent behavior. | Test CRUD and product relationships. |
| Product administration: `GET/POST/PATCH/DELETE /api/admin/products` and `/api/admin/products/:id`; admin-only router. | Verified in source and tests for create/update, variant support, and historical-item deactivation. | Confirm catalog and deletion expectations. | Test CRUD, relationships, and preservation of historical order lines. |
| Stock adjustment/history: `PATCH /api/admin/products/:id/stock`, `GET /api/admin/products/:id/stock-movements`; admin-only router. | Verified in source/tests for stock ledger fields and movement history. | Confirm expected existing stock quantities and movement audit baseline. | Reconcile per-product quantity and all movement history; test adjustment/restock. |
| Table administration: `GET/POST/PATCH /api/admin/tables`; admin-only router. | Verified in source. | Confirm configured tables and parcel option. | Test table CRUD and state persistence. |
| Admin order/payment review: `GET /api/admin/orders`, `DELETE /api/admin/orders/:id`, `GET /api/admin/payments`; admin-only router (delete additionally ADMIN). | Verified in source and selected mocked tests. | Confirm deletion/retention policy and report/audit obligations. | Test records/foreign keys, payment history, sequence handling, and safeguards. |
| Optional production catalog sync: `POST /api/admin/catalog/sync`, gated by `BIGBITES_ENABLE_PRODUCTION_CATALOG_SYNC`; fetches Render menu API. | Verified in source. Windows startup sets sync disabled; endpoint returns conflict when disabled. | Confirm whether this cloud-dependent feature is currently used and whether client expects it. | Default local release must remain local-only; if preserving this feature is required, separately approve and test an equivalent local workflow without silent cloud dependency. |

No separate server-side print endpoint was found in the inspected route
inventory. Desktop source has a receipt preview and browser print action; actual
printer compatibility is a runtime acceptance item, not established by source.

## 2. Feature-parity checklist

For each line, source status is evidence of implementation only. Production
owner confirmation is required to establish that the item is part of current
restaurant operations and to record exact expected results. Local acceptance
requires controlled testing with synthetic/reconciled data.

| Feature/business behavior | Verified in existing source | Requires production-owner confirmation | Requires local runtime testing |
|---|---|---|---|
| Admin, cashier, waiter roles and role-gated routes | Yes: `UserRole`, auth middleware, route role checks. | Confirm actual accounts and any operational exceptions. | Login/authorize each role; verify forbidden actions remain forbidden. |
| User credentials and password hashes | Yes: password hash/verification utilities; user seed/admin routes. | Approve account and hash transfer scope; confirm forced reset policy. | Verify compatibility without logging or exposing credentials; test secret rotation/token invalidation. |
| Categories, products, prices, descriptions, classifications, availability | Yes: canonical schema, read/admin routes, desktop forms. | Confirm current catalog baseline and inactive-item policy. | Compare source/imported counts and values; create/edit/deactivate cases. |
| Product variants and variant prices | Yes: `ProductVariant`, `OrderItem.variantId`, desktop/waiter selectors. | Confirm all production variants and pricing behavior. | Verify menu selection, order line identity/price, history, and reports. |
| Inventory quantities, units, thresholds, last update | Yes: Product schema/admin UI/routes and waiter stock handling. | Confirm expected stock snapshots and meaning of stock quantities. | Per-product reconciliation before/after; unavailable/low-stock behavior. |
| Stock adjustments, restocks, movement audit history | Yes: `ProductStockMovement`, stock routes, tests. | Confirm historical movement completeness and retention policy. | Reconcile every movement and totals; test adjustment and order deduction/restoration. |
| Table and parcel orders | Yes: `RestaurantTable.isParcel`, order/table APIs and client views. | Confirm parcel/table workflows and identifiers in current use. | Create, modify, send, pay, cancel, and restart/reload scenarios. |
| Order items, variants, timestamps, status history | Yes: schema, routes, desktop/waiter source. | Confirm required retention/history and order status meanings. | Verify identifiers, links, timestamps, status transitions, and history after restore. |
| Order cancellation and stock restoration | Yes: route logic/tests cover guard conditions and mocked rollback. | Confirm authorized roles and payment/refund exceptions. | Real PostgreSQL transaction rollback, cancellation, table release, and no stock/history loss. |
| Billing and discounts | Yes: billing routes/UI, amount calculation utilities, mocked tests. | Confirm discount policy, rounding and invoice rules. | Reconcile each bill/tax/discount total using synthetic data and client-approved examples. |
| CASH, UPI, CARD, split CASH + UPI | Yes: payment enum/schema, routes, UI and tests. | Confirm permitted methods, split rules, and historical tender completeness. | Verify payment fields/enums, receipts, retries, totals, and historical rows. |
| GST and invoice identity fields | Yes: order/settings GST snapshots, settings routes, receipt fields. | Confirm rate, enablement, address, FSSAI/GSTIN requirements. | Compare imported settings and test GST on/off, rounding, invoice text, and historical invoices. |
| Dashboard, payment/order history, reports | Yes: admin endpoints, desktop screens, report utilities/export tests. | Confirm required KPIs, report date ranges, and historic totals. | Reconcile counts/totals and test monthly workbook generation/save/restore. |
| Receipts and printing | Yes: receipt component includes tax/tender details and `window.print`; CSS has print layout. | Confirm printer model, paper width, receipt layout, and legal content. | Test actual Windows printers, page sizing, duplicates/reprint, and offline behavior. |
| Desktop billing/admin and error/retry behavior | Yes: React/Tauri screens and backend health retry UI. | Confirm current operator workflows and release configuration. | Complete end-to-end acceptance against local API and database. |
| Waiter discovery and ordering | Yes: UDP broadcast 3001, private IPv4 response, HTTP 3000 health, login, menu, table/parcel, create/add/send/cancel order API calls. | Confirm phone/tablet models, Wi-Fi topology, and expected reconnect behavior. | Test discovery without manual IP, router/client isolation, retries, network loss, duplicate submissions, and concurrency. |
| Local-only operation after cutover | Partly: installed server sets local mode and disables production catalog sync; desktop defaults loopback; waiter has local discovery and no inspected Render fallback. | Confirm whether any cloud sync, external service, account, or operational workflow is currently used. | Disconnect internet and test every desktop/waiter feature; identify package/runtime/update dependencies. |
| Backup, restore, upgrade, uninstall and recovery | Source includes local backup-before-pending-migration, but archive listing is not a restore test; stop/uninstall scripts preserve database data. | Approve backup schedule, retention, ownership, and recovery objectives. | Rehearse restore and lifecycle on disposable VM; verify `.env`, logs, backups, PostgreSQL and POS records survive. |
| Concurrent ordering and stock integrity | Source uses transaction/locking logic and mocked invocation tests. | Confirm peak concurrency and acceptable failure behavior. | Real PostgreSQL contention, oversell prevention, rollback, duplicate requests, and deadlock/retry behavior. |

## 3. Schema and migration baseline

Canonical schema is `apps/server/prisma/schema.prisma`. It contains:

- Enums: `UserRole`, `TableStatus`, `OrderStatus`, `PaymentMethod`,
  `PaymentStatus`, `DiscountType`, and `ProductClassification`.
- Models: `User`, `RestaurantTable`, `Category`, `Product`,
  `ProductStockMovement`, `ProductVariant`, `Order`, `RestaurantSettings`,
  `OrderItem`, and `Payment`.
- `PaymentMethod` includes CASH, UPI, CARD, and CASH_UPI. Product inventory
  includes stock/unit/threshold/last-update; order items can reference a
  variant; reports/settings/GST fields are represented in the schema.

The canonical migration directory currently contains:

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

The last migration drops the four Product stock columns and the movement table.
Its production ledger state is **UNKNOWN**. Do not deploy, resolve, edit,
delete, or reorder migration history to make a transfer succeed. Canonical
startup guard and installer preflight reject it before normal guarded
deployment paths; direct Prisma CLI calls can bypass those guards. The guards
do not prove actual database schema or state.

There are also role-history compatibility questions requiring owner/DBA
confirmation: `20260922200000_remove_kitchen_role` converts KITCHEN users to
WAITER, and `20261003130000_remove_manager_role` deletes MANAGER users after
checking for order references. The current schema and application roles are
ADMIN, CASHIER, and WAITER only. Confirm whether these historical migrations
were applied, whether former roles/accounts or kitchen workflows are still
required, and whether their data/behavior has been retained by an approved
process. Static migration content is not evidence of a target's actual role
history.

The current `Payment` schema has no explicit external transaction-reference
field. Confirm with the owner whether any payment references or reconciliation
data exist outside these declared fields before deciding a transfer is
complete; do not assume no such data exists solely from this schema.

The separate `BIG-BITES-SERVER-CLIENT` tree has different schema/runtime and
incomplete migration history; it is not a parity substitute. The configured
Tauri resources point to canonical `apps/server`.

## 4. Data preservation and reconciliation gates

Before any cutover, the authorized data owner/DBA must confirm per target:

1. **Identity and authority:** neutral source/target labels, provider/database
   identity confirmation out of band, service association, owner approval of
   authoritative source, and whether Render and Neon represent distinct or
   related stores.
2. **Migration ledger:** complete names, checksums, start/finish/rollback
   timestamps and status from `_prisma_migrations`; explicitly identify the
   stock-removal migration. Compare ledger and actual catalog independently.
3. **Actual schema:** tables/columns/types/defaults/nullability, enum values,
   constraints/indexes, FKs, PostgreSQL version, extensions, collation and
   sequences for stock/movements, variants/order links, users/roles, orders,
   payments/tenders, GST/settings/reports.
4. **Backup recovery:** immutable approved backup reference, source label and
   time, successful restore to a separate isolated target, validation
   procedure/outcome, operator and date. A backup file or `pg_restore --list`
   does not prove restorability.
5. **Transfer scope:** explicit approval for accounts/password hashes,
   catalog, inventory/movements, tables, all order/payment history, settings,
   report artifacts, payment transaction references if present outside the
   declared schema, legacy role/account handling, and retention. Never copy
   clear-text passwords; do not expose customer/payment records in test output.

After approvals, perform source-vs-target reconciliation in an isolated
environment: per-table row counts, primary-key mapping, foreign-key checks,
stock quantity per product, movement counts/quantities/before-after values,
variant associations, order/item/payment counts and totals, tender totals by
method/status, GST/settings, and sequence positions. Retain only sanitized
aggregate evidence. Investigate every difference; never silently overwrite
local-only history or fabricate movements.

The existing `apps/server/scripts/migrate-production-data.cjs` is restricted
to loopback test databases and is not a production importer. It expects an
already migration-ready target schema. Its database-backed integration tests
are skipped without separately configured disposable databases. Do not relax
its endpoint restrictions or point it at production for this plan.

## 5. Local release acceptance gates

All tests below require synthetic or explicitly approved isolated restored
data; no live production data should be used for local acceptance.

- [ ] Owner signs off on production baseline and the feature checklist above.
- [ ] Owner/DBA supplies target-specific migration and schema evidence and
      approves a history-preserving migration/import strategy.
- [ ] Backup restore succeeds to a distinct isolated PostgreSQL target.
- [ ] Schema, migrations, Prisma Client, compiled server, and packaged
      resources match one reviewed pinned canonical revision.
- [ ] Reconciled users/roles, catalog, stock/movement history, variants,
      orders/items/payments, GST/settings and reports pass agreed totals.
- [ ] Windows VM verifies install, startup/reboot, health, LAN/firewall,
      upgrade/rollback, backup/restore and uninstall preservation.
- [ ] Android device verifies discovery/login/order workflows over the actual
      private restaurant LAN without manual IP or remote fallback.
- [ ] Desktop verifies billing, cancellation, split tender, receipts/printing,
      administration, report export and recovery.
- [ ] Real PostgreSQL integration verifies concurrency, transaction rollback,
      stock integrity, payments, retries and audit history.
- [ ] Internet-disconnected acceptance identifies any remaining external
      dependencies; all client-approved differences are documented.
- [ ] Client accepts the local system and the owner separately authorizes
      cutover. Keep Render/Neon operational until then.

## 6. Current result and next action

**No-go for client handover.** This source baseline does not establish what
features are currently working in the live Render/Neon application, whether
the documented production target is correct, whether production schema/ledger
matches the repository, or whether a local runtime preserves those features.
The destructive stock-removal migration is a known blocker until target
evidence and an approved resolution exist.

**Next action:** the client owner and authorized DBA should confirm the actual
production target and provide the sanitized per-target ledger/schema and
verified backup-restore evidence described in
[CLIENT_DATABASE_SAFETY_EVIDENCE_REPORT.md](./CLIENT_DATABASE_SAFETY_EVIDENCE_REPORT.md).
They should then confirm which baseline features are in active use and approve
the exact isolated rehearsal scope. Do not perform transfer, migration,
installer integration, or cutover before those approvals.
