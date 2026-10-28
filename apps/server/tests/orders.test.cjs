const assert = require("node:assert/strict");
const Module = require("node:module");
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
const databaseModulePath = require.resolve(
  path.join(distDirectory, "../config/database.js"),
);
const databaseModule = new Module(databaseModulePath);
databaseModule.filename = databaseModulePath;
databaseModule.loaded = true;
databaseModule.exports = {
  prisma: {
    product: {},
    restaurantTable: {},
    user: {},
  },
};
require.cache[databaseModulePath] = databaseModule;
const { prisma } = require(databaseModulePath);
const { createToken, optionalAuth } = require(
  path.join(distDirectory, "../middleware/auth.js"),
);
const ordersRouter = require(routePath).default;
const billingRouter = require(path.join(distDirectory, "../routes/billing.js")).default;

const tables = new Map([
  [1, { id: 1, number: 1, isParcel: false, status: "AVAILABLE" }],
  [2, { id: 2, number: 0, isParcel: true, status: "AVAILABLE" }],
]);
const users = new Map([
  [1, { id: 1, role: "ADMIN" }],
  [2, { id: 2, role: "WAITER" }],
  [3, { id: 3, role: "CASHIER" }],
  [4, { id: 4, role: "WAITER" }],
]);
const products = new Map([
  [41, { id: 41, name: "Test meal", price: 12.5, isActive: true }],
  [42, { id: 42, name: "Test drink", price: 3, isActive: true }],
  [43, {
    id: 43,
    slug: "couples-friends-combo-couples-friends-combo",
    name: "Couples/Friends Combo",
    price: 499,
    isActive: true,
    comboItems: [
      { name: "Chicken Rice", quantity: 1 },
      { name: "Chicken Briyani", quantity: 1 },
      { name: "BBQ Quarter", quantity: 1 },
      { name: "Chicken Lollipop", quantity: 1 },
    ],
  }],
  [44, {
    id: 44,
    slug: "family-combo-family-combo",
    name: "Family Combo",
    price: 999,
    isActive: true,
    comboItems: [
      { name: "Chicken Rice", quantity: 1 },
      { name: "Chicken Briyani", quantity: 1 },
      { name: "Chicken Noodles", quantity: 1 },
      { name: "Butter Naan", quantity: 1 },
      { name: "Roti", quantity: 1 },
      { name: "Chicken Masala", quantity: 1 },
      { name: "Dragon Chicken", quantity: 1 },
      { name: "Saucy Lollipop", quantity: 1 },
      { name: "BBQ Quarter", quantity: 1 },
    ],
  }],
]);
const initialProducts = new Map(
  [...products].map(([id, product]) => [id, structuredClone(product)]),
);
const productVariants = new Map();
let createdOrders;
let orderItemSubmissions;
let stockMovements;
let nextOrderId;
let orderSequenceResetCount;
let transactionTail;
const servers = [];

