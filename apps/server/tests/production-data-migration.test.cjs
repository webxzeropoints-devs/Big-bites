const test = require("node:test");
const assert = require("node:assert/strict");
const { Client } = require("pg");
const {
  migrate,
  sameRow,
  sumMoney,
  validateEndpoints,
  validateSourceSchema,
} = require("../scripts/migrate-production-data.cjs");
const { assertSafeMigrationSet } = require("../scripts/assert-safe-migrations.cjs");

const sourceSchema = new Map([
  ["Category", ["id", "name", "sortOrder", "createdAt", "updatedAt"]],
  [
    "Product",
    [
      "id", "slug", "name", "description", "price", "isVegetarian",
      "classification", "subcategory", "isSignature", "isActive",
      "stock", "stockUnit", "lowStockThreshold", "lastStockUpdatedAt",
      "createdAt", "updatedAt", "categoryId",
    ],
  ],
  [
    "ProductStockMovement",
    [
      "id", "productId", "movementType", "quantity", "previousStock",
      "newStock", "reason", "createdAt",
    ],
  ],
  [
    "ProductVariant",
    ["id", "name", "price", "isActive", "createdAt", "updatedAt", "productId"],
  ],
  [
    "RestaurantTable",
    ["id", "number", "isParcel", "status", "createdAt", "updatedAt"],
  ],
  [
    "User",
    ["id", "name", "username", "password", "role", "createdAt", "updatedAt"],
  ],
  [
    "RestaurantSettings",
    [
      "id", "gstRate", "gstEnabled", "orderReportsPath", "restaurantAddress",
      "fssaiEnabled", "fssaiNumber", "gstinEnabled", "gstinNumber",
      "createdAt", "updatedAt",
    ],
  ],
  [
    "Order",
    [
      "id", "status", "total", "gstRate", "gstEnabled", "discountType",
      "discountValue", "discountAmount", "createdAt", "updatedAt", "tableId",
      "waiterId",
    ],
  ],
  [
    "OrderItem",
    ["id", "quantity", "unitPrice", "subtotal", "variantId", "orderId", "productId"],
  ],
  [
    "Payment",
    [
      "id", "amount", "amountReceived", "change", "method", "status", "paidAt",
      "createdAt", "orderId",
    ],
  ],
].map(([table, fields]) => [table, new Set(fields)]));

const testSourceUrl = process.env.BIGBITES_MIGRATION_TEST_SOURCE_URL;
const mergeTargetUrl = process.env.BIGBITES_MIGRATION_TEST_MERGE_TARGET_URL;
const conflictTargetUrl =
  process.env.BIGBITES_MIGRATION_TEST_CONFLICT_TARGET_URL;
const integrationUrls = [testSourceUrl, mergeTargetUrl, conflictTargetUrl];
const integrationRequested = integrationUrls.some(Boolean);
const hasIsolatedUrl = (raw, databasePattern) => {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    const database = decodeURIComponent(url.pathname.slice(1));
    return (
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      ["127.0.0.1", "localhost", "::1"].includes(url.hostname.toLowerCase()) &&
      !!url.port &&
      url.port !== "5432" &&
      databasePattern.test(database)
    );
  } catch {
    return false;
  }
};
const integrationConfigured =
  process.env.NODE_ENV === "test" &&
  hasIsolatedUrl(testSourceUrl, /^bigbites_test_production_clone$/i) &&
  hasIsolatedUrl(mergeTargetUrl, /^bigbites_test_[a-z0-9_]+$/i) &&
  hasIsolatedUrl(conflictTargetUrl, /^bigbites_test_[a-z0-9_]+$/i);

test("configured migration integration endpoints are isolated loopback test databases", () => {
  if (!integrationRequested) return;
  assert.equal(process.env.NODE_ENV, "test");
  assert.ok(
    hasIsolatedUrl(testSourceUrl, /^bigbites_test_production_clone$/i),
    "source must be the approved loopback bigbites_test_production_clone fixture",
  );
  assert.ok(
    hasIsolatedUrl(mergeTargetUrl, /^bigbites_test_[a-z0-9_]+$/i),
    "merge target must be a loopback bigbites_test_* database",
  );
  assert.ok(
    hasIsolatedUrl(conflictTargetUrl, /^bigbites_test_[a-z0-9_]+$/i),
    "conflict target must be a loopback bigbites_test_* database",
  );
});

