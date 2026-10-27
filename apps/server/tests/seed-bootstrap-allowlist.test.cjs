const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const seedPath = path.join(
  __dirname,
  "..",
  "prisma",
  "seed",
  "seed.ts",
);
const schemaPath = path.join(__dirname, "..", "prisma", "schema.prisma");
const seedSource = fs.readFileSync(seedPath, "utf8");
const schemaSource = fs.readFileSync(schemaPath, "utf8");
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
  assert.equal(canonicalModels.includes("ProductStockMovement"), false);
  assert.deepEqual(
    canonicalModels.filter((model) => !allowedTables.has(model)),
    [],
  );
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