function resetMockData() {
  tables.forEach((table) => {
    table.status = "AVAILABLE";
  });
  products.clear();
  for (const [id, product] of initialProducts) {
    products.set(id, structuredClone(product));
  }
  productVariants.clear();
  createdOrders = [];
  orderItemSubmissions = new Map();
  stockMovements = [];
  nextOrderId = 5;
  orderSequenceResetCount = 0;
  transactionTail = Promise.resolve();
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
      findMany: async ({ where }) =>
        createdOrders.filter((entry) => entry.status === where.status),
      findFirst: async ({ where }) => {
        const order = createdOrders.find(
          (entry) =>
            entry.tableId === where.tableId &&
            (where.id?.not === undefined || entry.id !== where.id.not) &&
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
        } else {
          Object.assign(order, data);
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
    orderItemSubmission: {
      findUnique: async ({ where }) =>
        orderItemSubmissions.get(
          `${where.orderId_idempotencyKey.orderId}:${where.orderId_idempotencyKey.idempotencyKey}`,
        ) ?? null,
      create: async ({ data }) => {
        const key = `${data.orderId}:${data.idempotencyKey}`;
        if (orderItemSubmissions.has(key)) {
          throw new Error("Duplicate order item submission");
        }
        orderItemSubmissions.set(key, data);
        return data;
      },
    },
    payment: {
      create: async ({ data }) => ({
        ...data,
        id: 1,
        method: null,
        status: "PENDING",
        createdAt: new Date().toISOString(),
      }),
      update: async ({ where, data }) => {
        const order = createdOrders.find((entry) => entry.id === where.orderId);
        Object.assign(order.payment, data);
        return order.payment;
      },
      updateMany: async ({ where, data }) => {
        const order = createdOrders.find(
          (entry) => entry.id === where.orderId,
        );
        order.payment.amount =
          typeof data.amount === "object"
            ? toDecimalString(
                toMinorUnits(order.payment.amount) +
                  toMinorUnits(data.amount.increment),
              )
            : data.amount;
        return { count: 1 };
      },
    },
    product: {
      findUnique: async ({ where }) => products.get(where.id) ?? null,
      update: async ({ where, data }) => {
        const product = products.get(where.id);
        Object.assign(product, data);
        return product;
      },
      updateMany: async ({ where, data }) => {
        const product = products.get(where.id);
        if (
          !product ||
          (where.lastStockUpdatedAt?.not === null &&
            product.lastStockUpdatedAt == null) ||
          (where.stock?.gte !== undefined &&
            Number(product.stock) < where.stock.gte)
        ) {
          return { count: 0 };
        }
        if (data.stock?.decrement !== undefined) {
          product.stock -= data.stock.decrement;
        }
        if (data.lastStockUpdatedAt !== undefined) {
          product.lastStockUpdatedAt = data.lastStockUpdatedAt;
        }
        return { count: 1 };
      },
    },
    productStockMovement: {
      create: async ({ data }) => {
        const movement = { id: stockMovements.length + 1, ...data };
        stockMovements.push(movement);
        return movement;
      },
      findMany: async ({ where }) =>
        stockMovements.filter(
          (movement) =>
            movement.orderId === where.orderId &&
            movement.movementType === where.movementType,
        ),
    },
    productVariant: {
      findFirst: async ({ where }) =>
        productVariants.get(where.id)?.productId === where.productId &&
        productVariants.get(where.id)?.isActive
          ? productVariants.get(where.id)
          : null,
    },
    restaurantTable: {
      findUnique: async ({ where }) => tables.get(where.id) ?? null,
      update: async ({ where, data }) => {
        const table = tables.get(where.id);
        Object.assign(table, data);
        return table;
      },
    },
    restaurantSettings: {
      findUnique: async () => ({
        id: 1,
        gstRate: 5,
        gstEnabled: true,
        orderReportsPath: "",
        restaurantAddress: "",
        fssaiEnabled: false,
        fssaiNumber: "",
        gstinEnabled: false,
        gstinNumber: "",
      }),
      upsert: async ({ create, update, where }) => ({
        id: where?.id ?? create.id ?? 1,
        gstRate: update?.gstRate ?? create.gstRate ?? 5,
        gstEnabled: update?.gstEnabled ?? create.gstEnabled ?? true,
        orderReportsPath: update?.orderReportsPath ?? create.orderReportsPath ?? "",
        restaurantAddress: update?.restaurantAddress ?? create.restaurantAddress ?? "",
        fssaiEnabled: update?.fssaiEnabled ?? create.fssaiEnabled ?? false,
        fssaiNumber: update?.fssaiNumber ?? create.fssaiNumber ?? "",
        gstinEnabled: update?.gstinEnabled ?? create.gstinEnabled ?? false,
        gstinNumber: update?.gstinNumber ?? create.gstinNumber ?? "",
      }),
    },
  };

  prisma.restaurantTable.findUnique = async ({ where }) =>
    tables.get(where.id) ?? null;
  prisma.restaurantSettings = transactionClient.restaurantSettings;
  prisma.order = transactionClient.order;
  prisma.orderItem = transactionClient.orderItem;
  prisma.payment = transactionClient.payment;
  prisma.user.findUnique = async ({ where }) => users.get(where.id) ?? null;
  prisma.product.findUnique = async ({ where }) => products.get(where.id) ?? null;
  prisma.productVariant = transactionClient.productVariant;
  prisma.$transaction = async (callback) => {
    const previousTransaction = transactionTail;
    let releaseTransaction;
    transactionTail = new Promise((resolve) => {
      releaseTransaction = resolve;
    });
    await previousTransaction;

    const productSnapshot = new Map(
      [...products].map(([id, product]) => [id, structuredClone(product)]),
    );
    const tableSnapshot = new Map(
      [...tables].map(([id, table]) => [id, structuredClone(table)]),
    );
    const ordersSnapshot = structuredClone(createdOrders);
    const movementsSnapshot = structuredClone(stockMovements);
    const submissionsSnapshot = new Map(orderItemSubmissions);
    const previousOrderId = nextOrderId;
    const previousSequenceResetCount = orderSequenceResetCount;
    try {
      return await callback(transactionClient);
    } catch (error) {
      for (const [id, product] of productSnapshot) {
        Object.assign(products.get(id), product);
      }
      for (const [id, table] of tableSnapshot) {
        Object.assign(tables.get(id), table);
      }
      createdOrders = ordersSnapshot;
      stockMovements = movementsSnapshot;
      orderItemSubmissions = submissionsSnapshot;
      nextOrderId = previousOrderId;
      orderSequenceResetCount = previousSequenceResetCount;
      throw error;
    } finally {
      releaseTransaction();
    }
  };
}

function createAppServer() {
  const app = express();
  app.use(express.json());
  app.use(optionalAuth);
  app.use("/api/orders", ordersRouter);
  app.use("/api/billing", billingRouter);
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

async function requestCancel(baseUrl, orderId, token) {
  return fetch(`${baseUrl}/api/orders/${orderId}/cancel`, {
    method: "PATCH",
    headers: { Authorization: ["Bear", `er ${token}`].join("") },
  });
}

function initializeInventory(productId, stock) {
  Object.assign(products.get(productId), {
    stock,
    stockUnit: "pcs",
    lowStockThreshold: 0,
    lastStockUpdatedAt: new Date(),
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
  assert.equal("comboNameSnapshot" in body.order.items[0], false);
  assert.equal("comboSnapshot" in body.order.items[0], false);
  assert.equal(createdOrders.length, 1);
  assert.equal(body.order.id, 1);
  assert.equal(orderSequenceResetCount, 1);
  assert.equal("stock" in products.get(41), false);
  assert.equal("stock" in products.get(42), false);
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
  assert.equal("stock" in products.get(41), false);
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
  assert.equal("stock" in products.get(41), false);
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
  assert.equal("stock" in products.get(41), false);
  assert.equal(tables.get(2).status, "AVAILABLE");
});

test(`PATCH /api/orders/:id/add-items uses exact line totals without stock limits (${routePath})`, async () => {
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
  assert.equal("stock" in products.get(41), false);
  assert.equal("stock" in products.get(42), false);
});

test(`PATCH /api/orders/:id/add-items updates a sent order once and refreshes cashier data (${routePath})`, async () => {
  resetMockData();
  installPrismaMocks();
  const baseUrl = await createAppServer();
  const waiterToken = createToken({ id: 2, username: "waiter", role: "WAITER" });
  const cashierToken = createToken({ id: 3, username: "cashier", role: "CASHIER" });
  const created = await requestOrder(baseUrl, {
    token: waiterToken,
    payload: { tableId: 1, items: [{ productId: 41, quantity: 1 }] },
  });
  const { order: originalOrder } = await created.json();
  const sent = await fetch(
    `${baseUrl}/api/orders/${originalOrder.id}/send-to-cashier`,
    { method: "PATCH", headers: { Authorization: `Bearer ${waiterToken}` } },
  );
  assert.equal(sent.status, 200);

  const addItems = () =>
    fetch(`${baseUrl}/api/orders/${originalOrder.id}/add-items`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${waiterToken}`,
        "Idempotency-Key": "waiter-add-001",
      },
      body: JSON.stringify({
        items: [
          { productId: 41, quantity: 1 },
          { productId: 42, quantity: 1 },
        ],
      }),
    });

  const firstAdd = await addItems();
  assert.equal(firstAdd.status, 200);
  const firstBody = await firstAdd.json();
  assert.equal(firstBody.order.id, originalOrder.id);
  assert.equal(firstBody.order.status, "READY_FOR_BILLING");
  assert.equal(firstBody.order.total, "28.00");
  assert.equal(firstBody.order.payment.amount, "29.40");
  assert.deepEqual(
    firstBody.order.items.map(({ productId, quantity }) => ({ productId, quantity })),
    [
      { productId: 41, quantity: 1 },
      { productId: 41, quantity: 1 },
      { productId: 42, quantity: 1 },
    ],
  );

  const retry = await addItems();
  assert.equal(retry.status, 200);
  const retryBody = await retry.json();
  assert.equal(retryBody.order.id, originalOrder.id);
  assert.equal(retryBody.order.items.length, 3);
  assert.equal(orderItemSubmissions.size, 1);

  const mismatchedRetry = await fetch(
    `${baseUrl}/api/orders/${originalOrder.id}/add-items`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${waiterToken}`,
        "Idempotency-Key": "waiter-add-001",
      },
      body: JSON.stringify({ items: [{ productId: 42, quantity: 2 }] }),
    },
  );
  assert.equal(mismatchedRetry.status, 409);
  assert.equal(createdOrders[0].items.length, 3);

  const cashierOrders = await fetch(`${baseUrl}/api/billing/orders`, {
    headers: { Authorization: `Bearer ${cashierToken}` },
  });
  assert.equal(cashierOrders.status, 200);
  const cashierBody = await cashierOrders.json();
  assert.equal(cashierBody.length, 1);
  assert.equal(cashierBody[0].id, originalOrder.id);
  assert.equal(cashierBody[0].items.length, 3);
  assert.equal(cashierBody[0].grandTotal, 29.4);
});

test(`PATCH /api/orders/:id/add-items rejects closed orders (${routePath})`, async () => {
  for (const { status, paymentStatus } of [
    { status: "CANCELLED", paymentStatus: "PENDING" },
    { status: "COMPLETED", paymentStatus: "PAID" },
    { status: "READY_FOR_BILLING", paymentStatus: "PAID" },
  ]) {
    resetMockData();
    installPrismaMocks();
    const baseUrl = await createAppServer();
    const waiterToken = createToken({ id: 2, username: "waiter", role: "WAITER" });
    const created = await requestOrder(baseUrl, {
      token: waiterToken,
      payload: { tableId: 1, items: [{ productId: 41, quantity: 1 }] },
    });
    const { order } = await created.json();
    createdOrders[0].status = status;
    createdOrders[0].payment.status = paymentStatus;

    const response = await fetch(`${baseUrl}/api/orders/${order.id}/add-items`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${waiterToken}`,
        "Idempotency-Key": `closed-${status}`,
      },
      body: JSON.stringify({ items: [{ productId: 42, quantity: 1 }] }),
    });
    assert.equal(response.status, 400);
    assert.equal(createdOrders[0].items.length, 1);
  }
});

test(`PATCH /api/orders/:id/add-items preserves the Parcel table lifecycle (${routePath})`, async () => {
  resetMockData();
  installPrismaMocks();
  const baseUrl = await createAppServer();
  const waiterToken = createToken({ id: 2, username: "waiter", role: "WAITER" });
  const created = await requestOrder(baseUrl, {
    token: waiterToken,
    payload: { tableId: 2, items: [{ productId: 41, quantity: 1 }] },
  });
  const { order } = await created.json();
  const sent = await fetch(
    `${baseUrl}/api/orders/${order.id}/send-to-cashier`,
    { method: "PATCH", headers: { Authorization: `Bearer ${waiterToken}` } },
  );
  assert.equal(sent.status, 200);

  const response = await fetch(`${baseUrl}/api/orders/${order.id}/add-items`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${waiterToken}`,
      "Idempotency-Key": "parcel-add-001",
    },
    body: JSON.stringify({ items: [{ productId: 42, quantity: 1 }] }),
  });
  assert.equal(response.status, 200);
  const updated = await response.json();
  assert.equal(updated.order.id, order.id);
  assert.equal(updated.order.items.length, 2);
  assert.equal(tables.get(2).status, "AVAILABLE");
});

