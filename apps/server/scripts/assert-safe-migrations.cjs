const { createHash } = require("node:crypto");
const path = require("node:path");
const { existsSync, readFileSync, readdirSync, statSync } = require("node:fs");

const INVENTORY_REMOVAL_MIGRATION = "20261020101500_remove_product_stock";
const INVENTORY_REMOVAL_ALIAS = "20261020100000_remove_product_stock";
const STOCK_MOVEMENT_MIGRATION = "20261013213000_add_product_stock_movements";
const INVENTORY_REMOVAL_SQL = `DROP TABLE IF EXISTS "ProductStockMovement";

ALTER TABLE "Product"
  DROP COLUMN IF EXISTS "stock",
  DROP COLUMN IF EXISTS "stockUnit",
  DROP COLUMN IF EXISTS "lowStockThreshold",
  DROP COLUMN IF EXISTS "lastStockUpdatedAt";
`;
const normalizeSql = (sql) => sql.replace(/\s+/g, " ").trim();
const REQUIRED_CANONICAL_MIGRATIONS = [
  "20260914084442_initial_hotel_pos",
  "20260922200000_remove_kitchen_role",
  "20260922210000_add_parcel_table",
  "20260928233000_ready_for_billing",
  "20260928234000_pending_order_payments",
  "20260929210000_add_gst_settings",
  "20260929220000_add_restaurant_address",
  "20261003120000_add_fssai_gstin_settings",
  "20261003123000_add_order_discounts",
  "20261003130000_remove_manager_role",
  "20261006150000_payment_tender_details",
  "20261006220000_add_gst_toggle_and_order_reports",
  "20261009230000_menu_variants_classification",
  "20261013010000_cash_upi_split_payment",
  "20261013213000_add_product_stock_movements",
  INVENTORY_REMOVAL_MIGRATION,
  "20261027210000_restore_product_inventory",
  "20261028143000_add_order_item_idempotency",
  "20261028160000_add_combo_products_and_snapshots",
  "20261028170000_add_combo_name_snapshot",
];

