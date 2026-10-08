const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const express = require("express");

process.env.AUTH_SECRET = "isolated-admin-order-test-secret";

const { prisma } = require("../dist/config/database.js");
const { createToken, optionalAuth } = require("../dist/middleware/auth.js");
const adminRouter = require("../dist/routes/admin.js").default;
const { lockOrderSequence } = require("../dist/utils/orderSequence.js");

const adminToken = createToken({
  id: 1,
  username: "admin",
  role: "ADMIN",
});
const products = new Map();
const orders = new Map();
const payments = new Map();
const tables = new Map();
const servers = [];
let deletedOrderIds;
let deletedPaymentOrderIds;
let orderSequenceResetCount;

function resetState({ status = "CONFIRMED", paymentStatus = "PENDING" } = {}) {
  products.clear();
  orders.clear();
  payments.clear();
  tables.clear();
  deletedOrderIds = [];
  deletedPaymentOrderIds = [];
  orderSequenceResetCount = 0;
  products.set(41, { id: 41, stock: 2 });
  tables.set(1, { id: 1, status: "OCCUPIED" });
  const payment = {
    id: 11,
    orderId: 1,
    status: paymentStatus,
    amount: "25.00",
  };
  payments.set(1, payment);
  orders.set(1, {
    id: 1,
    tableId: 1,
    status,
    items: [{ productId: 41, quantity: 3 }],
    payment,
  });
}

function installPrismaMocks() {
  const transactionClient = {
    $queryRaw: async (query) => {
      if (query.join("").includes("setval(pg_get_serial_sequence")) {
        orderSequenceResetCount += 1;
      }
      return [];
    },
    order: {
      findUnique: async ({ where }) => orders.get(where.id) ?? null,
      delete: async ({ where }) => {
        deletedOrderIds.push(where.id);
        const order = orders.get(where.id);
        orders.delete(where.id);
        return order;
      },
      findFirst: async () => null,
      count: async () => orders.size,
    },
    product: {
      update: async ({ where, data }) => {
        const product = products.get(where.id);
        product.stock += data.stock.increment;
        return product;
      },
    },
    payment: {
      deleteMany: async ({ where }) => {
        deletedPaymentOrderIds.push(where.orderId);
        payments.delete(where.orderId);
        return { count: 1 };
      },
    },
    restaurantTable: {
      findUnique: async ({ where }) => tables.get(where.id) ?? null,
      update: async ({ where, data }) => {
        const table = tables.get(where.id);
        Object.assign(table, data);
        return table;
      },
    },
  };
  prisma.$transaction = async (callback) => callback(transactionClient);
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

async function deleteOrder(baseUrl) {
  return fetch(`${baseUrl}/api/admin/orders/1`, {
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

test("order sequence lock returns a Prisma-supported scalar", async () => {
  let lockQuery;
  await lockOrderSequence({
    $queryRaw: async (query) => {
      lockQuery = query.join("");
      return [{ "?column?": 1 }];
    },
  });

  assert.match(lockQuery, /WITH sequence_lock AS MATERIALIZED/);
  assert.match(lockQuery, /SELECT 1 FROM sequence_lock/);
});

test("deleting an unpaid order returns its stock and clears table state transactionally", async () => {
  resetState();
  installPrismaMocks();
  const baseUrl = await createAppServer();
  const response = await deleteOrder(baseUrl);

  assert.equal(response.status, 204);
  assert.equal(products.get(41).stock, 5);
  assert.equal(orders.has(1), false);
  assert.equal(payments.has(1), false);
  assert.equal(tables.get(1).status, "AVAILABLE");
  assert.deepEqual(deletedOrderIds, [1]);
  assert.deepEqual(deletedPaymentOrderIds, [1]);
  assert.equal(orderSequenceResetCount, 1);
});

test("paid, refunded, and completed orders are deleted with payments without restoring stock", async () => {
  for (const scenario of [
    { status: "COMPLETED", paymentStatus: "PAID" },
    { status: "READY_FOR_BILLING", paymentStatus: "REFUNDED" },
  ]) {
    resetState(scenario);
    installPrismaMocks();
    const baseUrl = await createAppServer();
    const response = await deleteOrder(baseUrl);

    assert.equal(response.status, 204);
    assert.equal(products.get(41).stock, 2);
    assert.equal(orders.has(1), false);
    assert.equal(payments.has(1), false);
    assert.deepEqual(deletedOrderIds, [1]);
    assert.deepEqual(deletedPaymentOrderIds, [1]);
    assert.equal(orderSequenceResetCount, 1);
  }
});

test("deleting an order does not reset the sequence while other orders remain", async () => {
  resetState();
  orders.set(2, {
    id: 2,
    tableId: 1,
    status: "CONFIRMED",
    items: [],
    payment: null,
  });
  installPrismaMocks();
  const baseUrl = await createAppServer();
  const response = await deleteOrder(baseUrl);

  assert.equal(response.status, 204);
  assert.equal(orders.has(2), true);
  assert.equal(orderSequenceResetCount, 0);
});

test("dashboard revenue uses discounted canonical invoice totals instead of stored payment amounts", async () => {
  resetState({ status: "COMPLETED", paymentStatus: "PAID" });
  installPrismaMocks();
  prisma.payment.findMany = async () => [
    {
      amount: "99.00",
      order: {
        total: "100.01",
        gstRate: "5.00",
        discountType: "AMOUNT",
        discountValue: "10.00",
      },
    },
  ];
  prisma.order.count = async ({ where }) =>
    where.status === "COMPLETED" ? 1 : 0;
  prisma.product.count = async () => 1;
  prisma.category.count = async () => 1;
  prisma.restaurantTable.count = async () => 1;
  const baseUrl = await createAppServer();
  const response = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).revenue, 94.51);
});