test(`POST /api/orders prices combo products once and snapshots included items (${routePath})`, async () => {
  resetMockData();
  installPrismaMocks();
  const baseUrl = await createAppServer();
  const token = createToken({ id: 2, username: "waiter", role: "WAITER" });
  const couplesItems = products.get(43).comboItems;
  const couplesResponse = await requestOrder(baseUrl, {
    token,
    payload: {
      tableId: 1,
      items: [{ productId: 43, quantity: 2, price: 0.01 }],
    },
  });
  assert.equal(couplesResponse.status, 201);
  const couples = await couplesResponse.json();
  assert.equal(couples.order.total, "998.00");
  assert.equal(couples.order.items.length, 1);
  assert.equal(couples.order.items[0].unitPrice, "499.00");
  assert.equal(couples.order.items[0].subtotal, "998.00");
  assert.equal(couples.order.items[0].comboNameSnapshot, "Couples/Friends Combo");
  assert.deepEqual(couples.order.items[0].comboSnapshot, couplesItems);

  products.get(43).name = "Renamed in catalog";
  products.get(43).comboItems = [{ name: "Changed item", quantity: 1 }];
  assert.equal(couples.order.items[0].comboNameSnapshot, "Couples/Friends Combo");
  assert.deepEqual(couples.order.items[0].comboSnapshot, couplesItems);
  products.get(43).name = "Couples/Friends Combo";
  products.get(43).comboItems = couplesItems;

  resetMockData();
  installPrismaMocks();
  const familyResponse = await requestOrder(baseUrl, {
    token,
    payload: {
      tableId: 2,
      items: [
        { productId: 44, quantity: 1 },
        { productId: 42, quantity: 2, price: 0.01 },
      ],
    },
  });
  assert.equal(familyResponse.status, 201);
  const family = await familyResponse.json();
  assert.equal(family.order.total, "1005.00");
  assert.equal(family.order.items.length, 2);
  assert.equal(family.order.items[0].unitPrice, "999.00");
  assert.equal(family.order.items[0].subtotal, "999.00");
  assert.equal(family.order.items[0].comboNameSnapshot, "Family Combo");
  assert.deepEqual(family.order.items[0].comboSnapshot, products.get(44).comboItems);
  assert.equal(family.order.items[1].subtotal, "6.00");

  const cashierResponse = await fetch(
    `${baseUrl}/api/orders/${family.order.id}/send-to-cashier`,
    { method: "PATCH", headers: { Authorization: `Bearer ${token}` } },
  );
  assert.equal(cashierResponse.status, 200);
  assert.equal(createdOrders[0].payment.amount, "1055.25");
  const cashierToken = createToken({
    id: 3,
    username: "cashier",
    role: "CASHIER",
  });
  const cashierOrdersResponse = await fetch(`${baseUrl}/api/billing/orders`, {
    headers: { Authorization: `Bearer ${cashierToken}` },
  });
  assert.equal(cashierOrdersResponse.status, 200);
  const cashierOrders = await cashierOrdersResponse.json();
  assert.equal(cashierOrders.length, 1);
  assert.equal(cashierOrders[0].id, family.order.id);
  assert.deepEqual(
    cashierOrders[0].items[0].comboSnapshot,
    products.get(44).comboItems,
  );
});

