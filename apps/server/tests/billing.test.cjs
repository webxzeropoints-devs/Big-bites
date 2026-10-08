const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const express = require("express");

process.env.AUTH_SECRET = "isolated-billing-route-test-secret";

const { prisma } = require("../dist/config/database.js");
const { createToken, optionalAuth } = require("../dist/middleware/auth.js");
const billingRouter = require("../dist/routes/billing.js").default;

const userToken = createToken({
  id: 1,
  username: "cashier",
  role: "CASHIER",
});
const adminToken = createToken({
  id: 2,
  username: "admin",
  role: "ADMIN",
});
const tables = new Map();
const orders = new Map();
const servers = [];
const restaurantSettings = {
  gstRate: "5.00",
  gstEnabled: true,
  orderReportsPath: "",
};

function makeOrder(id, tableId, total, options = {}) {
  return {
    id,
    tableId,
    total,
    gstRate: options.gstRate ?? "5.00",
    gstEnabled: options.gstEnabled ?? true,
    discountType: options.discountType ?? null,
    discountValue: options.discountValue ?? null,
    discountAmount: options.discountAmount ?? "0.00",
    status: options.status ?? "READY_FOR_BILLING",
    createdAt: new Date(),
    updatedAt: new Date(),
    payment: options.payment ?? {
      id: id + 1000,
      orderId: id,
      amount: total,
      status: "PENDING",
      method: null,
    },
    items: [],
  };
}

function resetState(orderRows = [makeOrder(1, 1, "1.00")]) {
  orders.clear();
  tables.clear();
  orderRows.forEach((order) => orders.set(order.id, order));
  orderRows.forEach((order) => {
    if (!tables.has(order.tableId)) {
      tables.set(order.tableId, {
        id: order.tableId,
        number: order.tableId,
        isParcel: order.tableId === 2,
        status: "OCCUPIED",
      });
    }
  });
}