test("migration endpoints only allow isolated loopback test databases", () => {
  const source =
    "postgresql://tester@127.0.0.1:55432/bigbites_test_production_clone";
  assert.doesNotThrow(() =>
    validateEndpoints(
      source,
      "postgresql://tester@127.0.0.1:55432/bigbites_test_migration",
      "test",
    ),
  );
  assert.throws(
    () =>
      validateEndpoints(
        "postgresql://tester@127.0.0.1:55432/bigbites_production_clone_test",
        "postgresql://tester@127.0.0.1:55432/bigbites_test_migration",
        "test",
      ),
    /Source must be the isolated loopback bigbites_test_production_clone/,
  );
  assert.throws(
    () =>
      validateEndpoints(
        "postgresql://tester@ep-example.neon.tech/bigbites",
        "postgresql://tester@127.0.0.1:55432/bigbites_test_migration",
        "test",
      ),
    /Source must be the isolated loopback bigbites_test_production_clone/,
  );
  assert.throws(
    () =>
      validateEndpoints(
        source,
        "postgresql://tester@127.0.0.1:5432/bigbites",
        "test",
      ),
    /Writes are restricted/,
  );
  assert.throws(
    () =>
      validateEndpoints(
        source,
        "postgresql://tester@127.0.0.1:55432/production",
        "test",
      ),
    /Writes are restricted/,
  );
});

test("stock-removal migration remains present and automatic migrations are blocked", () => {
  const migrationFile = require("node:path").resolve(
    __dirname,
    "../prisma/migrations/20261020101500_remove_product_stock/migration.sql",
  );
  assert.equal(require("node:fs").existsSync(migrationFile), true);
  assert.throws(
    () =>
      assertSafeMigrationSet(
        require("node:path").resolve(__dirname, "../prisma/migrations"),
      ),
    /20261020(?:100000|101500)_remove_product_stock removes product inventory/,
  );
});

test("automatic migration is blocked when the migration set is incomplete", (context) => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const migrationsDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "bigbites-migration-guard-"),
  );
  context.after(() => fs.rmSync(migrationsDirectory, { recursive: true, force: true }));

  for (const migration of [
    "20261009230000_menu_variants_classification",
    "20261013010000_cash_upi_split_payment",
    "20261013213000_add_product_stock_movements",
  ]) {
    const migrationDirectory = path.join(migrationsDirectory, migration);
    fs.mkdirSync(migrationDirectory);
    fs.writeFileSync(path.join(migrationDirectory, "migration.sql"), "-- fixture");
  }
  fs.writeFileSync(path.join(migrationsDirectory, "migration_lock.toml"), 'provider = "postgresql"');

  assert.throws(
    () => assertSafeMigrationSet(migrationsDirectory),
    /required schema history is incomplete.*20260914084442_initial_hotel_pos/,
  );
});

test("automatic migration is blocked when its migration directory is missing", () => {
  assert.throws(
    () =>
      assertSafeMigrationSet(
        require("node:path").resolve(
          __dirname,
          "../prisma/migrations/not-a-migration-directory",
        ),
      ),
    /Prisma migrations directory is missing/,
  );
});

test("automatic migration is blocked when renamed SQL drops stock history", (context) => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "bigbites-stock-guard-"),
  );
  const migrationsDirectory = path.join(fixtureRoot, "migrations");
  fs.mkdirSync(migrationsDirectory);
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const sourceMigrationsDirectory = path.resolve(
    __dirname,
    "../prisma/migrations",
  );
  for (const migration of fs
    .readdirSync(sourceMigrationsDirectory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name !== "20261020101500_remove_product_stock" &&
        entry.name !== "20261020100000_remove_product_stock",
    )
    .map((entry) => entry.name)) {
    const migrationDirectory = path.join(migrationsDirectory, migration);
    fs.mkdirSync(migrationDirectory);
    fs.copyFileSync(
      path.join(sourceMigrationsDirectory, migration, "migration.sql"),
      path.join(migrationDirectory, "migration.sql"),
    );
  }
  const renamedMigrationDirectory = path.join(
    migrationsDirectory,
    "20261099999999_renamed_change",
  );
  fs.mkdirSync(renamedMigrationDirectory);
  fs.writeFileSync(
    path.join(renamedMigrationDirectory, "migration.sql"),
    'DROP TABLE IF EXISTS "ProductStockMovement";',
  );
  fs.writeFileSync(
    path.join(migrationsDirectory, "migration_lock.toml"),
    'provider = "postgresql"',
  );
  fs.copyFileSync(
    path.resolve(__dirname, "../prisma/schema.prisma"),
    path.join(fixtureRoot, "schema.prisma"),
  );

  assert.throws(
    () => assertSafeMigrationSet(migrationsDirectory),
    /20261099999999_renamed_change contains SQL that removes product stock or stock-movement history/,
  );
  fs.writeFileSync(
    path.join(renamedMigrationDirectory, "migration.sql"),
    'ALTER TABLE "Product" DROP COLUMN "stock";',
  );
  assert.throws(
    () => assertSafeMigrationSet(migrationsDirectory),
    /20261099999999_renamed_change contains SQL that removes product stock or stock-movement history/,
  );
  fs.writeFileSync(
    path.join(renamedMigrationDirectory, "migration.sql"),
    "SELECT 1;",
  );
  assert.throws(
    () => assertSafeMigrationSet(migrationsDirectory),
    /unreviewed directories: 20261099999999_renamed_change/,
  );
});