test(`POST /api/orders rejects misconfigured combo catalog records (${routePath})`, async () => {
  for (const mutate of [
    (product) => { product.price = 450; },
    (product) => { product.comboItems = [{ name: "Other item", quantity: 1 }]; },
  ]) {
    resetMockData();
    installPrismaMocks();
    mutate(products.get(43));
    const baseUrl = await createAppServer();
    const token = createToken({ id: 2, username: "waiter", role: "WAITER" });
    const response = await requestOrder(baseUrl, {
      token,
      payload: {
        tableId: 1,
        items: [{ productId: 43, quantity: 1, price: 0.01 }],
      },
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).message, /misconfigured/i);
    assert.equal(createdOrders.length, 0);
    assert.equal(tables.get(1).status, "AVAILABLE");
  }
});

test(`initialized inventory is deducted and cancellation restores only the order's sale movement (${routePath})`, async () => {
  resetMockData();
  initializeInventory(41, 5);
  installPrismaMocks();
  const baseUrl = await createAppServer();
  const token = createToken({ id: 2, username: "waiter", role: "WAITER" });
  const created = await requestOrder(baseUrl, {
    token,
    payload: { tableId: 1, items: [{ productId: 41, quantity: 2 }] },
  });

  assert.equal(created.status, 201);
  const { order } = await created.json();
  assert.equal(products.get(41).stock, 3);
  assert.deepEqual(
    stockMovements.map(({ movementType, orderId, quantity, previousStock, newStock }) => ({
      movementType,
      orderId,
      quantity,
      previousStock,
      newStock,
    })),
    [{
      movementType: "SALE",
      orderId: order.id,
      quantity: 2,
      previousStock: 5,
      newStock: 3,
    }],
  );

  const cancelled = await requestCancel(baseUrl, order.id, token);
  assert.equal(cancelled.status, 200);
  assert.equal(products.get(41).stock, 5);
  assert.equal(stockMovements[1].movementType, "CANCEL_RESTOCK");
  assert.equal(stockMovements[1].orderId, order.id);
  assert.equal(stockMovements[1].previousStock, 3);
  assert.equal(stockMovements[1].newStock, 5);

  const duplicateCancellation = await requestCancel(baseUrl, order.id, token);
  assert.equal(duplicateCancellation.status, 409);
  assert.equal(products.get(41).stock, 5);
  assert.equal(stockMovements.length, 2);
});

