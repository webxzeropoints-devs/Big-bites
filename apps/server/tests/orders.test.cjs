const assert = require("node:assert/strict");
const path = require("node:path");
const { after, test } = require("node:test");
const express = require("express");
const { toDecimalString, toMinorUnits } = require("../dist/utils/currency.js");

process.env.AUTH_SECRET = "isolated-order-route-test-secret";

const routePath = path.resolve(
  __dirname,
  process.env.BIG_BITES_ORDER_ROUTE || "../dist/routes/orders.js",
);
const distDirectory = path.dirname(routePath);
const { prisma } = require(path.join(distDirectory, "../config/database.js"));
const { createToken, optionalAuth } = require(
  path.join(distDirectory, "../middleware/auth.js"),
);
const ordersRouter = require(routePath).default;

const tables = new Map([
  [1, { id: 1, number: 1, isParcel: false, status: "AVAILABLE" }],
  [2, { id: 2, number: 0, isParcel: true, status: "AVAILABLE" }],
]);
const users = new Map([
  [1, { id: 1, role: "ADMIN" }],
  [2, { id: 2, role: "WAITER" }],
  [3, { id: 3, role: "CASHIER" }],
]);
const products = new Map([
  [41, { id: 41, name: "Test meal", price: 12.5, stock: 8, isActive: true }],
  [42, { id: 42, name: "Test drink", price: 3, stock: 6, isActive: true }],
]);
const productVariants = new Map();
let createdOrders;
let nextOrderId;
let orderSequenceResetCount;
const servers = [];

function resetMockData() {
  tables.forEach((table) => {
    table.status = "AVAILABLE";
  });
  products.get(41).stock = 8;
  products.get(42).stock = 6;
  productVariants.clear();
  createdOrders = [];
  nextOrderId = 5;
  orderSequenceResetCount = 0;
}

function installPrismaMocks() {
  const transactionClient = {
    $queryRaw: async (query) => {
      if (query.join("").includes("setval(pg_get_serial_sequence")) {
        nextOrderId = 1;
        orderSequenceResetCount += 1;
      }
      return [];
    },
    order: {
      count: async () => createdOrders.length,
      findFirst: async ({ where }) => {
        const order = createdOrders.find(
          (entry) =>
            entry.tableId === where.tableId &&
            !where.status.notIn.includes(entry.status),
        );
        return order ? { id: order.id } : null;
      },
      create: async ({ data }) => {
        const order = {
          id: nextOrderId++,
          ...data,
          table: tables.get(data.tableId),
          waiter: users.get(data.waiterId),
          items: data.items.create,
          payment: data.payment.create,
        };
        createdOrders.push(order);
        return order;
      },
      findUnique: async ({ where }) =>
        createdOrders.find((entry) => entry.id === where.id) ?? null,
      update: async ({ where, data }) => {
        const order = createdOrders.find((entry) => entry.id === where.id);
        if (data.total?.increment !== undefined) {
          order.total = toDecimalString(
            toMinorUnits(order.total) +
              toMinorUnits(data.total.increment),
          );
        }
        return order;
      },
    },
    orderItem: {
      createMany: async ({ data }) => {
        const order = createdOrders.find(
          (entry) => entry.id === data[0].orderId,
        );
        order.items.push(...data);
        return { count: data.length };
      },
    },
    payment: {
      updateMany: async ({ where, data }) => {
        const order = createdOrders.find(
          (entry) => entry.id === where.orderId,
        );
        order.payment.amount = toDecimalString(
          toMinorUnits(order.payment.amount) +
            toMinorUnits(data.amount.increment),
        );
        return { count: 1 };
      },
    },
    product: {
      updateMany: async ({ where, data }) => {
        const product = products.get(where.id);
        if (
          !product ||
          !product.isActive ||
          product.stock < where.stock.gte
        ) {
          return { count: 0 };
        }
        product.stock -= data.stock.decrement;
        return { count: 1 };
      },
      findUnique: async ({ where }) => products.get(where.id) ?? null,
    },
    productVariant: {
      findFirst: async ({ where }) =>
        productVariants.get(where.id)?.productId === where.productId &&
        productVariants.get(where.id)?.isActive
          ? productVariants.get(where.id)
          : null,
    },
    restaurantTable: {
      update: async ({ where, data }) => {
        const table = tables.get(where.id);
        Object.assign(table, data);
        return table;
      },
    },
  };

  prisma.restaurantTable.findUnique = async ({ where }) =>
    tables.get(where.id) ?? null;
  prisma.order = transactionClient.order;
  prisma.orderItem = transactionClient.orderItem;
  prisma.payment = transactionClient.payment;
  prisma.user.findUnique = async ({ where }) => users.get(where.id) ?? null;
  prisma.product.findUnique = async ({ where }) => products.get(where.id) ?? null;
  prisma.productVariant = transactionClient.productVariant;
  prisma.$transaction = async (callback) => callback(transactionClient);
}

