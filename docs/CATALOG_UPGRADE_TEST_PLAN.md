# BIG BITES POS catalog upgrade: isolated release test plan

## Current status

The catalog/schema path has been exercised against disposable PostgreSQL
clusters, including a legacy-schema upgrade and a real Render GET-only catalog
sync. Those tests imported 129 active products, 15 categories, and 32 variants;
repeat sync did not duplicate records. A variant priced differently from its
base product was ordered at its variant price. Product stock tracking has since
been removed; order creation and item additions must not impose stock limits.

The packaged NSIS installer has not been installed. The running restaurant POS
was not changed and still reports an empty local menu. No Android device was
available for a physical waiter-to-desktop test. Do not describe the release as
client-ready until the steps below pass.

## Isolation requirements

1. Use a dedicated Windows 10/11 x64 VM or test PC, never the restaurant POS.
   Create a hypervisor snapshot before setup and after preparing each test
   state.
2. Keep PostgreSQL bound to loopback and use only the VM's disposable
   `127.0.0.1:5432/bigbites` database. Do not restore a restaurant backup,
   reuse restaurant credentials, or expose the VM's PostgreSQL port to another
   machine.
3. Block access from the VM to the restaurant LAN, the live POS host, and
   other private networks. Permit only the internet access required to install
   dependencies and issue read-only HTTPS GET requests to the production menu
   API.
4. Use synthetic users, orders, payments, settings, and legacy catalog rows.
   Verify the test database name and host before every migration, import, or
   order test. Never use production credentials or a production `DATABASE_URL`.
5. Keep an external VM snapshot or verified `pg_dump` backup before testing an
   existing-schema upgrade. The installer also creates a custom-format backup
   under `%ProgramData%\BIG BITES POS\backups` before applying reviewed pending
   migrations; verify that archive with `pg_restore --list`.

## Test sequence

### A. Verify the release payload

Record the installer and APK SHA-256 values and confirm they match the approved
build artifacts. Verify the server resource contains the built `dist` output,
the current Prisma schema and migrations, and the installer script. Use the
standard waiter APK without `API_BASE_URL`; an explicit API override bypasses
automatic discovery and invalidates the discovery test.

### B. Fresh install and current schema

1. Restore the clean VM snapshot. Install the NSIS package using its normal
   setup flow; allow it to create only the VM-local PostgreSQL database.
2. Confirm the local health endpoint reports a connected database and inspect
   the schema read-only. Confirm `Category.sortOrder`, the production catalog
   product fields, `ProductVariant`, and `OrderItem.variantId` exist.
3. Confirm the installed server bundle's compiled catalog-sync route includes
   the local-target guard and schema preflight. Do not run a seed command.
4. Create or initialize a disposable administrator account without relying on
   sample menu data. Confirm an unauthenticated catalog-sync request returns
   HTTP 401.

### C. Legacy-schema upgrade

1. Restore a separate VM snapshot containing a synthetic legacy database at
   the schema level used by the previous install: five categories and fixture
   rows for one user, table, product, completed order, order item, payment, and
   restaurant settings.
2. Record counts and selected values for those rows. Take and verify a manual
   backup before approving an upgrade.
3. Run the new server upgrade only after reviewing the listed pending
   migrations. The NSIS hook invokes setup non-interactively and does not pass
   the existing-database migration-approval switch. For a legacy database, do
   not treat that NSIS attempt as an upgrade: use an elevated interactive
   PowerShell session to invoke the packaged `Install-BigBites.ps1` with
   The installer must stop when pending migrations are detected. For this
   disposable VM, use a separately approved maintenance procedure only after
   reviewing all migration SQL and validating a backup by restoring it into
   an isolated test database.
   Confirm the installer creates and validates its additional backup before
   `migrate deploy`.
4. Verify each pre-upgrade user, order, order item, payment, settings row, and
   local category still exists with unchanged values. Confirm legacy products
   receive their generated migration slug and the stock columns/table are
   removed by the new migration.