test(`adding order items deducts stock and cancellation restores every sale movement (${routePath})`, async () => {
  resetMockData();
  initializeInventory(41, 5);
  installPrismaMocks();
  const baseUrl = await createAppServer();
  const token = createToken({ id: 2, username: "waiter", role: "WAITER" });
  const created = await requestOrder(baseUrl, {
    token,
    payload: { tableId: 1, items: [{ productId: 41, quantity: 1 }] },
  });
  assert.equal(created.status, 201);
  const { order } = await created.json();

  const added = await fetch(`${baseUrl}/api/orders/${order.id}/add-items`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ items: [{ productId: 41, quantity: 2 }] }),
  });
  assert.equal(added.status, 200);
  assert.equal(products.get(41).stock, 2);
  assert.deepEqual(
    stockMovements
      .filter(({ movementType }) => movementType === "SALE")
      .map(({ quantity }) => quantity),
    [1, 2],
  );

  const cancelled = await requestCancel(baseUrl, order.id, token);
  assert.equal(cancelled.status, 200);
  assert.equal(products.get(41).stock, 5);
  assert.deepEqual(
    stockMovements
      .filter(({ movementType }) => movementType === "CANCEL_RESTOCK")
      .map(({ quantity }) => quantity),
    [1, 2],
  );
});

