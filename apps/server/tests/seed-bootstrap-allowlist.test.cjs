const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { COMBO_CATALOG } = require("../dist/catalog/comboCatalog.js");

const seedPath = path.join(
  __dirname,
  "..",
  "prisma",
  "seed",
  "seed.ts",
);
const schemaPath = path.join(__dirname, "..", "prisma", "schema.prisma");
const comboMigrationPath = path.join(
  __dirname,
  "..",
  "prisma",
  "migrations",
  "20261028160000_add_combo_products_and_snapshots",
  "migration.sql",
);
const seedSource = fs.readFileSync(seedPath, "utf8");
const schemaSource = fs.readFileSync(schemaPath, "utf8");
const comboMigrationSource = fs.readFileSync(comboMigrationPath, "utf8");
const comboNameMigrationPath = path.join(
  __dirname,
  "..",
  "prisma",
  "migrations",
  "20261028170000_add_combo_name_snapshot",
  "migration.sql",
);
const comboNameMigrationSource = fs.readFileSync(comboNameMigrationPath, "utf8");
const desktopAppSource = fs.readFileSync(
  path.resolve(__dirname, "../../desktop/src/App.tsx"),
  "utf8",
);
const allowedTablesMatch = seedSource.match(
  /tablename\s+NOT IN\s*\(([\s\S]*?)\)/i,
);

assert.ok(allowedTablesMatch, "bootstrap must reject tables outside its allowlist");

const allowedTables = new Set(
  [...allowedTablesMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]),
);
const canonicalModels = [
  ...schemaSource.matchAll(/^model\s+(\w+)\s*\{/gm),
].map((match) => match[1]);

test("bootstrap allowlist accepts every canonical model", () => {
  assert.equal(canonicalModels.includes("ProductStockMovement"), true);
  assert.deepEqual(
    canonicalModels.filter((model) => !allowedTables.has(model)),
    [],
  );
});

test("inventory and combo migrations are additive and preserve existing rows", () => {
  const inventoryMigration = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "prisma",
      "migrations",
      "20261027210000_restore_product_inventory",
      "migration.sql",
    ),
    "utf8",
  );

  assert.match(inventoryMigration, /ADD COLUMN IF NOT EXISTS "stock"/);
  assert.match(inventoryMigration, /ADD COLUMN IF NOT EXISTS "stockUnit"/);
  assert.match(inventoryMigration, /ADD COLUMN IF NOT EXISTS "lowStockThreshold"/);
  assert.match(inventoryMigration, /ADD COLUMN IF NOT EXISTS "lastStockUpdatedAt"/);
  assert.match(inventoryMigration, /CREATE TABLE IF NOT EXISTS "ProductStockMovement"/);
  assert.match(inventoryMigration, /FOREIGN KEY \("productId"\) REFERENCES "Product"\("id"\)/);
  assert.doesNotMatch(inventoryMigration, /\b(DROP\s+(?:TABLE|COLUMN)|DELETE\s+FROM|TRUNCATE)\b/i);
  assert.doesNotMatch(inventoryMigration, /\bUPDATE\s+"(?:Product|OrderItem|ProductStockMovement)"/i);

  assert.match(comboMigrationSource, /ADD COLUMN IF NOT EXISTS "comboItems"/);
  assert.match(comboMigrationSource, /ADD COLUMN IF NOT EXISTS "comboSnapshot"/);
  assert.match(comboMigrationSource, /ON CONFLICT \("name"\) DO NOTHING/);
  assert.equal((comboMigrationSource.match(/ON CONFLICT \("slug"\) DO NOTHING/g) ?? []).length, 2);
  assert.doesNotMatch(comboMigrationSource, /ON CONFLICT[\s\S]*?DO UPDATE/i);
  assert.doesNotMatch(comboMigrationSource, /\b(UPDATE|DELETE|TRUNCATE)\s+"OrderItem"/i);
  assert.match(comboNameMigrationSource, /ADD COLUMN IF NOT EXISTS "comboNameSnapshot"/);
});

