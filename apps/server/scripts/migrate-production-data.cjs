const { Client } = require("pg");

const DATABASE_FIELDS = {
  Category: ["id", "name", "sortOrder", "createdAt", "updatedAt"],
  Product: [
    "id",
    "slug",
    "name",
    "description",
    "price",
    "isVegetarian",
    "classification",
    "subcategory",
    "isSignature",
    "isActive",
    "createdAt",
    "updatedAt",
    "categoryId",
  ],
  ProductVariant: [
    "id",
    "name",
    "price",
    "isActive",
    "createdAt",
    "updatedAt",
    "productId",
  ],
  RestaurantTable: [
    "id",
    "number",
    "isParcel",
    "status",
    "createdAt",
    "updatedAt",
  ],
  User: ["id", "name", "username", "password", "role", "createdAt", "updatedAt"],
  RestaurantSettings: [
    "id",
    "gstRate",
    "gstEnabled",
    "orderReportsPath",
    "restaurantAddress",
    "fssaiEnabled",
    "fssaiNumber",
    "gstinEnabled",
    "gstinNumber",
    "createdAt",
    "updatedAt",
  ],
  Order: [
    "id",
    "status",
    "total",
    "gstRate",
    "gstEnabled",
    "discountType",
    "discountValue",
    "discountAmount",
    "createdAt",
    "updatedAt",
    "tableId",
    "waiterId",
  ],
  OrderItem: [
    "id",
    "quantity",
    "unitPrice",
    "subtotal",
    "variantId",
    "orderId",
    "productId",
  ],
  Payment: [
    "id",
    "amount",
    "amountReceived",
    "change",
    "cashAmount",
    "upiAmount",
    "method",
    "status",
    "paidAt",
    "createdAt",
    "orderId",
  ],
};