test("automatic migration entry points run preflight before deploy", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const repositoryRoot = path.resolve(__dirname, "../../..");
  const canonicalStartup = fs.readFileSync(
    path.join(repositoryRoot, "apps/server/scripts/run-start-migrations.cjs"),
    "utf8",
  );
  const standaloneStartup = fs.readFileSync(
    path.join(
      repositoryRoot,
      "BIG-BITES-SERVER-CLIENT/scripts/run-start-migrations.cjs",
    ),
    "utf8",
  );
  const installer = fs.readFileSync(
    path.join(
      repositoryRoot,
      "apps/desktop/src-tauri/windows/Install-BigBites.ps1",
    ),
    "utf8",
  );
  const installerGuard = installer.indexOf(
    "$migrationSql -match $destructiveInventorySql",
  );
  const installerStopCall = installer.indexOf(
    "Stop-ExistingServer",
    installerGuard,
  );

  assert.ok(
    canonicalStartup.indexOf("assertSafeMigrationSet(") <
      canonicalStartup.indexOf('"migrate", "deploy"'),
  );
  assert.ok(
    standaloneStartup.indexOf("inventoryRemovalMigration") <
      standaloneStartup.indexOf('"migrate", "deploy"'),
  );
  assert.match(standaloneStartup, /destructiveInventorySql/);
  assert.match(standaloneStartup, /unreviewedMigrations/);
  assert.ok(installerGuard >= 0 && installerGuard < installerStopCall);
  assert.ok(installerGuard < installer.indexOf("migrate deploy"));
  assert.match(
    installer,
    /\$databaseName\s*=\s*"bigbites_client_local"[\s\S]*?function Assert-FreshDatabaseMigrationGate[\s\S]*?\$DatabaseCreatedByAttempt[\s\S]*?\$databaseStateParts\[4\]\s*-notin\s*@\("absent",\s*"present"\)/,
  );
  assert.ok(
    installer.indexOf("Assert-FreshDatabaseMigrationGate `") <
      installer.indexOf("migrate deploy"),
  );
  assert.ok(
    installer.indexOf("$destructiveInventorySql") < installerStopCall,
  );
  assert.ok(
    installer.indexOf("$unreviewedMigrations") < installerStopCall,
  );
});

test("source schema fixture retains inventory columns and movement history", () => {
  assert.doesNotThrow(() => validateSourceSchema(sourceSchema));
  for (const column of [
    "stock",
    "stockUnit",
    "lowStockThreshold",
    "lastStockUpdatedAt",
  ]) {
    assert.equal(sourceSchema.get("Product").has(column), true);
  }
  assert.equal(sourceSchema.has("ProductStockMovement"), true);

  const missingTable = new Map(sourceSchema);
  missingTable.delete("OrderItem");
  assert.throws(
    () => validateSourceSchema(missingTable),
    /Source schema is incomplete.*OrderItem \(table\)/,
  );

  const missingRequiredField = new Map(sourceSchema);
  missingRequiredField.set(
    "Product",
    new Set([...sourceSchema.get("Product")].filter((field) => field !== "slug")),
  );
  assert.throws(
    () => validateSourceSchema(missingRequiredField),
    /Product\.slug/,
  );

  const missingPaymentField = new Map(sourceSchema);
  missingPaymentField.set(
    "Payment",
    new Set([...sourceSchema.get("Payment")].filter((field) => field !== "method")),
  );
  assert.throws(
    () => validateSourceSchema(missingPaymentField),
    /Payment\.method/,
  );

  assert.doesNotThrow(
    () => validateSourceSchema(sourceSchema),
    "legacy inventory columns and movement tables are not required for POS data import",
  );
});

test("row comparison and money aggregation are exact", () => {
  assert.equal(
    sameRow(
      { id: 4, createdAt: new Date("2026-01-02T03:04:05.000Z") },
      { id: 4, createdAt: "2026-01-02T03:04:05.000Z" },
      ["id", "createdAt"],
    ),
    true,
  );
  assert.equal(
    sumMoney([{ amount: "0.10" }, { amount: "0.20" }], "amount"),
    "0.30",
  );
});

