const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const express = require("express");

process.env.AUTH_SECRET = "isolated-catalog-sync-test-secret";
process.env.BIGBITES_ENABLE_PRODUCTION_CATALOG_SYNC = "true";
const localDatabaseUrl =
  "postgresql://local@127.0.0.1:5432/bigbites?schema=public";
process.env.DATABASE_URL = localDatabaseUrl;

const { prisma } = require("../dist/config/database.js");
const { createToken, optionalAuth } = require("../dist/middleware/auth.js");
const adminRouter = require("../dist/routes/admin.js").default;

const originalFetch = global.fetch;
const adminToken = createToken({
  id: 1,
  username: "admin",
  role: "ADMIN",
});
const servers = [];
let transactionCount;
let categoryUpserts;
let productUpserts;
let variantUpserts;
let localCategories;
let localProducts;
let localVariants;

const currentSchemaColumns = [
  ["Category", "id"],
  ["Category", "name"],
  ["Category", "sortOrder"],
  ...[
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
    "categoryId",
  ].map((columnName) => ["Product", columnName]),
  ...["id", "name", "price", "isActive", "productId"].map((columnName) => [
    "ProductVariant",
    columnName,
  ]),
];

const categories = [
  { id: 9, name: "Starters", sortOrder: 1, _count: { products: 1 } },
  { id: 10, name: "Drinks", sortOrder: 2, _count: { products: 0 } },
];
const products = [
  {
    id: 18,
    slug: "starters-test-meal",
    name: "Test meal",
    description: "Production description",
    price: 45,
    isVegetarian: true,
    classification: "VEG",
    subcategory: null,
    isSignature: false,
    isActive: true,
    categoryId: 9,
    category: { id: 9, name: "Starters" },
    variants: [{ id: 33, name: "Half", price: 30 }],
  },
];

function installPrismaMocks() {
  transactionCount = 0;
  categoryUpserts = [];
  productUpserts = [];
  variantUpserts = [];
  prisma.$queryRaw = async () =>
    currentSchemaColumns.map(([tableName, columnName]) => ({
      tableName,
      columnName,
    }));

  const transaction = {
    category: {
      upsert: async (args) => {
        categoryUpserts.push(args);
        return { id: args.where.name === "Starters" ? 101 : 102 };
      },
    },
    product: {
      upsert: async (args) => {
        productUpserts.push(args);
        return { id: 201 };
      },
    },
    productVariant: {
      upsert: async (args) => {
        variantUpserts.push(args);
        return { id: 301 };
      },
    },
  };
  prisma.$transaction = async (callback) => {
    transactionCount += 1;
    return callback(transaction);
  };
}

