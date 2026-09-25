import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database.js";
import { requireRoles } from "../middleware/auth.js";

const router = Router();
const admin = requireRoles("ADMIN", "MANAGER");
const safeUser = { id: true, name: true, username: true, role: true, createdAt: true, updatedAt: true };
const id = (value: unknown) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const text = (value: unknown) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

router.use(admin);

router.get("/dashboard", async (_req, res) => {
  const [orders, completedOrders, revenue, products, categories, totalTables, availableTables, occupiedTables] = await Promise.all([
    prisma.order.count({ where: { status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
    prisma.order.count({ where: { status: "COMPLETED" } }),
    prisma.payment.aggregate({ _sum: { amount: true }, where: { status: "PAID" } }),
    prisma.product.count({ where: { isActive: true } }),
    prisma.category.count(),
    prisma.restaurantTable.count(),
    prisma.restaurantTable.count({ where: { status: "AVAILABLE" } }),
    prisma.restaurantTable.count({ where: { status: "OCCUPIED" } }),
  ]);
  res.json({
    openOrders: orders,
    pendingOrders: orders,
    completedOrders,
    totalOrders: orders + completedOrders,
    revenue: revenue._sum.amount ?? 0,
    activeProducts: products,
    totalCategories: categories,
    totalTables,
    availableTables,
    occupiedTables,
  });
});

router.get("/users", async (_req, res) => res.json(await prisma.user.findMany({ select: safeUser, orderBy: { name: "asc" } })));
router.post("/users", async (req, res) => {
  const name = text(req.body.name), username = text(req.body.username), password = text(req.body.password), role = req.body.role;
  if (!name || !username || !password || !["ADMIN", "MANAGER", "CASHIER", "WAITER"].includes(role)) return res.status(400).json({ message: "Valid name, username, password and role are required" });
  try { res.status(201).json(await prisma.user.create({ data: { name, username, password, role }, select: safeUser })); } catch { res.status(409).json({ message: "Username already exists" }); }
});
router.patch("/users/:id", async (req, res) => {
  const userId = id(req.params.id); if (!userId) return res.status(400).json({ message: "Invalid user ID" });
  const data: Record<string, unknown> = {};
  if (text(req.body.name)) data.name = text(req.body.name);
  if (req.body.username !== undefined) {
    const username = text(req.body.username);
    if (!username) return res.status(400).json({ message: "A valid username is required" });
    data.username = username;
  }
  if (text(req.body.password)) data.password = text(req.body.password);
  if (["ADMIN", "MANAGER", "CASHIER", "WAITER"].includes(req.body.role)) data.role = req.body.role;
  if (!Object.keys(data).length) return res.status(400).json({ message: "No valid changes" });
  try {
    res.json(await prisma.user.update({ where: { id: userId }, data, select: safeUser }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ message: "Username already exists" });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return res.status(404).json({ message: "User not found" });
    }
    throw error;
  }
});

router.get("/categories", async (_req, res) => res.json(await prisma.category.findMany({ include: { _count: { select: { products: true } } }, orderBy: { name: "asc" } })));
router.post("/categories", async (req, res) => { const name = text(req.body.name); if (!name) return res.status(400).json({ message: "Category name is required" }); try { res.status(201).json(await prisma.category.create({ data: { name } })); } catch { res.status(409).json({ message: "Category already exists" }); } });
router.patch("/categories/:id", async (req, res) => { const categoryId = id(req.params.id), name = text(req.body.name); if (!categoryId || !name) return res.status(400).json({ message: "Valid category ID and name are required" }); try { res.json(await prisma.category.update({ where: { id: categoryId }, data: { name } })); } catch { res.status(404).json({ message: "Category not found" }); } });

router.get("/products", async (_req, res) => res.json(await prisma.product.findMany({ include: { category: true }, orderBy: { name: "asc" } })));
router.post("/products", async (req, res) => { const name = text(req.body.name), categoryId = id(req.body.categoryId), price = Number(req.body.price), stock = Number(req.body.stock ?? 0); if (!name || !categoryId || !Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0) return res.status(400).json({ message: "Valid name, categoryId, price and stock are required" }); try { res.status(201).json(await prisma.product.create({ data: { name, categoryId, price, stock }, include: { category: true } })); } catch { res.status(400).json({ message: "Category not found" }); } });
router.patch("/products/:id", async (req, res) => { const productId = id(req.params.id); if (!productId) return res.status(400).json({ message: "Invalid product ID" }); const data: Record<string, unknown> = {}; if (text(req.body.name)) data.name = text(req.body.name); if (req.body.categoryId !== undefined && id(req.body.categoryId)) data.categoryId = id(req.body.categoryId); if (req.body.price !== undefined && Number.isFinite(Number(req.body.price)) && Number(req.body.price) >= 0) data.price = Number(req.body.price); if (req.body.stock !== undefined && Number.isInteger(Number(req.body.stock)) && Number(req.body.stock) >= 0) data.stock = Number(req.body.stock); if (typeof req.body.isActive === "boolean") data.isActive = req.body.isActive; if (!Object.keys(data).length) return res.status(400).json({ message: "No valid changes" }); try { res.json(await prisma.product.update({ where: { id: productId }, data, include: { category: true } })); } catch { res.status(404).json({ message: "Product not found" }); } });
router.delete("/products/:id", async (req, res) => {
  const productId = id(req.params.id);
  if (!productId) return res.status(400).json({ message: "Invalid product ID" });

  try {
    await prisma.product.delete({ where: { id: productId } });
    res.status(204).send();
  } catch (error) {
    const message = error instanceof Error && /foreign key|constraint|P2025/i.test(error.message)
      ? "This product is still in use and cannot be deleted."
      : "Product not found";
    res.status(400).json({ message });
  }
});

router.get("/tables", async (_req, res) => res.json(await prisma.restaurantTable.findMany({ orderBy: { number: "asc" } })));
router.post("/tables", async (req, res) => { const number = Number(req.body.number); if (!Number.isInteger(number) || number <= 0) return res.status(400).json({ message: "Valid table number is required" }); try { res.status(201).json(await prisma.restaurantTable.create({ data: { number } })); } catch { res.status(409).json({ message: "Table number already exists" }); } });
router.patch("/tables/:id", async (req, res) => { const tableId = id(req.params.id), status = req.body.status; if (!tableId || !["AVAILABLE", "OCCUPIED", "RESERVED"].includes(status)) return res.status(400).json({ message: "Valid table ID and status are required" }); try { res.json(await prisma.restaurantTable.update({ where: { id: tableId }, data: { status } })); } catch { res.status(404).json({ message: "Table not found" }); } });

router.get("/orders", async (_req, res) => res.json(await prisma.order.findMany({ include: { items: { include: { product: true } }, table: true, waiter: { select: safeUser }, payment: true }, orderBy: { createdAt: "desc" } })));
router.get("/payments", async (_req, res) => res.json(await prisma.payment.findMany({ include: { order: true }, orderBy: { createdAt: "desc" } })));

export default router;