5. Stop if the backup cannot be listed, if any migration is not understood, or
   if a record count/value changes unexpectedly. Restore the VM snapshot; do
   not retry on the restaurant POS.

### D. Catalog sync and actual product/order API

1. From the packaged desktop app, sign in as the test administrator and run
   **Sync production menu**. Confirm the server used production GET requests
   only and reports 129 products, 15 categories, and 32 variants.
2. Query the VM-local `/api/products` and `/api/products/categories` endpoints.
   Verify all active names, prices, categories, and variant names/prices.
   Confirm product responses contain no stock fields and category IDs map to
   local category rows by category name, not by production ID.
3. Repeat sync. Confirm product/category/variant counts remain stable; a
   local-only product/category remains; and production catalog fields and
   variant prices refresh.
4. Select a production product with a variant whose price differs from the
   base price. Add quantities greater than the product's former stock count
   (for example 100), then verify the persisted order line records the selected
   `variantId`, exact variant `unitPrice`, and subtotal. Confirm stock does not
   prevent order creation or item additions and the order and bill show the
   selected variant.
5. Recheck the pre-existing synthetic order/payment/user/settings records.
   Confirm production endpoints were not sent POST, PATCH, DELETE, or database
   writes.

### E. Desktop and waiter LAN acceptance

1. Open the packaged Windows desktop app and verify all 15 production
   categories and 129 active products appear with correct prices and variant
   selectors. Confirm loading, empty, and error states are understandable.
2. Connect an Android device to the VM's isolated test LAN and install the
   release APK. Verify it discovers the VM automatically over UDP 3001, uses
   HTTP 3000, and never asks the operator to type an IP address.
3. Complete the waiter flow: select table, select category, choose a
   differently-priced variant, and confirm the order. Verify the order appears
   in the desktop app with the same category and variant price, with no stock
   deduction or availability limit.
4. Repeat with an occupied table and verify **Add More Food** updates the
   existing order. Check billing/tax/payment records remain local and correct.
5. Record screenshots or other review evidence from both UIs and record the
   Android model, OS version, LAN topology, and discovery result. If no physical
   device is available, mark this step unverified.

### F. Restore and release decision

After capturing logs and counts, restore or discard the disposable VM. Keep the
approved installer and APK hashes with the test record. Any failed migration,
backup, data-preservation, price, unlimited-ordering, UI, or LAN check blocks client
delivery. Do not run the installer, migration approval, or catalog sync against
the restaurant installation until the isolated package test passes and the
operator separately approves the production-local backup/upgrade/sync steps.

## Verification already completed

- Current server TypeScript build and financial/API suite: 45 passed, 0 failed,
  2 skipped. The two database-backed importer integration tests were skipped
  because the isolated test database URLs were not configured for this run.
- Current desktop frontend production build passed to an external temporary
  output directory; the existing NSIS installer was not overwritten.
- Current Flutter analysis passed. A release APK built from an isolated copy of
  the current source and its v2 signature verified with the same certificate
  as the existing release APK.
- Tauri NSIS installer build passed.
- Disposable legacy-schema PostgreSQL upgrade applied the four pending
  migrations and preserved fixture users, orders, order items, payments, and
  settings.
- Disposable PostgreSQL catalog sync imported 129 products, 15 categories,
  and 32 variants; repeat sync remained duplicate-free.
- A `Grill` **Full** variant priced at 450 (base price 250) was ordered at 450
  per unit; a quantity of two recorded a 900 subtotal. The updated POS also
  passed focused backend tests for a quantity of 100 and additional items
  beyond the former stock cap.
- The installer's custom-format PostgreSQL backup command produced a nonempty
  archive that passed `pg_restore --list`.
- The actual NSIS installation, packaged desktop UI, and physical Android LAN
  flow remain pending on an isolated Windows test machine/device. The existing
  installer was not reinstalled or proven to correspond byte-for-byte to the
  current source.