function assertSafeMigrationSet(migrationsDirectory, migrationHistory = []) {
  if (
    !existsSync(migrationsDirectory) ||
    !statSync(migrationsDirectory).isDirectory()
  ) {
    throw new Error(
      `Prisma migrations directory is missing: ${migrationsDirectory}`,
    );
  }

  const destructiveInventorySql =
    /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:(?:"?[\w]+"?)\.)?(?:"ProductStockMovement"|ProductStockMovement)(?![\w])|\bALTER\s+TABLE\b[^;]*?\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(?:"(?:stock|stockUnit|lowStockThreshold|lastStockUpdatedAt)"|\b(?:stock|stockUnit|lowStockThreshold|lastStockUpdatedAt)\b)/i;
  for (const entry of readdirSync(migrationsDirectory, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;

    const migrationName = entry.name;
    const migrationFile = path.join(
      migrationsDirectory,
      migrationName,
      "migration.sql",
    );
    if (!existsSync(migrationFile)) {
      throw new Error(
        `Automatic Prisma migrations are blocked because migration ${migrationName} has no migration.sql file.`,
      );
    }
    const migrationSql = readFileSync(migrationFile, "utf8");
    if (destructiveInventorySql.test(migrationSql)) {
      if (
        migrationName === INVENTORY_REMOVAL_MIGRATION &&
        normalizeSql(migrationSql) === normalizeSql(INVENTORY_REMOVAL_SQL)
      ) {
        continue;
      }
      throw new Error(
        `Automatic Prisma migrations are blocked because migration ${migrationName} contains SQL that removes product stock or stock-movement history.`,
      );
    }
  }

  const unreviewedMigrations = readdirSync(migrationsDirectory, {
    withFileTypes: true,
  })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !REQUIRED_CANONICAL_MIGRATIONS.includes(entry.name),
    )
    .map((entry) => entry.name);
  if (unreviewedMigrations.length) {
    throw new Error(
      `Automatic Prisma migrations are blocked because the migration set contains unreviewed directories: ${unreviewedMigrations.join(", ")}.`,
    );
  }

  const missingMigrations = REQUIRED_CANONICAL_MIGRATIONS.filter(
    (migration) =>
      !existsSync(path.join(migrationsDirectory, migration, "migration.sql")),
  );
  if (
    missingMigrations.length ||
    !existsSync(path.join(migrationsDirectory, "migration_lock.toml"))
  ) {
    const missingResources = missingMigrations.slice();
    if (!existsSync(path.join(migrationsDirectory, "migration_lock.toml"))) {
      missingResources.push("migration_lock.toml");
    }
    throw new Error(
      `Automatic Prisma migrations are blocked because required schema history is incomplete: ${missingResources.join(", ")}.`,
    );
  }

  if (!Array.isArray(migrationHistory)) {
    throw new Error(
      "Automatic Prisma migrations are blocked because production migration history could not be verified.",
    );
  }
  if (
    migrationHistory.some(
      (migration) => migration.migration_name === INVENTORY_REMOVAL_ALIAS,
    )
  ) {
    throw new Error(
      `Automatic Prisma migrations are blocked because the database contains the unsupported migration alias ${INVENTORY_REMOVAL_ALIAS}.`,
    );
  }
  const removalMigration = migrationHistory.find(
    (migration) => migration.migration_name === INVENTORY_REMOVAL_MIGRATION,
  );
  const removalMigrationSql = readFileSync(
    path.join(
      migrationsDirectory,
      INVENTORY_REMOVAL_MIGRATION,
      "migration.sql",
    ),
  );
  const expectedRemovalChecksum = createHash("sha256")
    .update(removalMigrationSql)
    .digest("hex");
  if (
    !removalMigration ||
    removalMigration.checksum !== expectedRemovalChecksum ||
    !removalMigration.finished_at ||
    removalMigration.rolled_back_at != null
  ) {
    throw new Error(
      `Automatic Prisma migrations are blocked because ${INVENTORY_REMOVAL_MIGRATION} is not recorded as successfully applied with the packaged historical checksum.`,
    );
  }
  const stockMovementMigration = migrationHistory.find(
    (migration) => migration.migration_name === STOCK_MOVEMENT_MIGRATION,
  );
  if (stockMovementMigration) {
    const stockMovementSql = readFileSync(
      path.join(
        migrationsDirectory,
        STOCK_MOVEMENT_MIGRATION,
        "migration.sql",
      ),
    );
    const expectedStockMovementChecksum = createHash("sha256")
      .update(stockMovementSql)
      .digest("hex");
    if (
      stockMovementMigration.checksum !== expectedStockMovementChecksum ||
      !stockMovementMigration.finished_at ||
      stockMovementMigration.rolled_back_at != null
    ) {
      throw new Error(
        `Automatic Prisma migrations are blocked because ${STOCK_MOVEMENT_MIGRATION} has an unrecognized or unsuccessful ledger entry.`,
      );
    }
  } else if (
    migrationHistory.some(
      (migration) => migration.product_stock_movement_exists === true,
    )
  ) {
    throw new Error(
      `Automatic Prisma migrations are blocked because ${STOCK_MOVEMENT_MIGRATION} is absent from history but its table already exists.`,
    );
  }

  const schemaPath = path.resolve(migrationsDirectory, "..", "schema.prisma");
  if (!existsSync(schemaPath)) {
    throw new Error(
      `Automatic Prisma migrations are blocked because the packaged Prisma schema is missing: ${schemaPath}`,
    );
  }

  const schema = readFileSync(schemaPath, "utf8");
  if (!/model\s+Product\s*\{[\s\S]*?^\}/m.test(schema)) {
    throw new Error(
      "Automatic Prisma migrations are blocked because the packaged Prisma schema does not define the Product model.",
    );
  }
}

module.exports = { assertSafeMigrationSet };