function installFetchMock(menuCategories = categories, menuProducts = products) {
  const requestedUrls = [];
  global.fetch = async (url) => {
    requestedUrls.push(String(url));
    const body = String(url).endsWith("/categories")
      ? menuCategories
      : menuProducts;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return requestedUrls;
}

function createAppServer() {
  const app = express();
  app.use(express.json());
  app.use(optionalAuth);
  app.use("/api/admin", adminRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

async function syncCatalog(baseUrl, token = adminToken) {
  return originalFetch(`${baseUrl}/api/admin/catalog/sync`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

after(async () => {
  global.fetch = originalFetch;
  await Promise.all(
    servers.map(
      (server) =>
        new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

test("admin catalog sync imports production catalog fields without stock", async () => {
  installPrismaMocks();
  const requestedUrls = installFetchMock();
  const baseUrl = await createAppServer();

  const response = await syncCatalog(baseUrl);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    categories: 2,
    products: 1,
    variants: 1,
  });
  assert.equal(transactionCount, 1);
  assert.equal(requestedUrls.length, 2);
  assert.equal(categoryUpserts.length, 2);
  assert.equal(productUpserts.length, 1);
  assert.equal(Object.hasOwn(productUpserts[0].create, "stock"), false);
  assert.equal(Object.hasOwn(productUpserts[0].update, "stock"), false);
  assert.equal(productUpserts[0].update.price, "45.00");
  assert.equal(productUpserts[0].update.categoryId, 101);
  assert.equal(variantUpserts[0].create.price, "30.00");
});

test("repeated catalog sync is idempotent and preserves local-only records", async () => {
  localCategories = new Map([
    ["Starters", { id: 101, name: "Starters", sortOrder: 99 }],
    ["Local-only", { id: 103, name: "Local-only", sortOrder: 7 }],
  ]);
  localProducts = new Map([
    ["starters-test-meal", {
      id: 201,
      slug: "starters-test-meal",
      name: "Old local name",
      categoryId: 101,
    }],
    ["local-only-meal", {
      id: 202,
      slug: "local-only-meal",
      name: "Local meal",
      categoryId: 103,
    }],
  ]);
  localVariants = new Map([
    ["201:Local size", {
      productId: 201,
      name: "Local size",
      price: "12.00",
      isActive: true,
    }],
  ]);
  let nextCategoryId = 104;
  let nextProductId = 203;
  let nextVariantId = 302;
  transactionCount = 0;

  const transaction = {
    category: {
      upsert: async (args) => {
        const existing = localCategories.get(args.where.name);
        if (existing) {
          Object.assign(existing, args.update);
          return { id: existing.id };
        }
        const created = { ...args.create, id: nextCategoryId++ };
        localCategories.set(created.name, created);
        return { id: created.id };
      },
    },
    product: {
      upsert: async (args) => {
        const existing = localProducts.get(args.where.slug);
        if (existing) {
          Object.assign(existing, args.update);
          return { id: existing.id };
        }
        const created = { ...args.create, id: nextProductId++ };
        localProducts.set(created.slug, created);
        return { id: created.id };
      },
    },
    productVariant: {
      upsert: async (args) => {
        const key = `${args.where.productId_name.productId}:${args.where.productId_name.name}`;
        const existing = localVariants.get(key);
        if (existing) Object.assign(existing, args.update);
        else localVariants.set(key, { ...args.create, id: nextVariantId++ });
        return { id: (existing || localVariants.get(key)).id };
      },
    },
  };
  prisma.$transaction = async (callback) => {
    transactionCount += 1;
    return callback(transaction);
  };

  installFetchMock();
  const baseUrl = await createAppServer();
  assert.equal((await syncCatalog(baseUrl)).status, 200);
  assert.equal((await syncCatalog(baseUrl)).status, 200);

  assert.equal(transactionCount, 2);
  assert.equal(localCategories.size, 3);
  assert.equal(localProducts.size, 2);
  assert.equal(localVariants.size, 2);
  assert.equal(localCategories.get("Local-only").sortOrder, 7);
  assert.equal(localProducts.get("local-only-meal").name, "Local meal");
  assert.equal(localVariants.get("201:Local size").price, "12.00");
});

test("catalog sync requires an administrator and validates before local writes", async () => {
  installPrismaMocks();
  installFetchMock(categories, [{ ...products[0], isActive: false }]);
  const baseUrl = await createAppServer();

  const unauthorized = await syncCatalog(baseUrl, "");
  assert.equal(unauthorized.status, 401);
  assert.equal(transactionCount, 0);

  const invalidMenu = await syncCatalog(baseUrl);
  assert.equal(invalidMenu.status, 502);
  assert.equal(transactionCount, 0);
  assert.match((await invalidMenu.json()).message, /inactive|incomplete/i);
});

test("catalog sync refuses the installed legacy schema before fetching or writing", async () => {
  installPrismaMocks();
  const requestedUrls = installFetchMock();
  const legacyColumns = [
    ["Category", "id"],
    ["Category", "name"],
    ...["id", "name", "price", "isActive", "categoryId"].map(
      (columnName) => ["Product", columnName],
    ),
  ];
  prisma.$queryRaw = async () =>
    legacyColumns.map(([tableName, columnName]) => ({
      tableName,
      columnName,
    }));
  const baseUrl = await createAppServer();

  const response = await syncCatalog(baseUrl);
  assert.equal(response.status, 409);
  const payload = await response.json();
  assert.match(payload.message, /cannot safely store.*variant prices/i);
  assert.ok(payload.missingColumns.includes("Product.slug"));
  assert.ok(payload.missingColumns.includes("ProductVariant.id"));
  assert.equal(requestedUrls.length, 0);
  assert.equal(transactionCount, 0);
});

test("catalog sync reports transaction failures without returning success", async () => {
  installPrismaMocks();
  const requestedUrls = installFetchMock();
  const baseUrl = await createAppServer();
  prisma.$transaction = async (callback) => {
    transactionCount += 1;
    return callback({
      category: {
        upsert: async (args) => ({ id: args.where.name === "Starters" ? 101 : 102 }),
      },
      product: {
        upsert: async () => ({ id: 201 }),
      },
      productVariant: {
        upsert: async () => {
          throw new Error("simulated variant constraint failure");
        },
      },
    });
  };

  const response = await syncCatalog(baseUrl);
  assert.equal(response.status, 500);
  assert.match((await response.json()).message, /rolled back/i);
  assert.equal(transactionCount, 1);
  assert.equal(requestedUrls.length, 2);
});

test("catalog sync refuses to write when the backend is not configured for the installed local database", async () => {
  installPrismaMocks();
  const requestedUrls = installFetchMock();
  const baseUrl = await createAppServer();

  process.env.DATABASE_URL =
    "postgresql://neon.invalid:5432/neondb?schema=public";
  try {
    const response = await syncCatalog(baseUrl);
    assert.equal(response.status, 409);
    assert.equal(transactionCount, 0);
    assert.equal(requestedUrls.length, 0);
  } finally {
    process.env.DATABASE_URL = localDatabaseUrl;
  }
});

test("catalog sync is disabled by default", async () => {
  installPrismaMocks();
  const requestedUrls = installFetchMock();
  const baseUrl = await createAppServer();
  const enabled = process.env.BIGBITES_ENABLE_PRODUCTION_CATALOG_SYNC;

  delete process.env.BIGBITES_ENABLE_PRODUCTION_CATALOG_SYNC;
  try {
    const response = await syncCatalog(baseUrl);
    assert.equal(response.status, 409);
    assert.match((await response.json()).message, /disabled/i);
    assert.equal(transactionCount, 0);
    assert.equal(requestedUrls.length, 0);
  } finally {
    process.env.BIGBITES_ENABLE_PRODUCTION_CATALOG_SYNC = enabled;
  }
});

test("stock management endpoint is removed", async () => {
  transactionCount = 0;
  prisma.$transaction = async (callback) => {
    transactionCount += 1;
    return callback({
      product: {
        findUnique: async () => ({ id: 18, stock: 8, isActive: true }),
        update: async ({ data }) => ({
          id: 18,
          name: "Test meal",
          price: "45.00",
          stock: data.stock,
          lowStockThreshold: 2,
        }),
      },
      productStockMovement: { create: async () => ({ id: 1 }) },
    });
  };
  const baseUrl = await createAppServer();
  const waiterToken = createToken({
    id: 2,
    username: "waiter",
    role: "WAITER",
  });
  const cashierToken = createToken({
    id: 3,
    username: "cashier",
    role: "CASHIER",
  });
  const requestStockChange = (token) =>
    originalFetch(`${baseUrl}/api/admin/products/18/stock`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ newStock: 12 }),
    });

  assert.equal((await requestStockChange(waiterToken)).status, 403);
  assert.equal((await requestStockChange(cashierToken)).status, 403);
  assert.equal((await requestStockChange(adminToken)).status, 404);
  assert.equal(transactionCount, 0);
});

test("monthly report API exports only the requested month for administrators", async () => {
  prisma.order.findMany = async () => [];
  const baseUrl = await createAppServer();
  const endpoint = `${baseUrl}/api/admin/order-reports/export/2026-10`;

  const unauthorized = await originalFetch(endpoint, { method: "POST" });
  assert.equal(unauthorized.status, 401);

  const invalidMonth = await originalFetch(
    `${baseUrl}/api/admin/order-reports/export/2026-13`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    },
  );
  assert.equal(invalidMonth.status, 400);

  const response = await originalFetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.reports.length, 1);
  assert.equal(payload.reports[0].fileName, "October 2026.xlsx");
});
