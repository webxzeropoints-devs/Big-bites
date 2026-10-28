const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { assertSafeMigrationSet } = require("./assert-safe-migrations.cjs");

require("dotenv").config();

const localEnvironment =
  process.env.BIGBITES_DEPLOYMENT_MODE === "local" ||
  (existsSync(path.resolve(process.cwd(), ".env")) &&
    process.env.RENDER !== "true");

if (localEnvironment || process.env.NODE_ENV !== "production") {
  console.info("Automatic Prisma migrations are disabled for local POS startup.");
  process.exit(0);
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  let connected = false;
  let migrationHistory;
  try {
    await client.connect();
    connected = true;
    await client.query("BEGIN READ ONLY");
    const result = await client.query(
      `SELECT migration_name, checksum, finished_at, rolled_back_at,
              to_regclass('public."ProductStockMovement"') IS NOT NULL AS product_stock_movement_exists
       FROM public."_prisma_migrations"
       WHERE migration_name IN ($1, $2, $3)`,
      [
        "20261020101500_remove_product_stock",
        "20261020100000_remove_product_stock",
        "20261013213000_add_product_stock_movements",
      ],
    );
    await client.query("COMMIT");
    migrationHistory = result.rows;
  } catch {
    if (connected) await client.query("ROLLBACK").catch(() => {});
    throw new Error(
      "Automatic Prisma migrations are blocked because the inventory migration ledger could not be verified.",
    );
  } finally {
    if (connected) await client.end().catch(() => {});
  }

  assertSafeMigrationSet(
    path.resolve(process.cwd(), "prisma/migrations"),
    migrationHistory,
  );

  const prismaCli = path.resolve(
    __dirname,
    "../node_modules/prisma/build/index.js",
  );

  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