const TABLES = [
  "Category",
  "Product",
  "ProductVariant",
  "RestaurantTable",
  "User",
  "RestaurantSettings",
  "Order",
  "OrderItem",
  "Payment",
];
const REQUIRED_SOURCE_TABLES = TABLES;
const SERIAL_TABLES = [
  "Category",
  "Product",
  "ProductVariant",
  "RestaurantTable",
  "User",
  "Order",
  "OrderItem",
  "Payment",
];

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function inspectUrl(raw, label) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} database URL is missing or invalid.`);
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error(`${label} must use PostgreSQL.`);
  }
  return url;
}

function isLoopback(hostname) {
  return ["127.0.0.1", "localhost", "::1"].includes(hostname.toLowerCase());
}

function validateEndpoints(sourceUrl, targetUrl, nodeEnv = process.env.NODE_ENV) {
  const source = inspectUrl(sourceUrl, "Source");
  const target = inspectUrl(targetUrl, "Target");
  const sourceDatabase = decodeURIComponent(source.pathname.slice(1));
  const targetDatabase = decodeURIComponent(target.pathname.slice(1));

  const isApprovedClone =
    nodeEnv === "test" &&
    isLoopback(source.hostname) &&
    !!source.port &&
    source.port !== "5432" &&
    sourceDatabase === "bigbites_test_production_clone";
  if (!isApprovedClone) {
    throw new Error(
      "Source must be the isolated loopback bigbites_test_production_clone database on a non-default port.",
    );
  }

  if (
    nodeEnv !== "test" ||
    !isLoopback(target.hostname) ||
    !target.port ||
    target.port === "5432" ||
    !/^bigbites_test_[a-z0-9_]+$/i.test(targetDatabase)
  ) {
    throw new Error(
      "Writes are restricted to a non-5432 loopback database named bigbites_test_* while NODE_ENV=test.",
    );
  }

  if (
    source.hostname.toLowerCase() === target.hostname.toLowerCase() &&
    (source.port || "5432") === target.port &&
    sourceDatabase === targetDatabase
  ) {
    throw new Error("Source and target must be different databases.");
  }
}

function normalizeValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("hex");
  return value;
}

function sameRow(left, right, fields) {
  return fields.every(
    (field) =>
      JSON.stringify(normalizeValue(left[field] ?? null)) ===
      JSON.stringify(normalizeValue(right[field] ?? null)),
  );
}

function requireSameRow(table, id, fields, existing, incoming) {
  if (!sameRow(existing, incoming, fields)) {
    throw new Error(
      `Conflict at ${table} id=${id}; source and local history differ. The transaction was rolled back.`,
    );
  }
}

function toMinorUnits(value) {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new Error("Unexpected monetary value in migration data.");
  const sign = match[1] === "-" ? -1n : 1n;
  return sign * (BigInt(match[2]) * 100n + BigInt((match[3] || "").padEnd(2, "0")));
}

function formatMinorUnits(value) {
  const sign = value < 0n ? "-" : "";
  const magnitude = value < 0n ? -value : value;
  return `${sign}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, "0")}`;
}

function sumMoney(rows, field) {
  return formatMinorUnits(rows.reduce((sum, row) => sum + toMinorUnits(row[field]), 0n));
}

async function readColumns(client, table) {
  const result = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return new Set(result.rows.map((row) => row.column_name));
}

async function readSourceRows(client, table, availableColumns) {
  if (!availableColumns.has(table)) return [];
  const fields = DATABASE_FIELDS[table].filter((field) =>
    availableColumns.get(table).has(field),
  );
  const missing = DATABASE_FIELDS[table].filter(
    (field) => !availableColumns.get(table).has(field),
  );
  const supportedMissingPaymentFields = new Set(["cashAmount", "upiAmount"]);
  if (
    missing.length &&
    (table !== "Payment" ||
      missing.some((field) => !supportedMissingPaymentFields.has(field)))
  ) {
    throw new Error(
      `Source ${table} schema is missing required fields: ${missing.join(", ")}.`,
    );
  }

  const expressions = DATABASE_FIELDS[table].map((field) =>
    fields.includes(field)
      ? quoteIdentifier(field)
      : `NULL AS ${quoteIdentifier(field)}`,
  );
  const orderBy = fields.includes("id") ? ' ORDER BY "id"' : "";
  const result = await client.query(
    `SELECT ${expressions.join(", ")} FROM ${quoteIdentifier(table)}${orderBy}`,
  );
  return result.rows;
}

function validateSourceSchema(availableColumns) {
  const missing = [];
  for (const table of REQUIRED_SOURCE_TABLES) {
    const columns = availableColumns.get(table);
    if (!columns) {
      missing.push(`${table} (table)`);
      continue;
    }
    const supportedMissingPaymentFields = new Set(["cashAmount", "upiAmount"]);
    for (const field of DATABASE_FIELDS[table]) {
      if (
        !columns.has(field) &&
        !(table === "Payment" && supportedMissingPaymentFields.has(field))
      ) {
        missing.push(`${table}.${field}`);
      }
    }
  }
  if (missing.length) {
    throw new Error(
      `Source schema is incomplete; refusing partial migration: ${missing.join(", ")}.`,
    );
  }
}

async function insertRow(client, table, row, fields, includeId = true) {
  const selected = includeId ? fields : fields.filter((field) => field !== "id");
  const values = selected.map((field) => row[field] ?? null);
  const columns = selected.map(quoteIdentifier).join(", ");
  const placeholders = selected.map((_, index) => `$${index + 1}`).join(", ");
  const result = await client.query(
    `INSERT INTO ${quoteIdentifier(table)} (${columns})
     VALUES (${placeholders}) RETURNING "id"`,
    values,
  );
  return result.rows[0].id;
}

async function updateRow(client, table, id, row, fields) {
  const values = fields.filter((field) => field !== "id");
  await client.query(
    `UPDATE ${quoteIdentifier(table)} SET ${values
      .map((field, index) => `${quoteIdentifier(field)} = $${index + 1}`)
      .join(", ")}
     WHERE "id" = $${values.length + 1}`,
    [...values.map((field) => row[field] ?? null), id],
  );
}

async function mapById(client, table) {
  const result = await client.query(`SELECT * FROM ${quoteIdentifier(table)}`);
  return new Map(result.rows.map((row) => [Number(row.id), row]));
}

async function assertTargetSchema(client, targetColumns) {
  const missing = [];
  for (const table of TABLES) {
    const columns = targetColumns.get(table);
    if (!columns) {
      missing.push(`${table} (table)`);
      continue;
    }
    for (const field of DATABASE_FIELDS[table]) {
      if (!columns.has(field)) missing.push(`${table}.${field}`);
    }
  }
  if (missing.length) {
    throw new Error(
      `Destination schema is not migration-ready: ${missing.join(", ")}.`,
    );
  }
}

async function verifyMappedIds(client, table, mapping, sourceCount) {
  const ids = [...mapping.values()];
  if (ids.length !== sourceCount || new Set(ids).size !== ids.length) {
    throw new Error(
      `Source ${table} rows do not have a one-to-one destination mapping.`,
    );
  }
  if (!ids.length) return;
  const result = await client.query(
    `SELECT count(*)::int AS count
     FROM ${quoteIdentifier(table)}
     WHERE "id" = ANY($1::int[])`,
    [ids],
  );
  if (result.rows[0].count !== ids.length) {
    throw new Error(`Destination ${table} mapping count did not validate.`);
  }
}

async function verifyForeignKeys(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::int FROM "Product" p LEFT JOIN "Category" c ON c.id = p."categoryId" WHERE c.id IS NULL) AS products,
      (SELECT count(*)::int FROM "ProductVariant" v LEFT JOIN "Product" p ON p.id = v."productId" WHERE p.id IS NULL) AS variants,
      (SELECT count(*)::int FROM "Order" o LEFT JOIN "RestaurantTable" t ON t.id = o."tableId" WHERE t.id IS NULL) AS order_tables,
      (SELECT count(*)::int FROM "Order" o LEFT JOIN "User" u ON u.id = o."waiterId" WHERE u.id IS NULL) AS order_users,
      (SELECT count(*)::int FROM "OrderItem" i LEFT JOIN "Order" o ON o.id = i."orderId" WHERE o.id IS NULL) AS item_orders,
      (SELECT count(*)::int FROM "OrderItem" i LEFT JOIN "Product" p ON p.id = i."productId" WHERE p.id IS NULL) AS item_products,
      (SELECT count(*)::int FROM "OrderItem" i LEFT JOIN "ProductVariant" v ON v.id = i."variantId" WHERE i."variantId" IS NOT NULL AND v.id IS NULL) AS item_variants,
      (SELECT count(*)::int FROM "Payment" p LEFT JOIN "Order" o ON o.id = p."orderId" WHERE o.id IS NULL) AS payments
  `);
  if (Object.values(result.rows[0]).some((count) => count !== 0)) {
    throw new Error("Destination foreign-key integrity validation failed.");
  }
}

