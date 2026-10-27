const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const serverRoot = path.resolve(__dirname, "..");
const outputRoot = path.join(serverRoot, ".windows-runtime");
const markerName = ".bigbites-generated-runtime.json";
const formatVersion = 1;
const runtimeAssetExclusions = [
  "@prisma/studio-core/dist/ui",
  "@prisma/studio-core/dist/metafile-cjs.json",
  "@prisma/studio-core/dist/metafile-esm.json",
  "@prisma/dev/dist/runtime-assets",
];

function assertNoReparsePoints(root) {
  const entries = [root];
  while (entries.length > 0) {
    const current = entries.pop();
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`Unexpected reparse point in generated runtime: ${current}`);
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        entries.push(path.join(current, entry));
      }
    }
  }
}

function removeVerifiedRuntimeAsset(nodeModulesRoot, relativePath) {
  const target = path.resolve(nodeModulesRoot, relativePath);
  const prefix = `${path.resolve(nodeModulesRoot)}${path.sep}`;
  if (!target.startsWith(prefix)) {
    throw new Error(`Runtime exclusion escaped node_modules: ${relativePath}`);
  }
  if (!fs.existsSync(target)) {
    throw new Error(`Expected Prisma runtime asset was not found: ${relativePath}`);
  }
  assertNoReparsePoints(target);
  fs.rmSync(target, { recursive: true, force: false });
}

function verifyRuntimePackage(runtimeRoot) {
  const nodeModulesRoot = path.join(runtimeRoot, "node_modules");
  const requiredPaths = [
    "@prisma/adapter-pg/package.json",
    "@prisma/client/package.json",
    "@prisma/client/index.js",
    "@prisma/engines/schema-engine-windows.exe",
    "cors/package.json",
    "dotenv/package.json",
    "exceljs/package.json",
    "express/package.json",
    "pg/package.json",
    "prisma/build/index.js",
    "socket.io/package.json",
    ".prisma/client/index.js",
  ];
  for (const relativePath of requiredPaths) {
    const target = path.join(nodeModulesRoot, relativePath);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      throw new Error(`Required production runtime file is missing: ${relativePath}`);
    }
  }

  const imports = spawnSync(
    process.execPath,
    [
      "-e",
      "const { PrismaClient } = require('@prisma/client'); " +
        "const { PrismaPg } = require('@prisma/adapter-pg'); " +
        "for (const name of ['cors', 'dotenv', 'exceljs', 'express', 'pg', 'socket.io']) require(name); " +
        "if (!PrismaClient || !PrismaPg) process.exit(1);",
    ],
    { cwd: runtimeRoot, encoding: "utf8" },
  );
  if (imports.error || imports.status !== 0) {
    throw new Error(
      `Production runtime import validation failed: ${imports.stderr || imports.error}`,
    );
  }

  const migration = spawnSync(
    process.execPath,
    [
      path.join(nodeModulesRoot, "prisma", "build", "index.js"),
      "migrate",
      "deploy",
      "--schema",
      "prisma/schema.prisma",
    ],
    {
      cwd: runtimeRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL:
          "postgresql://127.0.0.1:1/bigbites_package_smoke_only?schema=public",
      },
    },
  );
  const migrationOutput = `${migration.stdout || ""}\n${migration.stderr || ""}`;
  if (
    migration.error ||
    migration.status === 0 ||
    !/P1001|Can't reach database server/i.test(migrationOutput)
  ) {
    throw new Error(
      `Prisma migration runtime validation did not reach the expected isolated loopback failure: ${migrationOutput || migration.error}`,
    );
  }
}

function isManagedRuntime(runtimeRoot) {
  const stat = fs.lstatSync(runtimeRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Refusing to replace an unrecognized Windows runtime path.");
  }
  const markerPath = path.join(runtimeRoot, markerName);
  if (!fs.existsSync(markerPath) || !fs.lstatSync(markerPath).isFile()) {
    throw new Error("Refusing to replace a runtime directory without its ownership marker.");
  }
  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  if (
    marker.formatVersion !== formatVersion ||
    marker.generatedBy !== "prepare-windows-runtime.cjs" ||
    marker.packageName !== "server"
  ) {
    throw new Error("Refusing to replace a runtime directory with an invalid ownership marker.");
  }
  return true;
}

