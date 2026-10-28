const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const express = require("express");

process.env.DATABASE_URL = "postgresql://127.0.0.1:55439/big_bites_test";

const { prisma } = require("../dist/config/database.js");
const productsRouter = require("../dist/routes/products.js").default;
const servers = [];

function createAppServer() {
  const app = express();
  app.use("/api/products", productsRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
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

test("menu endpoints return active categories and products with normalized prices and variants", async () => {
  const categories = [
    {
      id: 4,
      name: "Bread",
      sortOrder: 1,
      _count: { products: 1 },
    },
    {
      id: 2,
      name: "Biryani",
      sortOrder: 1,
      _count: { products: 1 },
    },
  ];
  const products = [
    {
      id: 10,
      name: "Butter Naan",
      price: "50.00",
      isVegetarian: true,
      isSignature: false,
      isActive: true,
      stock: 8,
      stockUnit: "pcs",
      lowStockThreshold: 2,
      lastStockUpdatedAt: "2026-10-28T00:00:00.000Z",
      categoryId: 4,
      category: { id: 4, name: "Bread", sortOrder: 1 },
      variants: [],
    },
    {
      id: 11,
      name: "Chicken Briyani",
      price: "150.00",
      isVegetarian: false,
      isSignature: false,
      isActive: true,
      categoryId: 2,
      category: { id: 2, name: "Biryani", sortOrder: 1 },
      variants: [
        { id: 31, name: "Half", price: "100.00" },
        { id: 32, name: "Full", price: "150.00" },
      ],
    },
    {
      id: 12,
      name: "Couples/Friends Combo",
      price: "499.00",
      isVegetarian: false,
      isSignature: false,
      isActive: true,
      categoryId: 2,
      comboItems: [
        { name: "Chicken Rice", quantity: 1 },
        { name: "Chicken Briyani", quantity: 1 },
        { name: "BBQ Quarter", quantity: 1 },
        { name: "Chicken Lollipop", quantity: 1 },
      ],
      category: { id: 2, name: "Biryani", sortOrder: 1 },
      variants: [],
    },
  ];
  let categoryQuery;
  let productQuery;
  prisma.category.findMany = async (args) => {
    categoryQuery = args;
    return categories;
  };
  prisma.product.findMany = async (args) => {
    productQuery = args;
    return products;
  };

  const baseUrl = await createAppServer();
  const categoriesResponse = await fetch(`${baseUrl}/api/products/categories`);
  const productsResponse = await fetch(`${baseUrl}/api/products`);

  assert.equal(categoriesResponse.status, 200);
  assert.deepEqual(await categoriesResponse.json(), categories);
  assert.deepEqual(categoryQuery, {
    include: {
      _count: { select: { products: { where: { isActive: true } } } },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  assert.equal(productsResponse.status, 200);
  assert.deepEqual(await productsResponse.json(), [
    {
      ...products[1],
      price: 150,
      isVegetarian: false,
      isSignature: false,
      variants: [
        { id: 31, name: "Half", price: 100 },
        { id: 32, name: "Full", price: 150 },
      ],
    },
    {
      ...products[2],
      price: 499,
      isVegetarian: false,
      isSignature: false,
      variants: [],
    },
    {
      ...products[0],
      price: 50,
      isVegetarian: true,
      isSignature: false,
      variants: [],
    },
  ]);
  assert.deepEqual(productQuery, {
    where: { isActive: true },
    include: {
      category: true,
      variants: { where: { isActive: true }, orderBy: { id: "asc" } },
    },
    orderBy: { name: "asc" },
  });
});
