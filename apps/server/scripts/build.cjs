const { spawnSync } = require("node:child_process");
const path = require("node:path");

const serverRoot = path.resolve(__dirname, "..");
const localCodegenUrl =
  "postgresql://127.0.0.1:1/bigbites_codegen_only?schema=public";
const prismaCli = path.resolve(
  serverRoot,
  "node_modules/prisma/build/index.js",
);
const prisma = spawnSync(process.execPath, [prismaCli, "generate"], {
  cwd: serverRoot,
  env: { ...process.env, DATABASE_URL: localCodegenUrl },
  stdio: "inherit",
});
if (prisma.error) {
  throw prisma.error;
}
if (prisma.status !== 0) {
  process.exit(prisma.status ?? 1);
}

const typeScriptCli = path.resolve(
  serverRoot,
  "node_modules/typescript/bin/tsc",
);
const build = spawnSync(process.execPath, [typeScriptCli], {
  cwd: serverRoot,
  stdio: "inherit",
});
if (build.error) {
  throw build.error;
}
process.exit(build.status ?? 1);
