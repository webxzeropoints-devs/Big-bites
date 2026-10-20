const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const express = require("express");

process.env.AUTH_SECRET = "isolated-admin-product-test-secret";

const { prisma } = require("../dist/config/database.js");
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

function resetState(orderItems = []) {
  products.clear();
  deletedProductIds = [];
  products.set(41, {
    id: 41,
    isActive: true,
    orderItems,
  });
}

function installPrismaMocks() {
  prisma.product = {
    findUnique: async ({ where }) => products.get(where.id) ?? null,
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