test("bootstrap allowlist still rejects unrelated public tables", () => {
  const unexpectedTables = [
    ...canonicalModels,
    "_prisma_migrations",
    "UnexpectedAuditTable",
  ].filter((table) => !allowedTables.has(table));

  assert.deepEqual(unexpectedTables, ["UnexpectedAuditTable"]);
});

test("bootstrap retains explicit confirmation and serializable empty-database checks", () => {
  const inputValidationStart = seedSource.indexOf(
    "async function readInstallerBootstrapInput()",
  );
  const databaseCheckStart = seedSource.indexOf(
    "async function assertDatabaseSafeForInstallerBootstrap(",
  );
  const bootstrapStart = seedSource.indexOf(
    "async function initializeEmptyDatabase()",
  );
  const mainStart = seedSource.indexOf("async function main()");
  assert.notEqual(bootstrapStart, -1);
  assert.notEqual(mainStart, -1);
  const bootstrapSource = seedSource.slice(bootstrapStart, mainStart);

  assert.notEqual(inputValidationStart, -1);
  assert.notEqual(databaseCheckStart, -1);
  assert.match(seedSource, /input\.confirmInitialMenu !== true/);
  assert.match(seedSource, /input\.accounts\.length !== 3/);
  assert.match(seedSource, /hasBusinessRows\s*\|\|\s*hasNonDefaultTables/);
  assert.match(bootstrapSource, /await readInstallerBootstrapInput\(\)/);
  assert.ok(
    bootstrapSource.indexOf("assertDatabaseSafeForInstallerBootstrap(tx)") <
      bootstrapSource.indexOf("createInitialMenu(tx)"),
  );
  assert.ok(bootstrapSource.includes("createInitialAccounts(tx, input.accounts)"));
  assert.match(
    bootstrapSource,
    /isolationLevel:\s*Prisma\.TransactionIsolationLevel\.Serializable/,
  );
});