test(`insufficient initialized stock rolls back the entire order (${routePath})`, async () => {
  resetMockData();
  initializeInventory(41, 1);
  installPrismaMocks();
  const baseUrl = await createAppServer();
  const token = createToken({ id: 2, username: "waiter", role: "WAITER" });
  const response = await requestOrder(baseUrl, {
    token,
    payload: { tableId: 1, items: [{ productId: 41, quantity: 2 }] },
  });

  assert.equal(response.status, 409);
  assert.match((await response.json()).message, /Insufficient stock/);
  assert.equal(products.get(41).stock, 1);
  assert.equal(createdOrders.length, 0);
  assert.equal(stockMovements.length, 0);
  assert.equal(tables.get(1).status, "AVAILABLE");
});

test(`combo quantities consume combo stock units, not unlinked component stock (${routePath})`, async () => {
  resetMockData();
  initializeInventory(41, 20);
  initializeInventory(42, 30);
  initializeInventory(43, 2);
  installPrismaMocks();
  const baseUrl = await createAppServer();
  const token = createToken({ id: 2, username: "waiter", role: "WAITER" });
  const response = await requestOrder(baseUrl, {
    token,
    payload: { tableId: 1, items: [{ productId: 43, quantity: 2 }] },
  });

  assert.equal(response.status, 201, await response.clone().text());
  assert.equal(products.get(43).stock, 0);
  assert.equal(products.get(41).stock, 20);
  assert.equal(products.get(42).stock, 30);
  assert.equal(stockMovements.length, 1);
  assert.equal(stockMovements[0].productId, 43);
  assert.equal(stockMovements[0].quantity, 2);
  assert.equal(stockMovements[0].movementType, "SALE");
});