async function readAllSourceData(source) {
  const catalog = await source.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'`,
  );
  const columns = new Map();
  for (const row of catalog.rows) {
    if (!columns.has(row.table_name)) columns.set(row.table_name, new Set());
    columns.get(row.table_name).add(row.column_name);
  }
  validateSourceSchema(columns);

  const data = {};
  for (const table of TABLES) {
    data[table] = await readSourceRows(source, table, columns);
  }
  return data;
}

async function upsertDimensionById(client, table, row, fields, existingById, counters) {
  const id = Number(row.id);
  const existing = existingById.get(id);
  if (existing) {
    if (sameRow(existing, row, fields)) {
      counters.unchanged[table]++;
      return id;
    }
    const insertedId = await insertRow(client, table, row, fields, false);
    existingById.set(Number(insertedId), {
      ...row,
      id: Number(insertedId),
    });
    counters.inserted[table]++;
    return Number(insertedId);
  }

  const insertedId = await insertRow(client, table, row, fields);
  existingById.set(Number(insertedId), {
    ...row,
    id: Number(insertedId),
  });
  counters.inserted[table]++;
  return Number(insertedId);
}

async function upsertOrderHistory(client, table, row, fields, counters) {
  const existing = await client.query(
    `SELECT * FROM ${quoteIdentifier(table)} WHERE "id" = $1`,
    [row.id],
  );
  if (existing.rowCount) {
    requireSameRow(table, row.id, fields, existing.rows[0], row);
    counters.unchanged[table]++;
    return;
  }

  if (table === "Payment") {
    const sameOrder = await client.query(
      'SELECT "id" FROM "Payment" WHERE "orderId" = $1',
      [row.orderId],
    );
    if (sameOrder.rowCount) {
      throw new Error(
        `Conflict at Payment orderId=${row.orderId}; the local payment is not the same source payment. The transaction was rolled back.`,
      );
    }
  }

  await insertRow(client, table, row, fields);
  counters.inserted[table]++;
  const inserted = await client.query(
    `SELECT * FROM ${quoteIdentifier(table)} WHERE "id" = $1`,
    [row.id],
  );
  if (!inserted.rowCount) {
    throw new Error(`Inserted ${table} id=${row.id} could not be read back.`);
  }
  requireSameRow(table, row.id, fields, inserted.rows[0], row);
}