function createAppServer() {
  const app = express();
  app.use(express.json());
  app.use(optionalAuth);
  app.use("/api/orders", ordersRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function requestOrder(baseUrl, { token, payload }) {
  return fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
}

after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

test(`POST /api/orders persists a table order as the authenticated admin (${routePath})`, async () => {
  resetMockData();
  installPrismaMocks();
  const baseUrl = await createAppServer();
  const token = createToken({ id: 1, username: "admin", role: "ADMIN" });
  const response = await requestOrder(baseUrl, {
    token,
    payload: {
      tableId: 1,
      items: [
        { productId: 41, quantity: 2 },
        { productId: 42, quantity: 1 },
      ],
    },
  });

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.order.table.isParcel, false);
  assert.equal(body.order.waiterId, 1);
  assert.equal(body.order.status, "CONFIRMED");
  assert.deepEqual(
    body.order.items.map(({ productId, quantity }) => ({ productId, quantity })),
    [
      { productId: 41, quantity: 2 },
      { productId: 42, quantity: 1 },
    ],
  );
  assert.equal(createdOrders.length, 1);
  assert.equal(body.order.id, 1);
  assert.equal(orderSequenceResetCount, 1);
  assert.equal(products.get(41).stock, 6);
  assert.equal(products.get(42).stock, 5);
  assert.equal(tables.get(1).status, "OCCUPIED");

  const duplicate = await requestOrder(baseUrl, {
    token,
    payload: {
      tableId: 1,
      items: [{ productId: 41, quantity: 1 }],
    },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(createdOrders.length, 1);
  assert.equal(products.get(41).stock, 6);
});

test(`POST /api/orders prices and records the selected product variant (${routePath})`, async () => {
  resetMockData();
  productVariants.set(501, {
    id: 501,
    productId: 41,
    name: "Large",
    price: 21.25,
    isActive: true,
  });
  installPrismaMocks();
  const baseUrl = await createAppServer();
  const token = createToken({ id: 1, username: "admin", role: "ADMIN" });
  const response = await requestOrder(baseUrl, {
    token,
    payload: {
      tableId: 1,
      items: [{ productId: 41, variantId: 501, quantity: 2 }],
    },
  });

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.order.total, "42.50");
  assert.deepEqual(body.order.items[0], {
    productId: 41,
    variantId: 501,
    quantity: 2,
    unitPrice: "21.25",
    subtotal: "42.50",
  });
  assert.equal(products.get(41).stock, 6);
});

test(`POST /api/orders persists a parcel order as the authenticated waiter, ignoring submitted identity (${routePath})`, async () => {
  resetMockData();
  installPrismaMocks();
  const baseUrl = await createAppServer();
  const token = createToken({ id: 2, username: "waiter", role: "WAITER" });
  const response = await requestOrder(baseUrl, {
    token,
    payload: {
      tableId: 2,
      waiterId: 1,
      items: [{ productId: 41, quantity: 3 }],
    },
  });

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.order.table.isParcel, true);
  assert.equal(body.order.waiterId, 2);
  assert.deepEqual(
    body.order.items.map(({ productId, quantity }) => ({ productId, quantity })),
    [{ productId: 41, quantity: 3 }],
  );
  assert.equal(createdOrders.length, 1);
  assert.equal(products.get(41).stock, 5);
  assert.equal(tables.get(2).status, "OCCUPIED");
});

test(`PATCH /api/orders/:id/add-items uses exact line totals and stock (${routePath})`, async () => {
  resetMockData();
  installPrismaMocks();
  const baseUrl = await createAppServer();
  const token = createToken({ id: 1, username: "admin", role: "ADMIN" });

  const created = await requestOrder(baseUrl, {
    token,
    payload: {
      tableId: 1,
      items: [{ productId: 41, quantity: 1 }],
    },
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();

  const response = await fetch(
    `${baseUrl}/api/orders/${createdBody.order.id}/add-items`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        items: [
          { productId: 41, quantity: 2 },
          { productId: 42, quantity: 1 },
        ],
      }),
    },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.order.total, "40.50");
  assert.deepEqual(
    body.order.items.map(({ productId, quantity, subtotal }) => ({
      productId,
      quantity,
      subtotal,
    })),
    [
      { productId: 41, quantity: 1, subtotal: "12.50" },
      { productId: 41, quantity: 2, subtotal: "25.00" },
      { productId: 42, quantity: 1, subtotal: "3.00" },
    ],
  );
  assert.equal(body.order.payment.amount, "40.50");
  assert.equal(products.get(41).stock, 5);
  assert.equal(products.get(42).stock, 5);
});

test(`POST /api/orders enforces authentication, roles, validation, and stock errors (${routePath})`, async () => {
  resetMockData();
  installPrismaMocks();
  const baseUrl = await createAppServer();

  const unauthorized = await requestOrder(baseUrl, {
    payload: { tableId: 1, items: [{ productId: 41, quantity: 1 }] },
  });
  assert.equal(unauthorized.status, 401);

  const cashierToken = createToken({
    id: 3,
    username: "cashier",
    role: "CASHIER",
  });
  const forbidden = await requestOrder(baseUrl, {
    token: cashierToken,
    payload: { tableId: 1, items: [{ productId: 41, quantity: 1 }] },
  });
  assert.equal(forbidden.status, 403);

  const invalid = await requestOrder(baseUrl, {
    token: createToken({ id: 1, username: "admin", role: "ADMIN" }),
    payload: { tableId: 1, items: [{ productId: 41, quantity: 0 }] },
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).message, "Invalid productId or quantity");

  const insufficientStock = await requestOrder(baseUrl, {
    token: createToken({ id: 1, username: "admin", role: "ADMIN" }),
    payload: { tableId: 1, items: [{ productId: 41, quantity: 9 }] },
  });
  assert.equal(insufficientStock.status, 400);
  assert.match((await insufficientStock.json()).message, /Insufficient stock/);
  assert.equal(createdOrders.length, 0);
});