test("combo migration is additive and idempotently adds only the fixed catalog entries", () => {
  assert.match(comboMigrationSource, /ADD COLUMN IF NOT EXISTS "comboItems" JSONB/);
  assert.match(comboMigrationSource, /ADD COLUMN IF NOT EXISTS "comboSnapshot" JSONB/);
  assert.match(comboMigrationSource, /'Couples\/Friends Combo'[\s\S]*499\.00/);
  assert.match(comboMigrationSource, /'Family Combo'[\s\S]*999\.00/);
  assert.match(comboMigrationSource, /ON CONFLICT \("name"\) DO NOTHING/);
  assert.equal((comboMigrationSource.match(/ON CONFLICT \("slug"\) DO NOTHING/g) ?? []).length, 2);
  assert.doesNotMatch(comboMigrationSource, /ON CONFLICT[\s\S]*?DO UPDATE/i);
  assert.equal((comboMigrationSource.match(/IF NOT EXISTS\s*\(\s*SELECT 1 FROM "Product" AS product/g) ?? []).length, 2);
  assert.equal((comboMigrationSource.match(/RAISE EXCEPTION 'A .* Combo product already exists with a noncanonical slug/g) ?? []).length, 2);
  assert.equal(
    (comboMigrationSource.match(/"categoryId", "comboItems",\s*"createdAt", "updatedAt"/g) ?? []).length,
    2,
  );
  assert.doesNotMatch(comboMigrationSource, /\b(DROP TABLE|DELETE FROM|TRUNCATE)\b/i);
});

test("combo name snapshot migration is additive and matches the Prisma model", () => {
  assert.match(schemaSource, /comboNameSnapshot\s+String\?/);
  assert.match(
    comboNameMigrationSource,
    /ADD COLUMN IF NOT EXISTS "comboNameSnapshot" TEXT/,
  );
  assert.doesNotMatch(comboNameMigrationSource, /\b(DROP|DELETE|TRUNCATE)\b/i);
});

test("desktop receipts prefer saved combo names and components over the current menu", () => {
  assert.equal(
    (desktopAppSource.match(/item\.comboNameSnapshot \?\? item\.product\.name/g) ?? []).length,
    2,
  );
  assert.equal(
    (desktopAppSource.match(/item\.comboSnapshot \?\? item\.product\.comboItems \?\? \[\]/g) ?? []).length,
    2,
  );
});

test("menu import verifies the source catalog and reports complete counts", () => {
  const categoryMatch = seedSource.match(
    /const categories = \[([\s\S]*?)\];/,
  );
  const menuMatch = seedSource.match(
    /const menu: MenuProduct\[\] = \[([\s\S]*?)\n\];/,
  );
  assert.ok(categoryMatch);
  assert.ok(menuMatch);

  const categories = [...categoryMatch[1].matchAll(/"([^"]+)"/g)].map(
    (match) => match[1],
  );
  const menu = menuMatch[1];
  const productRows = [...menu.matchAll(/\["([^"]+)",\s*(\d+)/g)];
  const variantRows = [...menu.matchAll(
    /\{\s*name:\s*"([^"]+)",\s*price:\s*(\d+),?\s*\}/g,
  )];
  const shawarmaPriceRows = [
    ...menu.matchAll(/shawarmaVariants\(\[([\d,\s]+)\]\)/g),
  ].flatMap((match) => match[1].split(",").map(Number));
  const shawarmaProducts = [...menu.matchAll(/variantProduct\("Shawarma"/g)];
  const variantProducts = [...menu.matchAll(/\bvariantProduct\(/g)];

  assert.equal(categories.length + COMBO_CATALOG.length, 17);
  assert.equal(productRows.length + variantProducts.length + COMBO_CATALOG.length, 123);
  assert.equal(variantRows.length + shawarmaProducts.length * 4, 32);
  assert.equal(
    productRows.length + variantRows.length + shawarmaPriceRows.length + COMBO_CATALOG.length,
    146,
  );
  assert.ok(
    [...productRows, ...variantRows]
      .every((match) => Number(match[2]) > 0) &&
      shawarmaPriceRows.every((price) => price > 0),
  );

  assert.deepEqual(
    COMBO_CATALOG.map(({ name, price, items }) => ({ name, price, items })),
    [
      {
        name: "Couples/Friends Combo",
        price: "499.00",
        items: [
          { name: "Chicken Rice", quantity: 1 },
          { name: "Chicken Briyani", quantity: 1 },
          { name: "BBQ Quarter", quantity: 1 },
          { name: "Chicken Lollipop", quantity: 1 },
        ],
      },
      {
        name: "Family Combo",
        price: "999.00",
        items: [
          { name: "Chicken Rice", quantity: 1 },
          { name: "Chicken Briyani", quantity: 1 },
          { name: "Chicken Noodles", quantity: 1 },
          { name: "Butter Naan", quantity: 1 },
          { name: "Roti", quantity: 1 },
          { name: "Chicken Masala", quantity: 1 },
          { name: "Dragon Chicken", quantity: 1 },
          { name: "Saucy Lollipop", quantity: 1 },
          { name: "BBQ Quarter", quantity: 1 },
        ],
      },
    ],
  );

  assert.match(seedSource, /assertMenuMatchesSource\(importedMenu\)/);
  const menuImportStart = seedSource.indexOf(
    "const importResult = await prisma.$transaction(",
  );
  const reportStart = seedSource.indexOf(
    "await writeMenuImportReport(",
    menuImportStart,
  );
  assert.notEqual(menuImportStart, -1);
  assert.ok(reportStart > menuImportStart);
  assert.match(
    seedSource.slice(menuImportStart, reportStart),
    /assertMenuMatchesSource\(activeMenu\)/,
  );
  assert.match(seedSource, /prices:\s*menu\.reduce/);
  assert.match(seedSource, /skippedRecords:\s*\[\]/);
  assert.match(seedSource, /duplicateCandidates/);
  assert.match(seedSource, /unresolvedIssues:\s*\[\]/);
});