async function mapCategories(client, sourceRows, byId, counters) {
  const byName = new Map();
  for (const row of byId.values()) {
    if (byName.has(row.name)) {
      throw new Error("Destination contains duplicate category names.");
    }
    byName.set(row.name, row);
  }
  const map = new Map();
  for (const source of sourceRows) {
    const matched = byName.get(source.name);
    if (matched) {
      const updates = {
        ...source,
        id: matched.id,
      };
      if (matched.sortOrder !== source.sortOrder) {
        await updateRow(client, "Category", matched.id, updates, [
          "id",
          "sortOrder",
          "updatedAt",
        ]);
        matched.sortOrder = source.sortOrder;
        matched.updatedAt = source.updatedAt;
        counters.updated.Category++;
      } else {
        counters.unchanged.Category++;
      }
      map.set(Number(source.id), Number(matched.id));
      continue;
    }
    map.set(
      Number(source.id),
      await upsertDimensionById(
        client,
        "Category",
        source,
        DATABASE_FIELDS.Category,
        byId,
        counters,
      ),
    );
  }
  return map;
}

async function mapProducts(client, sourceRows, categoryMap, counters) {
  const existingRows = await client.query('SELECT * FROM "Product"');
  const byId = new Map(existingRows.rows.map((row) => [Number(row.id), row]));
  const bySlug = new Map(existingRows.rows.map((row) => [row.slug, row]));
  const map = new Map();

  for (const source of sourceRows) {
    const categoryId = categoryMap.get(Number(source.categoryId));
    if (!categoryId) {
      throw new Error(
        `Product id=${source.id} refers to an unmapped source category.`,
      );
    }
    let matched = bySlug.get(source.slug);
    if (!matched) {
      const namedMatches = existingRows.rows.filter(
        (candidate) =>
          candidate.name === source.name &&
          Number(candidate.categoryId) === categoryId,
      );
      if (namedMatches.length > 1) {
        throw new Error(
          `Product name/category conflict for source id=${source.id}; multiple local matches exist.`,
        );
      }
      matched = namedMatches[0];
    }

    if (matched) {
      const targetId = Number(matched.id);
      const updated = {
        ...source,
        id: targetId,
        categoryId,
        createdAt: matched.createdAt,
      };
      const updateFields = DATABASE_FIELDS.Product.filter(
        (field) => !["id", "createdAt"].includes(field),
      );
      const changes = updateFields.some(
        (field) =>
          JSON.stringify(normalizeValue(matched[field] ?? null)) !==
          JSON.stringify(normalizeValue(updated[field] ?? null)),
      );
      if (changes) {
        await updateRow(client, "Product", targetId, updated, [
          "id",
          ...updateFields,
        ]);
        for (const field of updateFields) {
          matched[field] = updated[field];
        }
        counters.updated.Product++;
      } else {
        counters.unchanged.Product++;
      }
      map.set(Number(source.id), targetId);
      continue;
    }

    const insertedId = await insertRow(
      client,
      "Product",
      { ...source, categoryId },
      DATABASE_FIELDS.Product,
      !byId.has(Number(source.id)),
    );
    const newRow = { ...source, id: Number(insertedId), categoryId };
    byId.set(Number(insertedId), newRow);
    bySlug.set(source.slug, newRow);
    existingRows.rows.push(newRow);
    map.set(Number(source.id), Number(insertedId));
    counters.inserted.Product++;
  }
  return map;
}