function main() {
  const stageRoot = path.join(
    serverRoot,
    `.windows-runtime-staging-${process.pid}-${crypto.randomUUID()}`,
  );
  const backupRoot = path.join(
    serverRoot,
    `.windows-runtime-backup-${process.pid}-${crypto.randomUUID()}`,
  );
  let previousRuntimeMoved = false;

  try {
    fs.mkdirSync(stageRoot);
    fs.mkdirSync(path.join(stageRoot, "prisma"));
    for (const file of ["package.json", "package-lock.json", "prisma.config.ts"]) {
      fs.copyFileSync(path.join(serverRoot, file), path.join(stageRoot, file));
    }
    fs.copyFileSync(
      path.join(serverRoot, "prisma", "schema.prisma"),
      path.join(stageRoot, "prisma", "schema.prisma"),
    );

    const npmCli = process.env.npm_execpath;
    if (!npmCli || !path.isAbsolute(npmCli)) {
      throw new Error("Run Windows runtime packaging through the project npm script.");
    }
    const install = spawnSync(
      process.execPath,
      [npmCli, "ci", "--omit=dev", "--no-audit", "--no-fund"],
      {
        cwd: stageRoot,
        env: {
          ...process.env,
          DATABASE_URL:
            "postgresql://127.0.0.1:1/bigbites_package_codegen_only?schema=public",
        },
        stdio: "inherit",
      },
    );
    if (install.error || install.status !== 0) {
      throw new Error(
        `Could not prepare the isolated production dependency set: ${install.error || `npm exited with ${install.status}`}`,
      );
    }

    const nodeModulesRoot = path.join(stageRoot, "node_modules");
    for (const relativePath of runtimeAssetExclusions) {
      removeVerifiedRuntimeAsset(nodeModulesRoot, relativePath);
    }
    verifyRuntimePackage(stageRoot);

    const lockHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(stageRoot, "package-lock.json")))
      .digest("hex");
    fs.writeFileSync(
      path.join(stageRoot, markerName),
      `${JSON.stringify(
        {
          formatVersion,
          generatedBy: "prepare-windows-runtime.cjs",
          packageName: "server",
          packageLockSha256: lockHash,
          excludedRuntimeAssets: runtimeAssetExclusions,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    if (fs.existsSync(outputRoot)) {
      isManagedRuntime(outputRoot);
      assertNoReparsePoints(outputRoot);
      fs.renameSync(outputRoot, backupRoot);
      previousRuntimeMoved = true;
    }
    fs.renameSync(stageRoot, outputRoot);

    if (previousRuntimeMoved) {
      fs.rmSync(backupRoot, { recursive: true, force: false });
      previousRuntimeMoved = false;
    }

    const files = [];
    const pending = [path.join(outputRoot, "node_modules")];
    let bytes = 0;
    while (pending.length > 0) {
      const current = pending.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          pending.push(entryPath);
        } else if (entry.isFile()) {
          files.push(entryPath);
          bytes += fs.statSync(entryPath).size;
        } else {
          throw new Error(`Unexpected filesystem entry in runtime package: ${entryPath}`);
        }
      }
    }
    console.log(
      `Prepared production-only Windows server runtime: ${files.length} files, ${bytes} bytes.`,
    );
  } catch (error) {
    if (previousRuntimeMoved && !fs.existsSync(outputRoot)) {
      fs.renameSync(backupRoot, outputRoot);
      previousRuntimeMoved = false;
    }
    throw error;
  } finally {
    if (fs.existsSync(stageRoot)) {
      fs.rmSync(stageRoot, { recursive: true, force: false });
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = { runtimeAssetExclusions };
