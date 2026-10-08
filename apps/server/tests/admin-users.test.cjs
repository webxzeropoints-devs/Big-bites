const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const express = require("express");

process.env.AUTH_SECRET = "isolated-admin-user-test-secret";

const { prisma } = require("../dist/config/database.js");
const { createToken, optionalAuth } = require("../dist/middleware/auth.js");
const adminRouter = require("../dist/routes/admin.js").default;

const adminToken = createToken({
  id: 1,
  username: "admin",
  role: "ADMIN",
});
const users = new Map();
const userOrderCounts = new Map();
const servers = [];
let deletedUserIds;

function resetState() {
  users.clear();
  userOrderCounts.clear();
  deletedUserIds = [];
  users.set(1, { id: 1, role: "ADMIN" });
  users.set(2, { id: 2, role: "WAITER" });
}

function installPrismaMocks() {
  prisma.user.findUnique = async ({ where }) => users.get(where.id) ?? null;
  prisma.user.count = async ({ where }) =>
    [...users.values()].filter((user) => user.role === where.role).length;
  prisma.user.delete = async ({ where }) => {
    deletedUserIds.push(where.id);
    const user = users.get(where.id);
    users.delete(where.id);
    return user;
  };
  prisma.order.count = async ({ where }) =>
    userOrderCounts.get(where.waiterId) ?? 0;
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

async function deleteUser(baseUrl, userId) {
  return fetch(`${baseUrl}/api/admin/users/${userId}`, {
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

test("admin can delete a waiter without order history", async () => {
  resetState();
  installPrismaMocks();
  const baseUrl = await createAppServer();
  const response = await deleteUser(baseUrl, 2);

  assert.equal(response.status, 204);
  assert.deepEqual(deletedUserIds, [2]);
  assert.equal(users.has(2), false);
});

test("users with order history cannot be deleted", async () => {
  resetState();
  userOrderCounts.set(2, 1);
  installPrismaMocks();
  const baseUrl = await createAppServer();
  const response = await deleteUser(baseUrl, 2);

  assert.equal(response.status, 409);
  assert.match((await response.json()).message, /order history/);
  assert.deepEqual(deletedUserIds, []);
});

test("admin cannot delete their own or the last admin account", async () => {
  resetState();
  installPrismaMocks();
  const baseUrl = await createAppServer();

  const selfResponse = await deleteUser(baseUrl, 1);
  assert.equal(selfResponse.status, 409);

  users.set(1, { id: 1, role: "CASHIER" });
  users.set(3, { id: 3, role: "ADMIN" });
  const lastAdminResponse = await deleteUser(baseUrl, 3);
  assert.equal(lastAdminResponse.status, 409);
  assert.deepEqual(deletedUserIds, []);
});