async function mapVariants(client, sourceRows, productMap, counters) {
  const existingRows = await client.query('SELECT * FROM "ProductVariant"');
  const byId = new Map(existingRows.rows.map((row) => [Number(row.id), row]));
  const byKey = new Map(
    existingRows.rows.map((row) => [
      `${row.productId}:${row.name}`,
      row,
    ]),
  );
  const map = new Map();

  for (const source of sourceRows) {
    const productId = productMap.get(Number(source.productId));
    if (!productId) {
      throw new Error(
        `Variant id=${source.id} refers to an unmapped source product.`,
      );
    }
    const key = `${productId}:${source.name}`;
    const matched = byKey.get(key);
    if (matched) {
      const updated = { ...source, id: matched.id, productId };
      const fields = ["price", "isActive", "updatedAt"];
      const changed = fields.some(
        (field) =>
          JSON.stringify(normalizeValue(matched[field] ?? null)) !==
          JSON.stringify(normalizeValue(updated[field] ?? null)),
      );
      if (changed) {
        await updateRow(client, "ProductVariant", matched.id, updated, [
          "id",
          "name",
          "price",
          "isActive",
          "createdAt",
          "updatedAt",
          "productId",
        ]);
        Object.assign(matched, updated);
        counters.updated.ProductVariant++;
      } else {
        counters.unchanged.ProductVariant++;
      }
      map.set(Number(source.id), Number(matched.id));
      continue;
    }

    const insertedId = await insertRow(
      client,
      "ProductVariant",
      { ...source, productId },
      DATABASE_FIELDS.ProductVariant,
      !byId.has(Number(source.id)),
    );
    const newRow = { ...source, id: Number(insertedId), productId };
    byId.set(Number(insertedId), newRow);
    byKey.set(key, newRow);
    map.set(Number(source.id), Number(insertedId));
    counters.inserted.ProductVariant++;
  }
  return map;
}

async function mapTables(client, sourceRows, byId, counters) {
  const byNumber = new Map();
  for (const row of byId.values()) {
    if (byNumber.has(row.number)) {
      throw new Error("Destination contains duplicate restaurant table numbers.");
    }
    byNumber.set(row.number, row);
  }
  const map = new Map();
  for (const source of sourceRows) {
    const matched = byNumber.get(source.number);
    if (matched) {
      if (matched.isParcel !== source.isParcel) {
        throw new Error(
          `Table number=${source.number} maps to a different local table type.`,
        );
      }
      map.set(Number(source.id), Number(matched.id));
      counters.unchanged.RestaurantTable++;
      continue;
    }
    const targetId = await upsertDimensionById(
      client,
      "RestaurantTable",
      source,
      DATABASE_FIELDS.RestaurantTable,
      byId,
      counters,
    );
    const inserted =
      byId.get(targetId) ??
      (await client.query('SELECT * FROM "RestaurantTable" WHERE "id" = $1', [
        targetId,
      ])).rows[0];
    byId.set(targetId, inserted);
    byNumber.set(inserted.number, inserted);
    map.set(Number(source.id), targetId);
  }
  return map;
}

async function mapUsers(client, sourceRows, byId, counters) {
  const byUsername = new Map();
  for (const row of byId.values()) {
    if (byUsername.has(row.username)) {
      throw new Error("Destination contains duplicate usernames.");
    }
    byUsername.set(row.username, row);
  }
  const map = new Map();
  for (const source of sourceRows) {
    const matched = byUsername.get(source.username);
    if (matched) {
      if (matched.name !== source.name || matched.role !== source.role) {
        throw new Error(
          `User identity conflict at destination id=${matched.id}; local profile and role were preserved.`,
        );
      }
      map.set(Number(source.id), Number(matched.id));
      counters.unchanged.User++;
      continue;
    }
    const targetId = await upsertDimensionById(
      client,
      "User",
      source,
      DATABASE_FIELDS.User,
      byId,
      counters,
    );
    const inserted =
      byId.get(targetId) ??
      (
        await client.query('SELECT * FROM "User" WHERE "id" = $1', [targetId])
      ).rows[0];
    byId.set(targetId, inserted);
    byUsername.set(inserted.username, inserted);
    map.set(Number(source.id), targetId);
  }
  return map;
}

function isPrismaDefaultSettings(row) {
  return (
    Number(row.id) === 1 &&
    Number(row.gstRate) === 5 &&
    row.gstEnabled === true &&
    row.orderReportsPath === "" &&
    row.restaurantAddress === "" &&
    row.fssaiEnabled === false &&
    row.fssaiNumber === "" &&
    row.gstinEnabled === false &&
    row.gstinNumber === ""
  );
}

