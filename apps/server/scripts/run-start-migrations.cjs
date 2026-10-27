const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");
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

assertSafeMigrationSet(path.resolve(process.cwd(), "prisma/migrations"));

const prismaCli = path.resolve(
  __dirname,
  "../node_modules/prisma/build/index.js",
);

execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
  cwd: process.cwd(),
  stdio: "inherit",
});
