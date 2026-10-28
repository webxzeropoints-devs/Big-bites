const assert = require("node:assert/strict");
const Module = require("node:module");
const { after, test } = require("node:test");
const express = require("express");

process.env.AUTH_SECRET = "isolated-admin-product-test-secret";

const databaseModulePath = require.resolve("../dist/config/database.js");
const databaseModule = new Module(databaseModulePath);
databaseModule.filename = databaseModulePath;
databaseModule.loaded = true;
databaseModule.exports = { prisma: {} };
require.cache[databaseModulePath] = databaseModule;
const { prisma } = require(databaseModulePath);
const { createToken, optionalAuth } = require("../dist/middleware/auth.js");
const adminRouter = require("../dist/routes/admin.js").default;

const adminToken = createToken({
  id: 1,
  username: "admin",
  role: "ADMIN",
});
const products = new Map();
const servers = [];
let deletedProductIds;
let stockMovements;

function resetState(orderItems = []) {
  products.clear();
  deletedProductIds = [];
  stockMovements = [];
  products.set(41, {
    id: 41,
    isActive: true,
    orderItems,
    stock: 0,
    stockUnit: "pcs",
    lowStockThreshold: 0,
    lastStockUpdatedAt: null,
    variants: [],
  });
}

function installPrismaMocks() {
  prisma.product = {
    findUnique: async ({ where }) => {
      const product = products.get(where.id);
      return product
        ? { ...product, stockMovements: product.stockMovements ?? [] }
        : null;
    },
    update: async ({ where, data }) => {
      const product = products.get(where.id);
      Object.assign(product, data);
      return product;
    },
    delete: async ({ where }) => {
      deletedProductIds.push(where.id);
      const product = products.get(where.id);
      products.delete(where.id);
      return product;
    },
  };
  prisma.$transaction = async (callback) => callback({
    $queryRaw: async () => [],
    product: {
      findUnique: async ({ where }) => products.get(where.id) ?? null,
      update: async ({ where, data }) => {
        const product = products.get(where.id);
        Object.assign(product, data);
        return product;
      },
      findUniqueOrThrow: async ({ where }) => ({
        ...products.get(where.id),
        variants: [],
      }),
    },
    productVariant: {
      upsert: async () => ({ id: 1 }),
      updateMany: async () => ({ count: 0 }),
    },
    productStockMovement: {
      create: async ({ data }) => {
        const movement = { id: stockMovements.length + 1, ...data };
        stockMovements.push(movement);
        return movement;
      },
    },
  });
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

async function deleteProduct(baseUrl) {
  return fetch(`${baseUrl}/api/admin/products/41`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

async function patchProduct(baseUrl, productId, body) {
  return fetch(`${baseUrl}/api/admin/products/${productId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function patchStock(baseUrl, productId, body, token = adminToken) {
  return fetch(`${baseUrl}/api/admin/products/${productId}/stock`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

after(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

test("product referenced by historical orders is deactivated rather than deleted", async () => {
  resetState([{ id: 9 }]);
  installPrismaMocks();
  const baseUrl = await createAppServer();

  const response = await deleteProduct(baseUrl);

  assert.equal(response.status, 200);
  assert.equal(products.get(41).isActive, false);
  assert.deepEqual(deletedProductIds, []);
});

test("product without historical references can still be deleted", async () => {
  resetState();
  installPrismaMocks();
  const baseUrl = await createAppServer();

  const response = await deleteProduct(baseUrl);

  assert.equal(response.status, 204);
  assert.equal(products.has(41), false);
  assert.deepEqual(deletedProductIds, [41]);
});

test("only admins can initialize stock, and zero is an explicit tracked count", async () => {
  resetState();
  installPrismaMocks();
  const baseUrl = await createAppServer();
  const waiterToken = createToken({ id: 2, username: "waiter", role: "WAITER" });
  const forbidden = await patchStock(
    baseUrl,
    41,
    { newStock: 8 },
    waiterToken,
  );
  assert.equal(forbidden.status, 403);
  assert.equal(products.get(41).lastStockUpdatedAt, null);

  const initialization = await patchStock(baseUrl, 41, {
    newStock: 0,
    stockUnit: "boxes",
    lowStockThreshold: 2,
    reason: "Owner-confirmed opening count",
  });
  assert.equal(initialization.status, 200);
  assert.equal(products.get(41).stock, 0);
  assert.equal(products.get(41).stockUnit, "boxes");
  assert.equal(products.get(41).lowStockThreshold, 2);
  assert.ok(products.get(41).lastStockUpdatedAt instanceof Date);
  assert.equal(stockMovements[0].movementType, "INITIALIZATION");
  assert.equal(stockMovements[0].quantity, 0);
  assert.equal(stockMovements[0].reason, "Owner-confirmed opening count");
});

test("unknown stock cannot be incremented before explicit initialization", async () => {
  resetState();
  installPrismaMocks();
  const baseUrl = await createAppServer();
  const response = await patchStock(baseUrl, 41, { quantity: 5 });
  assert.equal(response.status, 409);
  assert.equal(products.get(41).stock, 0);
  assert.equal(products.get(41).lastStockUpdatedAt, null);
  assert.equal(stockMovements.length, 0);
});

test("admin edits cannot change fixed combo prices but normal product pricing remains editable", async () => {
  resetState();
  products.set(43, {
    id: 43,
    slug: "couples-friends-combo-couples-friends-combo",
    name: "Couples/Friends Combo",
    price: "499.00",
    isActive: true,
    orderItems: [],
  });
  products.set(44, {
    id: 44,
    slug: "family-combo-family-combo",
    name: "Family Combo",
    price: "999.00",
    isActive: true,
    orderItems: [],
  });
  installPrismaMocks();
  const baseUrl = await createAppServer();

  for (const [productId, proposedPrice, expectedPrice] of [
    [43, 450, "499.00"],
    [44, 950, "999.00"],
  ]) {
    const response = await patchProduct(baseUrl, productId, {
      price: proposedPrice,
    });
    assert.equal(response.status, 409);
    assert.equal(products.get(productId).price, expectedPrice);
  }

  for (const [productId, proposedName, expectedName] of [
    [43, "Friends Special", "Couples/Friends Combo"],
    [44, "Family Feast", "Family Combo"],
  ]) {
    const response = await patchProduct(baseUrl, productId, {
      name: proposedName,
    });
    assert.equal(response.status, 409);
    assert.equal(products.get(productId).name, expectedName);
  }

  const normalProductEdit = await patchProduct(baseUrl, 41, { price: 18.5 });
  assert.equal(normalProductEdit.status, 200);
  assert.equal(products.get(41).price, "18.50");
});