async function importSettings(
  client,
  sourceRows,
  counters,
  replaceDefaultSettingsForTest,
) {
  for (const source of sourceRows) {
    const existing = await client.query(
      'SELECT * FROM "RestaurantSettings" WHERE "id" = $1',
      [source.id],
    );
    if (existing.rowCount) {
      if (
        replaceDefaultSettingsForTest &&
        isPrismaDefaultSettings(existing.rows[0])
      ) {
        await updateRow(
          client,
          "RestaurantSettings",
          source.id,
          source,
          DATABASE_FIELDS.RestaurantSettings,
        );
        counters.updated.RestaurantSettings++;
        continue;
      }
      requireSameRow(
        "RestaurantSettings",
        source.id,
        DATABASE_FIELDS.RestaurantSettings,
        existing.rows[0],
        source,
      );
      counters.unchanged.RestaurantSettings++;
    } else {
      await insertRow(
        client,
        "RestaurantSettings",
        source,
        DATABASE_FIELDS.RestaurantSettings,
      );
      counters.inserted.RestaurantSettings++;
    }
  }
}

async function updateSequences(client) {
  for (const table of SERIAL_TABLES) {
    const sequence = await client.query(
      "SELECT pg_get_serial_sequence($1, 'id') AS name",
      [quoteIdentifier(table)],
    );
    const sequenceName = sequence.rows[0]?.name;
    if (!sequenceName) continue;
    const row = await client.query(
      `SELECT COALESCE(MAX("id"), 0)::bigint AS max_id
       FROM ${quoteIdentifier(table)}`,
    );
    const maxId = BigInt(row.rows[0].max_id);
    if (maxId === 0n) continue;

    const sequenceState = await client.query(
      `SELECT last_value
       FROM pg_sequences
       WHERE format('%I.%I', schemaname, sequencename)::regclass = $1::regclass`,
      [sequenceName],
    );
    const lastValue = sequenceState.rows[0]?.last_value;
    const nextValue =
      (lastValue === null || lastValue === undefined ? 0n : BigInt(lastValue)) >
      maxId
        ? BigInt(lastValue) + 1n
        : maxId + 1n;
    const [schemaName, seqIdentifier] = sequenceName.split(".");
    const qualifiedSequence =
      schemaName && seqIdentifier
        ? `${schemaName}.${seqIdentifier}`
        : sequenceName;
    await client.query(
      `ALTER SEQUENCE ${qualifiedSequence} RESTART WITH ${nextValue.toString()}`,
    );
  }
}

async function verifyImportedHistory(client, sourceData) {
  const sourceOrders = sourceData.Order;
  const orderIds = sourceOrders.map((row) => Number(row.id));
  if (!orderIds.length) return;

  const orders = await client.query(
    `SELECT count(*)::int AS count, COALESCE(sum("total"),0)::text AS total
     FROM "Order" WHERE "id" = ANY($1::int[])`,
    [orderIds],
  );
  const items = await client.query(
    `SELECT count(*)::int AS count, COALESCE(sum("subtotal"),0)::text AS subtotal
     FROM "OrderItem" WHERE "orderId" = ANY($1::int[])`,
    [orderIds],
  );
  const payments = await client.query(
    `SELECT count(*)::int AS count, COALESCE(sum("amount"),0)::text AS amount
     FROM "Payment" WHERE "orderId" = ANY($1::int[])`,
    [orderIds],
  );

  const sourceItems = sourceData.OrderItem.filter((row) =>
    orderIds.includes(Number(row.orderId)),
  );
  const sourcePayments = sourceData.Payment.filter((row) =>
    orderIds.includes(Number(row.orderId)),
  );
  const expectedOrderTotal = sumMoney(sourceOrders, "total");
  const expectedItemSubtotal = sumMoney(sourceItems, "subtotal");
  const expectedPaymentAmount = sumMoney(sourcePayments, "amount");
  if (
    orders.rows[0].count !== sourceOrders.length ||
    formatMinorUnits(toMinorUnits(orders.rows[0].total)) !== expectedOrderTotal ||
    items.rows[0].count !== sourceItems.length ||
    formatMinorUnits(toMinorUnits(items.rows[0].subtotal)) !==
      expectedItemSubtotal ||
    payments.rows[0].count !== sourcePayments.length ||
    formatMinorUnits(toMinorUnits(payments.rows[0].amount)) !==
      expectedPaymentAmount
  ) {
    throw new Error(
      "Post-import historical order, item, or payment aggregate validation failed.",
    );
  }

  const sourcePaymentGroups = new Map();
  for (const payment of sourcePayments) {
    const key = `${payment.method ?? "NULL"}:${payment.status}`;
    const group = sourcePaymentGroups.get(key) ?? { count: 0, amount: 0n };
    group.count++;
    group.amount += toMinorUnits(payment.amount);
    sourcePaymentGroups.set(key, group);
  }
  const targetPaymentGroups = await client.query(
    `SELECT COALESCE("method"::text, 'NULL') AS method,
            "status"::text AS status,
            count(*)::int AS count,
            COALESCE(sum("amount"), 0)::text AS amount
     FROM "Payment"
     WHERE "orderId" = ANY($1::int[])
     GROUP BY "method", "status"`,
    [orderIds],
  );
  if (targetPaymentGroups.rowCount !== sourcePaymentGroups.size) {
    throw new Error(
      "Post-import payment method/status group validation failed.",
    );
  }
  for (const targetGroup of targetPaymentGroups.rows) {
    const key = `${targetGroup.method}:${targetGroup.status}`;
    const sourceGroup = sourcePaymentGroups.get(key);
    if (
      !sourceGroup ||
      sourceGroup.count !== targetGroup.count ||
      sourceGroup.amount !== toMinorUnits(targetGroup.amount)
    ) {
      throw new Error(
        "Post-import payment method/status totals do not match the source snapshot.",
      );
    }
  }
}