function installPrismaMocks() {
  const transactionClient = {
    $queryRaw: async () => [],
    restaurantSettings: {
      findUnique: async () => restaurantSettings,
      upsert: async () => restaurantSettings,
    },
    order: {
      findUnique: async ({ where }) => orders.get(where.id) ?? null,
      findMany: async ({ where }) =>
        [...orders.values()]
          .filter(
            (order) =>
              order.tableId === where.tableId &&
              order.status === where.status,
          )
          .sort((left, right) => left.id - right.id),
      update: async ({ where, data }) => {
        const order = orders.get(where.id);
        Object.assign(order, data);
        return order;
      },
      findFirst: async () => null,
    },
    payment: {
      update: async ({ where, data }) => {
        const order = [...orders.values()].find(
          (entry) => entry.id === where.orderId,
        );
        Object.assign(order.payment, data);
        return order.payment;
      },
      create: async ({ data }) => {
        const order = orders.get(data.orderId);
        order.payment = { id: data.orderId + 1000, ...data };
        return order.payment;
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
  prisma.order = transactionClient.order;
  prisma.restaurantTable = transactionClient.restaurantTable;
  prisma.restaurantSettings = transactionClient.restaurantSettings;
}

function createAppServer() {
  const app = express();
  app.use(express.json());
  app.use(optionalAuth);
  app.use("/api/billing", billingRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

async function request(baseUrl, path, { token, method = "POST", body } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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

test("cash payment uses authoritative GST, exact paise change, persists tender, and rejects retries", async () => {
  resetState();
  installPrismaMocks();
  const baseUrl = await createAppServer();

  const unauthorized = await request(baseUrl, "/api/billing/orders/1/pay", {
    body: { method: "CASH", amountReceived: "2.00" },
  });

  assert.equal(unauthorized.status, 401);

  const invalidCash = await request(baseUrl, "/api/billing/orders/1/pay", {
    token: userToken,
    body: { method: "CASH", amountReceived: "2.001" },
  });
  assert.equal(invalidCash.status, 400);

  const insufficient = await request(baseUrl, "/api/billing/orders/1/pay", {
    token: userToken,
    body: { method: "CASH", amountReceived: "1.04" },
  });
  assert.equal(insufficient.status, 400);
  assert.equal(orders.get(1).payment.status, "PENDING");

  const paid = await request(baseUrl, "/api/billing/orders/1/pay", {
    token: userToken,
    body: { method: "CASH", amountReceived: "2.00" },
  });
  assert.equal(paid.status, 200);
  const body = await paid.json();
  assert.equal(body.cgstAmount, 0.03);
  assert.equal(body.sgstAmount, 0.02);
  assert.equal(body.gstAmount, 0.05);
  assert.equal(body.total, 1.05);
  assert.equal(body.amountReceived, 2);
  assert.equal(body.change, 0.95);
  assert.equal(orders.get(1).payment.amount, "1.05");
  assert.equal(orders.get(1).payment.amountReceived, "2.00");
  assert.equal(orders.get(1).payment.change, "0.95");
  assert.equal(orders.get(1).status, "COMPLETED");

  const retry = await request(baseUrl, "/api/billing/orders/1/pay", {
    token: userToken,
    body: { method: "CASH", amountReceived: "2.00" },
  });
  assert.equal(retry.status, 409);
});

test("GST off removes tax from the bill and persists the paid GST state", async () => {
  restaurantSettings.gstEnabled = false;
  resetState([makeOrder(7, 1, "10.00")]);
  installPrismaMocks();
  const baseUrl = await createAppServer();

  try {
    const response = await request(
      baseUrl,
      "/api/billing/orders/7/pay",
      {
        token: userToken,
        body: { method: "UPI" },
      },
    );
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.gstEnabled, false);
    assert.equal(result.gstRate, 0);
    assert.equal(result.gstAmount, 0);
    assert.equal(result.total, 10);
    assert.equal(orders.get(7).gstEnabled, false);
    assert.equal(orders.get(7).gstRate, 0);
    assert.equal(orders.get(7).payment.amount, "10.00");
  } finally {
    restaurantSettings.gstEnabled = true;
  }
});

test("discount updates validate amounts and percentage discounts before GST", async () => {
  resetState([makeOrder(1, 1, "10.00")]);
  installPrismaMocks();
  const baseUrl = await createAppServer();

  const tooPrecise = await request(
    baseUrl,
    "/api/billing/orders/1/discount",
    {
      token: adminToken,
      method: "PATCH",
      body: { discountType: "AMOUNT", discountValue: "0.001" },
    },
  );
  assert.equal(tooPrecise.status, 400);

  const tooLarge = await request(baseUrl, "/api/billing/orders/1/discount", {
    token: adminToken,
    method: "PATCH",
    body: { discountType: "AMOUNT", discountValue: "10.01" },
  });
  assert.equal(tooLarge.status, 400);

  const saved = await request(baseUrl, "/api/billing/orders/1/discount", {
    token: adminToken,
    method: "PATCH",
    body: { discountType: "PERCENTAGE", discountValue: "10.00" },
  });
  assert.equal(saved.status, 200);
  const body = await saved.json();
  assert.equal(body.subtotal, 10);
  assert.equal(body.discountAmount, 1);
  assert.equal(body.taxableSubtotal, 9);
  assert.equal(body.cgstAmount, 0.23);
  assert.equal(body.sgstAmount, 0.22);
  assert.equal(body.grandTotal, 9.45);
  assert.equal(orders.get(1).discountAmount, "1.00");
  assert.equal(orders.get(1).payment.amount, "9.45");
});

test("fixed discount persists the GST-inclusive grand total due", async () => {
  resetState([makeOrder(1, 1, "205.00")]);
  installPrismaMocks();
  const baseUrl = await createAppServer();
  const response = await request(baseUrl, "/api/billing/orders/1/discount", {
    token: adminToken,
    method: "PATCH",
    body: { discountType: "AMOUNT", discountValue: "5.00" },
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.taxableSubtotal, 200);
  assert.equal(body.gstAmount, 10);
  assert.equal(body.grandTotal, 210);
  assert.equal(orders.get(1).payment.amount, "210.00");
});

test("non-cash payment rejects tender input and records exact paid amount", async () => {
  resetState([makeOrder(1, 1, "10.00")]);
  installPrismaMocks();
  const baseUrl = await createAppServer();

  const invalidTender = await request(baseUrl, "/api/billing/orders/1/pay", {
    token: userToken,
    body: { method: "UPI", amountReceived: "12.00" },
  });
  assert.equal(invalidTender.status, 400);

  const paid = await request(baseUrl, "/api/billing/orders/1/pay", {
    token: userToken,
    body: { method: "CARD" },
  });
  assert.equal(paid.status, 200);
  const body = await paid.json();
  assert.equal(body.total, 10.5);
  assert.equal(body.amountReceived, null);
  assert.equal(body.change, null);
  assert.equal(orders.get(1).payment.amount, "10.50");
  assert.equal(orders.get(1).payment.amountReceived, null);
  assert.equal(orders.get(1).payment.change, null);
});

test("table payment sums rounded invoice totals and records cash tender/change", async () => {
  resetState([
    makeOrder(1, 1, "1.00"),
    makeOrder(2, 1, "10.00", {
      discountType: "PERCENTAGE",
      discountValue: "10.00",
      discountAmount: "1.00",
    }),
  ]);
  installPrismaMocks();
  const baseUrl = await createAppServer();
  const response = await request(baseUrl, "/api/billing/tables/1/pay", {
    token: userToken,
    body: { method: "CASH", amountReceived: "12.00" },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.subtotal, 11);
  assert.equal(body.discountAmount, 1);
  assert.equal(body.taxableSubtotal, 10);
  assert.equal(body.gstAmount, 0.5);
  assert.equal(body.total, 10.5);
  assert.equal(body.amountReceived, 12);
  assert.equal(body.change, 1.5);
  assert.equal(orders.get(1).payment.amountReceived, "2.55");
  assert.equal(orders.get(1).payment.change, "1.50");
  assert.equal(orders.get(2).payment.amountReceived, "9.45");
  assert.equal(orders.get(2).payment.change, "0.00");
});

test("payment routes reject null or malformed request bodies without crashing", async () => {
  resetState([makeOrder(1, 1, "1.00")]);
  installPrismaMocks();
  const baseUrl = await createAppServer();

  const singleOrder = await request(baseUrl, "/api/billing/orders/1/pay", {
    token: userToken,
    body: null,
  });
  assert.equal(singleOrder.status, 400);

  const table = await request(baseUrl, "/api/billing/tables/1/pay", {
    token: userToken,
    body: null,
  });
  assert.equal(table.status, 400);
});
