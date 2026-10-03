import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database.js";
import { requireRoles } from "../middleware/auth.js";
import { calculateGstAmounts } from "../utils/gst.js";

const router = Router();
const admin = requireRoles("ADMIN", "MANAGER");
const safeUser = { id: true, name: true, username: true, role: true, createdAt: true, updatedAt: true };
const id = (value: unknown) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const text = (value: unknown) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

router.use(admin);

router.get("/settings", async (_req, res) => {
  const settings = await prisma.restaurantSettings.upsert({
    where: { id: 1 },
    create: { id: 1, gstRate: 5 },
    update: {},
  });

  res.json({
    gstRate: Number(settings.gstRate),
    restaurantAddress: settings.restaurantAddress,
    fssaiEnabled: settings.fssaiEnabled,
    fssaiNumber: settings.fssaiNumber,
    gstinEnabled: settings.gstinEnabled,
    gstinNumber: settings.gstinNumber,
  });
});

router.patch("/settings", async (req, res) => {
  const data: {
    gstRate?: number;
    restaurantAddress?: string;
    fssaiEnabled?: boolean;
    fssaiNumber?: string;
    gstinEnabled?: boolean;
    gstinNumber?: string;
  } = {};

  if (req.body?.gstRate !== undefined) {
    const rawGstRate = req.body.gstRate;
    const gstRate = Number(rawGstRate);

    if (
      (typeof rawGstRate !== "number" && typeof rawGstRate !== "string") ||
      (typeof rawGstRate === "string" && rawGstRate.trim() === "") ||
      !Number.isFinite(gstRate) ||
      gstRate < 0 ||
      gstRate > 100 ||
      Math.abs(gstRate * 100 - Math.round(gstRate * 100)) > 1e-8
    ) {
      return res.status(400).json({
        message: "GST must be a number from 0 to 100 with at most 2 decimal places",
      });
    }
    data.gstRate = gstRate;
  }

  if (req.body?.restaurantAddress !== undefined) {
    if (
      typeof req.body.restaurantAddress !== "string" ||
      req.body.restaurantAddress.length > 1000
    ) {
      return res.status(400).json({
        message: "Restaurant address must be text up to 1000 characters",
      });
    }
    data.restaurantAddress = req.body.restaurantAddress.trim();
  }

  for (const field of ["fssaiEnabled", "gstinEnabled"] as const) {
    if (req.body?.[field] !== undefined) {
      if (typeof req.body[field] !== "boolean") {
        return res.status(400).json({
          message: `${field} must be a boolean`,
        });
      }
      data[field] = req.body[field];
    }
  }

  for (const field of ["fssaiNumber", "gstinNumber"] as const) {
    if (req.body?.[field] !== undefined) {
      const value = req.body[field];
      if (typeof value !== "string" || value.trim().length > 100) {
        return res.status(400).json({
          message: `${field} must be text up to 100 characters`,
        });
      }
      data[field] = value.trim();
    }
  }

  const currentSettings = await prisma.restaurantSettings.findUnique({
    where: { id: 1 },
    select: {
      fssaiEnabled: true,
      fssaiNumber: true,
      gstinEnabled: true,
      gstinNumber: true,
    },
  });
  const nextFssaiEnabled =
    data.fssaiEnabled ?? currentSettings?.fssaiEnabled ?? false;
  const nextFssaiNumber =
    data.fssaiNumber ?? currentSettings?.fssaiNumber ?? "";
  if (nextFssaiEnabled && !nextFssaiNumber.trim()) {
    return res.status(400).json({
      message: "Enter the FSSAI number before enabling FSSAI",
    });
  }

  const nextGstinEnabled =
    data.gstinEnabled ?? currentSettings?.gstinEnabled ?? false;
  const nextGstinNumber =
    data.gstinNumber ?? currentSettings?.gstinNumber ?? "";
  if (nextGstinEnabled && !nextGstinNumber.trim()) {
    return res.status(400).json({
      message: "Enter the GSTIN number before enabling GSTIN",
    });
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({
      message: "Provide at least one valid restaurant setting",
    });
  }

  const settings = await prisma.restaurantSettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      gstRate: data.gstRate ?? 5,
      restaurantAddress: data.restaurantAddress ?? "",
      fssaiEnabled: data.fssaiEnabled ?? false,
      fssaiNumber: data.fssaiNumber ?? "",
      gstinEnabled: data.gstinEnabled ?? false,
      gstinNumber: data.gstinNumber ?? "",
    },
    update: data,
  });

  return res.json({
    gstRate: Number(settings.gstRate),
    restaurantAddress: settings.restaurantAddress,
    fssaiEnabled: settings.fssaiEnabled,
    fssaiNumber: settings.fssaiNumber,
    gstinEnabled: settings.gstinEnabled,
    gstinNumber: settings.gstinNumber,
  });
});

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

router.get("/orders", async (_req, res) => {
  const orders = await prisma.order.findMany({
    include: {
      items: { include: { product: true } },
      table: true,
      waiter: { select: safeUser },
      payment: true,
    },
    orderBy: { createdAt: "desc" },
  });

  res.json(
    orders.map((order) => ({
      ...order,
      ...calculateGstAmounts(Number(order.total), Number(order.gstRate)),
    })),
  );
});
router.delete("/orders/:id", requireRoles("ADMIN"), async (req, res) => {
  const orderId = id(req.params.id);
  if (!orderId) return res.status(400).json({ message: "Invalid order ID" });

  try {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { tableId: true },
      });
      if (!order) {
        throw new Error("ORDER_NOT_FOUND");
      }

      await tx.$queryRaw`
        SELECT "id"
        FROM "RestaurantTable"
        WHERE "id" = ${order.tableId}
        FOR UPDATE
      `;

      await tx.$queryRaw`
        SELECT "id"
        FROM "Order"
        WHERE "id" = ${orderId}
        FOR UPDATE
      `;

      const currentOrder = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, tableId: true },
      });
      if (!currentOrder) {
        throw new Error("ORDER_NOT_FOUND");
      }

      await tx.payment.deleteMany({ where: { orderId } });
      await tx.order.delete({ where: { id: orderId } });

      const otherActiveOrder = await tx.order.findFirst({
        where: {
          tableId: currentOrder.tableId,
          status: { notIn: ["COMPLETED", "CANCELLED"] },
        },
        select: { id: true },
      });
      const table = await tx.restaurantTable.findUnique({
        where: { id: currentOrder.tableId },
        select: { status: true },
      });

      if (!otherActiveOrder && table?.status === "OCCUPIED") {
        await tx.restaurantTable.update({
          where: { id: currentOrder.tableId },
          data: { status: "AVAILABLE" },
        });
      }
    });

    return res.status(204).send();
  } catch (error) {
    if (error instanceof Error && error.message === "ORDER_NOT_FOUND") {
      return res.status(404).json({ message: "Order not found" });
    }
    console.error("Delete order error:", error);
    return res.status(500).json({ message: "Failed to delete order" });
  }
});
router.get("/payments", async (_req, res) => res.json(await prisma.payment.findMany({ include: { order: true }, orderBy: { createdAt: "desc" } })));

export default router;