function newCounters() {
  return Object.fromEntries(
    ["inserted", "updated", "unchanged"].map((action) => [
      action,
      Object.fromEntries(TABLES.map((table) => [table, 0])),
    ]),
  );
}

async function migrate({
  sourceUrl,
  targetUrl,
  replaceDefaultSettingsForTest = false,
}) {
  validateEndpoints(sourceUrl, targetUrl);
  if (
    replaceDefaultSettingsForTest &&
    process.env.NODE_ENV !== "test"
  ) {
    throw new Error(
      "Replacing migration-created settings is permitted only for an isolated test database.",
    );
  }
  const source = new Client({
    connectionString: sourceUrl,
    application_name: "bigbites-readonly-data-migration",
  });
  const target = new Client({
    connectionString: targetUrl,
    application_name: "bigbites-disposable-data-migration-target",
  });
  let targetTransaction = false;
  try {
    await Promise.all([source.connect(), target.connect()]);
    await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const sourceState = await source.query(
      `SELECT current_database() AS database,
              current_setting('transaction_read_only') AS read_only`,
    );
    if (sourceState.rows[0].read_only !== "on") {
      throw new Error("Source connection did not establish a read-only snapshot.");
    }
    await target.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    targetTransaction = true;
    const targetState = await target.query(
      `SELECT current_database() AS database,
              current_setting('transaction_read_only') AS read_only`,
    );
    if (
      targetState.rows[0].database !==
        decodeURIComponent(new URL(targetUrl).pathname.slice(1)) ||
      targetState.rows[0].read_only !== "off"
    ) {
      throw new Error("Target database identity or write mode failed verification.");
    }

    const targetColumns = new Map();
    for (const table of TABLES) {
      const columns = await readColumns(target, table);
      if (columns.size) targetColumns.set(table, columns);
    }
    await assertTargetSchema(target, targetColumns);

    const sourceData = await readAllSourceData(source);
    const counters = newCounters();

    const categoryById = await mapById(target, "Category");
    const categoryMap = await mapCategories(
      target,
      sourceData.Category,
      categoryById,
      counters,
    );
    await verifyMappedIds(
      target,
      "Category",
      categoryMap,
      sourceData.Category.length,
    );

    const productMap = await mapProducts(
      target,
      sourceData.Product,
      categoryMap,
      counters,
    );
    await verifyMappedIds(
      target,
      "Product",
      productMap,
      sourceData.Product.length,
    );
    const variantMap = await mapVariants(
      target,
      sourceData.ProductVariant,
      productMap,
      counters,
    );
    await verifyMappedIds(
      target,
      "ProductVariant",
      variantMap,
      sourceData.ProductVariant.length,
    );

    const tableMap = await mapTables(
      target,
      sourceData.RestaurantTable,
      await mapById(target, "RestaurantTable"),
      counters,
    );
    await verifyMappedIds(
      target,
      "RestaurantTable",
      tableMap,
      sourceData.RestaurantTable.length,
    );
    const userMap = await mapUsers(
      target,
      sourceData.User,
      await mapById(target, "User"),
      counters,
    );
    await verifyMappedIds(target, "User", userMap, sourceData.User.length);

    await importSettings(
      target,
      sourceData.RestaurantSettings,
      counters,
      replaceDefaultSettingsForTest,
    );

    for (const sourceOrder of sourceData.Order) {
      const order = {
        ...sourceOrder,
        tableId: tableMap.get(Number(sourceOrder.tableId)),
        waiterId: userMap.get(Number(sourceOrder.waiterId)),
      };
      if (!order.tableId || !order.waiterId) {
        throw new Error(
          `Order id=${sourceOrder.id} refers to an unmapped table or user.`,
        );
      }
      await upsertOrderHistory(
        target,
        "Order",
        order,
        DATABASE_FIELDS.Order,
        counters,
      );
    }

    for (const sourceItem of sourceData.OrderItem) {
      const item = {
        ...sourceItem,
        productId: productMap.get(Number(sourceItem.productId)),
        variantId:
          sourceItem.variantId === null
            ? null
            : variantMap.get(Number(sourceItem.variantId)),
      };
      if (
        !item.productId ||
        !sourceData.Order.some((order) => Number(order.id) === Number(item.orderId)) ||
        (sourceItem.variantId !== null && !item.variantId)
      ) {
        throw new Error(
          `OrderItem id=${sourceItem.id} refers to an unmapped source record.`,
        );
      }
      await upsertOrderHistory(
        target,
        "OrderItem",
        item,
        DATABASE_FIELDS.OrderItem,
        counters,
      );
    }

    for (const sourcePayment of sourceData.Payment) {
      await upsertOrderHistory(
        target,
        "Payment",
        sourcePayment,
        DATABASE_FIELDS.Payment,
        counters,
      );
    }

    await verifyImportedHistory(target, sourceData);
    await verifyForeignKeys(target);
    await updateSequences(target);
    await target.query("COMMIT");
    targetTransaction = false;
    await source.query("ROLLBACK");

    return {
      sourceDatabase: sourceState.rows[0].database,
      sourceReadOnly: sourceState.rows[0].read_only,
      importedRows: Object.fromEntries(
        TABLES.map((table) => [table, sourceData[table].length]),
      ),
      counters,
      sourceOrderTotal: sumMoney(sourceData.Order, "total"),
      sourceItemSubtotal: sumMoney(sourceData.OrderItem, "subtotal"),
      sourcePaymentTotal: sumMoney(sourceData.Payment, "amount"),
    };
  } catch (error) {
    if (targetTransaction) {
      await target.query("ROLLBACK").catch(() => {});
    }
    await source.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await Promise.all([source.end().catch(() => {}), target.end().catch(() => {})]);
  }
}

if (require.main === module) {
  migrate({
    sourceUrl: process.env.SOURCE_DATABASE_URL,
    targetUrl: process.env.TARGET_DATABASE_URL,
    replaceDefaultSettingsForTest:
      process.env.REPLACE_DEFAULT_SETTINGS_FOR_TEST === "1",
  })
    .then((summary) => {
      console.log("Full-data migration committed to the isolated test target.");
      console.log(
        JSON.stringify(
          {
            sourceDatabase: summary.sourceDatabase,
            sourceReadOnly: summary.sourceReadOnly,
            importedRows: summary.importedRows,
            counters: summary.counters,
            sourceOrderTotal: summary.sourceOrderTotal,
            sourceItemSubtotal: summary.sourceItemSubtotal,
            sourcePaymentTotal: summary.sourcePaymentTotal,
          },
          null,
          2,
        ),
      );
    })
    .catch((error) => {
      console.error(
        `Migration refused or rolled back: ${
          error instanceof Error ? error.message : "unexpected database error"
        }`,
      );
      process.exitCode = 1;
    });
}

module.exports = {
  migrate,
  validateEndpoints,
  validateSourceSchema,
  sameRow,
  sumMoney,
};