test(
  "complete data import is repeatable and preserves local records",
  { skip: !integrationConfigured },
  async () => {
    const source = new Client({ connectionString: testSourceUrl });
    const target = new Client({ connectionString: mergeTargetUrl });
    try {
      await Promise.all([source.connect(), target.connect()]);

      const sourceProducts = await source.query(
        `SELECT id, slug FROM "Product" ORDER BY id`,
      );
      const targetProducts = await target.query(
        'SELECT slug FROM "Product"',
      );
      const targetSlugs = new Set(targetProducts.rows.map((row) => row.slug));
      const sourceOnlyProduct = sourceProducts.rows.find(
        (row) => !targetSlugs.has(row.slug),
      );
      assert.ok(
        sourceOnlyProduct,
        "the isolated merge fixture must include a source-only product",
      );

      const first = await migrate({
        sourceUrl: testSourceUrl,
        targetUrl: mergeTargetUrl,
        replaceDefaultSettingsForTest: true,
      });
      const second = await migrate({
        sourceUrl: testSourceUrl,
        targetUrl: mergeTargetUrl,
      });

      assert.equal(first.sourceReadOnly, "on");
      assert.ok(first.importedRows.Order >= 82);
      assert.ok(first.importedRows.OrderItem >= 131);
      assert.equal(first.importedRows.ProductVariant, 32);
      assert.ok(first.importedRows.Payment >= 82);
      for (const count of Object.values(second.counters.inserted)) {
        assert.equal(count, 0);
      }
      for (const count of Object.values(second.counters.updated)) {
        assert.equal(count, 0);
      }

      const tableStatus = await source.query(
        'SELECT status FROM "RestaurantTable" WHERE number = 1',
      );
      const checks = await target.query(`
        SELECT
          (SELECT count(*)::int FROM "Category" WHERE "name" = 'Local-only test category') AS local_category,
          (SELECT count(*)::int FROM "Product" WHERE "slug" = 'local-only-test-product') AS local_product,
          (SELECT slug FROM "Product" WHERE "id" = 5000) AS matched_product_slug,
          (SELECT password FROM "User" WHERE "id" = 5000) AS preserved_password,
          (SELECT status::text FROM "RestaurantTable" WHERE "id" = 5000) AS preserved_table_status,
          (SELECT price::text FROM "ProductVariant" WHERE "id" = 5000) AS matched_variant_price,
          (SELECT name FROM "ProductVariant" WHERE "id" = 5000) AS matched_variant_name,
          (SELECT count(*)::int FROM "Order" WHERE "id" = 9000000) AS local_order,
          (SELECT count(*)::int FROM "OrderItem" WHERE "id" = 9000000) AS local_item,
          (SELECT count(*)::int FROM "Payment" WHERE "id" = 9000000) AS local_payment
      `);
      const row = checks.rows[0];
      const expectedVariant = await source.query(
        `SELECT v.price::text, v.name
         FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId"
         WHERE p.slug = $1 AND v.name = $2`,
        [row.matched_product_slug, row.matched_variant_name],
      );
      assert.equal(row.local_category, 1);
      assert.equal(row.local_product, 1);
      assert.equal(row.preserved_password, "synthetic-preserved-password-hash");
      assert.notEqual(row.preserved_table_status, tableStatus.rows[0].status);
      assert.equal(expectedVariant.rowCount, 1);
      assert.equal(row.matched_variant_price, expectedVariant.rows[0].price);
      assert.equal(row.local_order, 1);
      assert.equal(row.local_item, 1);
      assert.equal(row.local_payment, 1);

      const sequence = await target.query(
        `SELECT nextval(pg_get_serial_sequence('"Order"', 'id'))::bigint AS next_id`,
      );
      assert.ok(BigInt(sequence.rows[0].next_id) > 9000000n);
    } finally {
      await Promise.all([source.end(), target.end()]);
    }
  },
);

test(
  "unresolvable historical order ID conflict rolls back all inserted source rows",
  { skip: !integrationConfigured },
  async () => {
    await assert.rejects(
      migrate({
        sourceUrl: testSourceUrl,
        targetUrl: conflictTargetUrl,
      }),
      /Conflict at RestaurantSettings id=1/,
    );
    await assert.rejects(
      migrate({
        sourceUrl: testSourceUrl,
        targetUrl: conflictTargetUrl,
        replaceDefaultSettingsForTest: true,
      }),
      /Conflict at Order id=/,
    );

    const target = new Client({ connectionString: conflictTargetUrl });
    try {
      await target.connect();
      const counts = await target.query(`
        SELECT
          (SELECT count(*)::int FROM "Category") AS categories,
          (SELECT count(*)::int FROM "Product") AS products,
          (SELECT count(*)::int FROM "ProductVariant") AS variants,
          (SELECT count(*)::int FROM "Order") AS orders,
          (SELECT count(*)::int FROM "OrderItem") AS items,
          (SELECT count(*)::int FROM "Payment") AS payments
      `);
      assert.deepEqual(counts.rows[0], {
        categories: 0,
        products: 0,
        variants: 0,
        orders: 1,
        items: 0,
        payments: 0,
      });
    } finally {
      await target.end();
    }
  },
);