test(`concurrent orders cannot consume the same final stock unit (${routePath})`, async () => {
  resetMockData();
  initializeInventory(41, 1);
  installPrismaMocks();
  const baseUrl = await createAppServer();
  const token = createToken({ id: 2, username: "waiter", role: "WAITER" });
  const placeOrder = (tableId) =>
    requestOrder(baseUrl, {
      token,
      payload: { tableId, items: [{ productId: 41, quantity: 1 }] },
    });
  const responses = await Promise.all([placeOrder(1), placeOrder(2)]);

  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [201, 409],
  );
  assert.equal(products.get(41).stock, 0);
  assert.equal(createdOrders.length, 1);
  assert.equal(stockMovements.length, 1);
  assert.equal(stockMovements[0].movementType, "SALE");
});

test(`PATCH /api/orders/:id/cancel retains history and frees the table (${routePath})`, async () => {
  resetMockData();
  installPrismaMocks();
  const baseUrl = await createAppServer();
  const waiterToken = createToken({
    id: 2,
    username: "waiter",
    role: "WAITER",
  });
  const created = await requestOrder(baseUrl, {
    token: waiterToken,
    payload: {
      tableId: 1,
      items: [{ productId: 41, quantity: 2 }],
    },
  });
  assert.equal(created.status, 201);
  const { order } = await created.json();
  assert.equal("stock" in products.get(41), false);

  const otherWaiterToken = createToken({
    id: 4,
    username: "other-waiter",
    role: "WAITER",
  });
  const forbidden = await fetch(`${baseUrl}/api/orders/${order.id}/cancel`, {
    method: "PATCH",
  });
  assert.equal(forbidden.status, 401);
  const forbiddenByOwnership = await requestCancel(
    baseUrl,
    order.id,
    otherWaiterToken,
  );
  assert.equal(forbiddenByOwnership.status, 403);
  assert.equal("stock" in products.get(41), false);

  const response = await requestCancel(baseUrl, order.id, waiterToken);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).order.status, "CANCELLED");
  assert.equal(createdOrders.length, 1);
  assert.equal(createdOrders[0].status, "CANCELLED");
  assert.equal("stock" in products.get(41), false);
  assert.equal(tables.get(1).status, "AVAILABLE");
});

test(`PATCH /api/orders/:id/cancel rejects paid orders without changing table (${routePath})`, async () => {
  resetMockData();
  installPrismaMocks();
  const baseUrl = await createAppServer();
  const waiterToken = createToken({
    id: 2,
    username: "waiter",
    role: "WAITER",
  });
  const created = await requestOrder(baseUrl, {
    token: waiterToken,
    payload: {
      tableId: 1,
      items: [{ productId: 41, quantity: 1 }],
    },
  });
  const { order } = await created.json();
  createdOrders[0].payment.status = "PAID";

  const response = await requestCancel(baseUrl, order.id, waiterToken);
  assert.equal(response.status, 409);
  assert.equal(createdOrders[0].status, "CONFIRMED");
  assert.equal("stock" in products.get(41), false);
  assert.equal(tables.get(1).status, "OCCUPIED");
});

test(`POST /api/orders enforces authentication and validation while allowing unlimited quantities (${routePath})`, async () => {
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

  const unlimitedQuantity = await requestOrder(baseUrl, {
    token: createToken({ id: 1, username: "admin", role: "ADMIN" }),
    payload: { tableId: 1, items: [{ productId: 41, quantity: 100 }] },
  });
  assert.equal(unlimitedQuantity.status, 201);
  assert.equal((await unlimitedQuantity.json()).order.items[0].quantity, 100);
  assert.equal("stock" in products.get(41), false);
  assert.equal(createdOrders.length, 1);
});
