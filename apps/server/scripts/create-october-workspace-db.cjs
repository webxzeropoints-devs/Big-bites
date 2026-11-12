const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const dotenv = require("dotenv");
const ExcelJS = require("exceljs");
const { Client } = require("pg");

const serverDirectory = path.resolve(__dirname, "..");
const workspaceDirectory = path.resolve(serverDirectory, "..", "..");
const environmentPath = path.join(serverDirectory, ".env");
const targetDatabaseName = "bigbites_october2026";
const workingDatabaseName = `${targetDatabaseName}_setup`;
const workbookPath = path.join(workspaceDirectory, "October 2026 (3).xlsx");
const menuDirectory = path.join(workspaceDirectory, "menu");

dotenv.config({ path: environmentPath });

function requireValue(value, message) {
  if (value === undefined || value === null || value === "") {
    throw new Error(message);
  }
  return value;
}

function numberValue(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label} in workbook.`);
  return parsed;
}

function dateValue(value, label) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Invalid ${label} in workbook.`);
  return parsed;
}

function normalize(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function canonicalizeProductName(value) {
  return String(value).replace(/^shezwan\b/i, "Schezwan").trim();
}

function runPrisma(targetUrl, cliArguments, extraEnvironment = {}) {
  const cliPath = path.join(serverDirectory, "node_modules", "prisma", "build", "index.js");
  const childEnvironment = { ...process.env, ...extraEnvironment, DATABASE_URL: targetUrl.href };
  delete childEnvironment.BIGBITES_INSTALL_BOOTSTRAP;
  const result = spawnSync(process.execPath, [cliPath, ...cliArguments], {
    cwd: serverDirectory,
    env: childEnvironment,
    encoding: "utf8",
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Prisma command failed: ${cliArguments.join(" ")}`);
}

async function loadOrders() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const sheet = workbook.getWorksheet("Orders");
  if (!sheet) throw new Error('Workbook does not contain an "Orders" sheet.');

  const headers = sheet.getRow(1).values.slice(1).map(String);
  const requiredHeaders = [
    "Order No",
    "Date",
    "Paid At",
    "Table",
    "Items",
    "Subtotal",
    "Discount",
    "GST",
    "GST Status",
    "Final Total",
    "Payment Method",
    "Cash",
    "UPI",
    "Amount Received",
    "Change",
    "Waiter",
  ];
  for (const header of requiredHeaders) {
    if (!headers.includes(header)) throw new Error(`Workbook is missing the "${header}" column.`);
  }

  const orders = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = row.values;
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index + 1]]));
    const id = Number(record["Order No"]);
    if (!Number.isInteger(id) || id <= 0) return;
    orders.push({ rowNumber, id, ...record });
  });

  if (orders.length !== 129) {
    throw new Error(`Expected 129 workbook orders; found ${orders.length}.`);
  }
  if (new Set(orders.map((order) => order.id)).size !== orders.length) {
    throw new Error("Workbook contains duplicate order numbers.");
  }
  return orders;
}

function parseOrderItems(value, rowNumber) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Order row ${rowNumber} has no item details.`);
  }

  return value.split(/\s*,\s*/).map((part) => {
    const match = part.match(/^(.*?)\s*[x×]\s*(\d+)\s*$/i);
    if (!match || !match[1].trim()) {
      throw new Error(`Order row ${rowNumber} contains an unrecognized item: ${part}`);
    }
    return {
      label: canonicalizeProductName(match[1]),
      quantity: Number(match[2]),
    };
  });
}

function buildCatalog(products, variants) {
  const productsByName = new Map(products.map((product) => [normalize(product.name), product]));
  const variantsByName = new Map();
  const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
  for (const variant of variants) {
    const product = products.find((candidate) => candidate.id === variant.productId);
    if (product) variantsByName.set(normalize(`${product.name} ${variant.name}`), variant);
  }
  return { productsByName, variantsByName, variantsById };
}

function resolveItem(label, catalog) {
  const key = normalize(label);
  const variant = catalog.variantsByName.get(key);
  if (variant) {
    return { product: catalog.productsById.get(variant.productId), variant, unknown: false };
  }
  const product = catalog.productsByName.get(key);
  if (product) return { product, variant: null, unknown: false };
  return { product: null, variant: null, unknown: true };
}

function planOrderItems(orders, catalog) {
  const unknownProducts = new Map();
  const plans = orders.map((order) => {
    const items = parseOrderItems(order.Items, order.rowNumber).map((item) => ({
      ...item,
      ...resolveItem(item.label, catalog),
    }));
    const unknownItems = items.filter((item) => item.unknown);
    if (unknownItems.length > 1) {
      throw new Error(`Order ${order.id} contains multiple items not found in the menu.`);
    }

    const knownSubtotal = items.reduce((sum, item) => {
      if (item.unknown) return sum;
      const price = item.variant ? item.variant.price : item.product.price;
      return sum + Number(price) * item.quantity;
    }, 0);
    const sourceSubtotal = numberValue(order.Subtotal, `subtotal on row ${order.rowNumber}`);

    if (unknownItems.length === 0 && Math.abs(knownSubtotal - sourceSubtotal) > 0.01) {
      throw new Error(`Menu prices do not reconcile with the subtotal for order ${order.id}.`);
    }

    if (unknownItems.length === 1) {
      const unknownItem = unknownItems[0];
      const inferredPrice = (sourceSubtotal - knownSubtotal) / unknownItem.quantity;
      if (inferredPrice < 0 || Math.abs(inferredPrice * 100 - Math.round(inferredPrice * 100)) > 0.001) {
        throw new Error(`Could not infer a valid historical price for order ${order.id}.`);
      }
      const key = normalize(unknownItem.label);
      const prior = unknownProducts.get(key);
      if (prior && Math.abs(prior.price - inferredPrice) > 0.01) {
        throw new Error(`Historical price for "${unknownItem.label}" is inconsistent.`);
      }
      unknownProducts.set(key, {
        name: unknownItem.label,
        price: inferredPrice,
        categoryName: "Rice & Noodles (Non Veg)",
      });
      unknownItem.inferredPrice = inferredPrice;
    }

    return { order, items };
  });

  return { plans, unknownProducts };
}

function parseTable(value, rowNumber) {
  if (value === "Parcel") return { number: 0, isParcel: true };
  const match = String(value).match(/^Table\s+(\d+)$/i);
  if (!match) throw new Error(`Order row ${rowNumber} has an unknown table.`);
  return { number: Number(match[1]), isParcel: false };
}

function updateEnvironment(targetUrl) {
  const content = fs.readFileSync(environmentPath, "utf8");
  if (!/^\s*DATABASE_URL\s*=/m.test(content)) {
    throw new Error("apps/server/.env does not define DATABASE_URL.");
  }
  const updated = content.replace(
    /^(\s*DATABASE_URL\s*=).*/m,
    (_line, prefix) => `${prefix}"${targetUrl.href}"`,
  );
  const temporaryPath = `${environmentPath}.tmp`;
  fs.writeFileSync(temporaryPath, updated, { mode: 0o600 });
  fs.renameSync(temporaryPath, environmentPath);
}

async function main() {
  if (!fs.existsSync(workbookPath)) throw new Error("The October workbook was not found.");
  if (!fs.existsSync(menuDirectory) || fs.readdirSync(menuDirectory).length === 0) {
    throw new Error("The menu image directory is missing or empty.");
  }

  const sourceUrl = new URL(requireValue(process.env.DATABASE_URL, "DATABASE_URL is not configured."));
  if (!new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(sourceUrl.hostname.toLowerCase())) {
    throw new Error("The existing database must be local for this import.");
  }
  if (decodeURIComponent(sourceUrl.pathname.replace(/^\/+/, "")) === targetDatabaseName) {
    throw new Error("The configured source database is already the target database.");
  }

  const workingUrl = new URL(sourceUrl.href);
  workingUrl.pathname = `/${workingDatabaseName}`;
  const targetUrl = new URL(sourceUrl.href);
  targetUrl.pathname = `/${targetDatabaseName}`;
  const orders = await loadOrders();

  const sourceClient = new Client({ connectionString: sourceUrl.href });
  await sourceClient.connect();
  const databaseCheck = await sourceClient.query(
    "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS target_exists, has_database_privilege(current_user, current_database(), 'CREATE') AS can_create",
    [targetDatabaseName],
  );
  const workingCheck = await sourceClient.query(
    "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS working_exists",
    [workingDatabaseName],
  );
  if (databaseCheck.rows[0].target_exists || workingCheck.rows[0].working_exists) {
    await sourceClient.end();
    throw new Error("Target or temporary database already exists; refusing to modify it.");
  }
  if (!databaseCheck.rows[0].can_create) {
    await sourceClient.end();
    throw new Error("The current PostgreSQL account cannot create a database.");
  }

  const usersResult = await sourceClient.query(
    'SELECT id, name, username, password, role, "createdAt", "updatedAt" FROM public."User" ORDER BY id',
  );
  if (usersResult.rows.length === 0) {
    await sourceClient.end();
    throw new Error("The existing database contains no login accounts to copy.");
  }

  await sourceClient.query(`CREATE DATABASE "${workingDatabaseName}"`);
  await sourceClient.end();

  runPrisma(workingUrl, ["migrate", "deploy"]);
  const tsxPath = path.join(serverDirectory, "node_modules", "tsx", "dist", "cli.mjs");
  const seedResult = spawnSync(process.execPath, [tsxPath, "prisma/seed/seed.ts"], {
    cwd: serverDirectory,
    env: {
      ...process.env,
      DATABASE_URL: workingUrl.href,
      CONFIRM_MENU_SEED: "YES_UPDATE_MENU_ONLY",
    },
    encoding: "utf8",
  });
  if (seedResult.stdout) process.stdout.write(seedResult.stdout);
  if (seedResult.stderr) process.stderr.write(seedResult.stderr);
  if (seedResult.error) throw seedResult.error;
  if (seedResult.status !== 0) throw new Error("Menu seed failed.");

  const targetClient = new Client({ connectionString: workingUrl.href });
  await targetClient.connect();

  try {
    const catalogResult = await targetClient.query(
      'SELECT id, name, price::text AS price, "categoryId" FROM public."Product" WHERE "isActive" = true',
    );
    const variantsResult = await targetClient.query(
      'SELECT id, name, price::text AS price, "productId" FROM public."ProductVariant" WHERE "isActive" = true',
    );
    const categoriesResult = await targetClient.query(
      'SELECT id, name FROM public."Category"',
    );
    const products = catalogResult.rows.map((product) => ({
      ...product,
      price: Number(product.price),
    }));
    const variants = variantsResult.rows.map((variant) => ({
      ...variant,
      price: Number(variant.price),
    }));
    const categoryIds = new Map(categoriesResult.rows.map((category) => [category.name, category.id]));
    const catalog = buildCatalog(products, variants);
    catalog.productsById = new Map(products.map((product) => [product.id, product]));
    const { plans, unknownProducts } = planOrderItems(orders, catalog);
    const usersByName = new Map(usersResult.rows.map((user) => [user.name, user]));
    for (const { order } of plans) {
      if (!usersByName.has(order.Waiter)) {
        throw new Error(`No copied login account matches waiter "${order.Waiter}".`);
      }
      parseTable(order.Table, order.rowNumber);
    }

    await targetClient.query("BEGIN");
    for (const user of usersResult.rows) {
      await targetClient.query(
        'INSERT INTO public."User" (id, name, username, password, role, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [user.id, user.name, user.username, user.password, user.role, user.createdAt, user.updatedAt],
      );
    }

    const tableIds = new Map();
    for (const number of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      const existing = await targetClient.query(
        'SELECT id, "isParcel" FROM public."RestaurantTable" WHERE number = $1',
        [number],
      );
      if (existing.rows.length > 0) {
        if (number !== 0 || existing.rows[0].isParcel !== true) {
          throw new Error(`Unexpected pre-existing table ${number} in the new database.`);
        }
        tableIds.set(number, existing.rows[0].id);
        continue;
      }
      const inserted = await targetClient.query(
        'INSERT INTO public."RestaurantTable" (number, "isParcel", status, "updatedAt") VALUES ($1, $2, $3, CURRENT_TIMESTAMP) RETURNING id',
        [number, number === 0, "AVAILABLE"],
      );
      tableIds.set(number, inserted.rows[0].id);
    }

    for (const [key, unknownProduct] of unknownProducts) {
      const categoryId = categoryIds.get(unknownProduct.categoryName);
      if (!categoryId) throw new Error("The historical item category was not seeded.");
      const slug = `historical-${normalize(unknownProduct.name)}`;
      const inserted = await targetClient.query(
        'INSERT INTO public."Product" (slug, name, description, price, "isVegetarian", classification, subcategory, "isSignature", "isActive", "categoryId", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, false, $5, $6, false, false, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id, name, price::text AS price, "categoryId"',
        [slug, unknownProduct.name, "Imported for historical order records", unknownProduct.price, "NON_VEG", "Historical", categoryId],
      );
      const product = { ...inserted.rows[0], price: Number(inserted.rows[0].price) };
      catalog.productsByName.set(key, product);
      catalog.productsById.set(product.id, product);
    }

    for (const { order, items } of plans) {
      const table = parseTable(order.Table, order.rowNumber);
      const waiter = usersByName.get(order.Waiter);
      const createdAt = dateValue(order.Date, `date on row ${order.rowNumber}`);
      const paidAt = order["Paid At"] ? dateValue(order["Paid At"], `payment date on row ${order.rowNumber}`) : null;
      const discountAmount = numberValue(order.Discount ?? 0, `discount on row ${order.rowNumber}`);
      const total = numberValue(order["Final Total"], `total on row ${order.rowNumber}`);
      const method = String(order["Payment Method"] ?? "").toUpperCase();
      if (!["CASH", "UPI", "CASH_UPI"].includes(method)) {
        throw new Error(`Order ${order.id} has an unsupported payment method.`);
      }

      await targetClient.query(
        'INSERT INTO public."Order" (id, status, total, "gstRate", "gstEnabled", "discountType", "discountValue", "discountAmount", "createdAt", "updatedAt", "tableId", "waiterId") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11)',
        [order.id, "COMPLETED", total, numberValue(order.GST ?? 0, `GST on row ${order.rowNumber}`), String(order["GST Status"]).toUpperCase() !== "OFF", discountAmount > 0 ? "AMOUNT" : null, discountAmount > 0 ? discountAmount : null, discountAmount, createdAt, tableIds.get(table.number), waiter.id],
      );

      for (const item of items) {
        const key = normalize(item.label);
        const product = item.product ?? catalog.productsByName.get(key);
        if (!product) throw new Error(`Could not resolve historical item "${item.label}".`);
        const variant = item.variant ?? null;
        const unitPrice = item.inferredPrice ?? (variant ? variant.price : product.price);
        await targetClient.query(
          'INSERT INTO public."OrderItem" (quantity, "unitPrice", subtotal, "variantId", "orderId", "productId") VALUES ($1, $2, $3, $4, $5, $6)',
          [item.quantity, unitPrice, item.quantity * unitPrice, variant?.id ?? null, order.id, product.id],
        );
      }

      await targetClient.query(
        'INSERT INTO public."Payment" (amount, "amountReceived", change, "cashAmount", "upiAmount", method, status, "paidAt", "createdAt", "orderId") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [total, order["Amount Received"] == null ? null : numberValue(order["Amount Received"], `received amount on row ${order.rowNumber}`), order.Change == null ? null : numberValue(order.Change, `change on row ${order.rowNumber}`), order.Cash == null ? null : numberValue(order.Cash, `cash amount on row ${order.rowNumber}`), order.UPI == null ? null : numberValue(order.UPI, `UPI amount on row ${order.rowNumber}`), method, "PAID", paidAt, paidAt ?? createdAt, order.id],
      );
    }

    await targetClient.query(
      `SELECT setval(pg_get_serial_sequence('public."User"', 'id'), (SELECT MAX(id) FROM public."User"), true)`,
    );
    await targetClient.query(
      `SELECT setval(pg_get_serial_sequence('public."Order"', 'id'), (SELECT MAX(id) FROM public."Order"), true)`,
    );
    await targetClient.query("COMMIT");
  } catch (error) {
    await targetClient.query("ROLLBACK");
    throw error;
  } finally {
    await targetClient.end();
  }

  const renameClient = new Client({ connectionString: sourceUrl.href });
  await renameClient.connect();
  try {
    await renameClient.query(`ALTER DATABASE "${workingDatabaseName}" RENAME TO "${targetDatabaseName}"`);
  } finally {
    await renameClient.end();
  }

  updateEnvironment(targetUrl);
  console.log(
    `Created ${targetDatabaseName}, copied ${usersResult.rows.length} login accounts only, seeded the menu, and imported ${orders.length} historical orders. apps/server/.env now points to the new database.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Database setup failed.");
  process.exitCode = 1;
});