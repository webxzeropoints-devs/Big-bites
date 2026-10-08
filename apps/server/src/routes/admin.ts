import { Router } from "express";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database.js";
import { requireRoles } from "../middleware/auth.js";
import { calculateOrderAmounts, sumOrderAmounts } from "../utils/financial.js";
import {
  toDecimalString,
  toMinorUnits,
  toRateBasisPoints,
} from "../utils/currency.js";
import { hashPassword } from "../utils/password.js";
import {
  exportAllOrderReports,
  getOrderReportSummary,
} from "../utils/orderReports.js";
import {
  lockOrderSequence,
  resetOrderSequenceIfEmpty,
} from "../utils/orderSequence.js";

const router = Router();
const admin = requireRoles("ADMIN");
const safeUser = { id: true, name: true, username: true, role: true, createdAt: true, updatedAt: true };
const id = (value: unknown) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const text = (value: unknown) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

router.use(admin);

router.get("/order-reports", async (_req, res) => {
  try {
    return res.json(await getOrderReportSummary());
  } catch (error) {
    console.error("Order report summary error:", error);
    return res.status(500).json({
      message: "Unable to load order report information",
    });
  }
});

router.post("/order-reports/export", async (_req, res) => {
  try {
    return res.json({ reports: await exportAllOrderReports() });
  } catch (error) {
    console.error("Order report export error:", error);
    return res.status(503).json({
      message:
        error instanceof Error
          ? error.message
          : "Unable to export monthly order reports",
    });
  }
});

router.get("/settings", async (_req, res) => {
  const settings = await prisma.restaurantSettings.upsert({
    where: { id: 1 },
    create: { id: 1, gstRate: 5, gstEnabled: true },
    update: {},
  });

  res.json({
    gstRate: Number(settings.gstRate),
    gstEnabled: settings.gstEnabled,
    orderReportsPath: settings.orderReportsPath,
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
    gstEnabled?: boolean;
    orderReportsPath?: string;
    restaurantAddress?: string;
    fssaiEnabled?: boolean;
    fssaiNumber?: string;
    gstinEnabled?: boolean;
    gstinNumber?: string;
  } = {};

  if (req.body?.gstRate !== undefined) {
    try {
      data.gstRate =
        Number(toRateBasisPoints(req.body.gstRate, "GST rate")) / 100;
    } catch {
      return res.status(400).json({
        message: "GST must be a number from 0 to 100 with at most 2 decimal places",
      });
    }
  }

  if (req.body?.gstEnabled !== undefined) {
    if (typeof req.body.gstEnabled !== "boolean") {
      return res.status(400).json({
        message: "gstEnabled must be a boolean",
      });
    }
    data.gstEnabled = req.body.gstEnabled;
  }

  if (req.body?.orderReportsPath !== undefined) {
    if (
      typeof req.body.orderReportsPath !== "string" ||
      req.body.orderReportsPath.trim().length > 2048
    ) {
      return res.status(400).json({
        message: "Order report folder must be text up to 2048 characters",
      });
    }
    const reportPath = req.body.orderReportsPath.trim();
    if (reportPath && !path.isAbsolute(reportPath)) {
      return res.status(400).json({
        message: "Order report folder must be an absolute path",
      });
    }
    data.orderReportsPath = reportPath;
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
      gstEnabled: data.gstEnabled ?? true,
      orderReportsPath: data.orderReportsPath ?? "",
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
    gstEnabled: settings.gstEnabled,
    orderReportsPath: settings.orderReportsPath,
    restaurantAddress: settings.restaurantAddress,
    fssaiEnabled: settings.fssaiEnabled,
    fssaiNumber: settings.fssaiNumber,
    gstinEnabled: settings.gstinEnabled,
    gstinNumber: settings.gstinNumber,
  });
});

router.get("/dashboard", async (_req, res) => {
  const [orders, completedOrders, paidPayments, products, categories, totalTables, availableTables, occupiedTables] = await Promise.all([
    prisma.order.count({ where: { status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
    prisma.order.count({ where: { status: "COMPLETED" } }),
    prisma.payment.findMany({
      where: { status: "PAID" },
      select: {
        order: {
          select: {
            total: true,
            gstRate: true,
            discountType: true,
            discountValue: true,
          },
        },
      },
    }),
    prisma.product.count({ where: { isActive: true } }),
    prisma.category.count(),
    prisma.restaurantTable.count(),
    prisma.restaurantTable.count({ where: { status: "AVAILABLE" } }),
    prisma.restaurantTable.count({ where: { status: "OCCUPIED" } }),
  ]);
  const revenue = sumOrderAmounts(paidPayments.map(({ order }) => order));
  res.json({
    openOrders: orders,
    pendingOrders: orders,
    completedOrders,
    totalOrders: orders + completedOrders,
    revenue: revenue.grandTotal,
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
  if (!name || !username || !password || !["ADMIN", "CASHIER", "WAITER"].includes(role)) return res.status(400).json({ message: "Valid name, username, password and role are required" });
  const passwordHash = await hashPassword(password);
  try { res.status(201).json(await prisma.user.create({ data: { name, username, password: passwordHash, role }, select: safeUser })); } catch { res.status(409).json({ message: "Username already exists" }); }
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
  const password = text(req.body.password);
  if (password) data.password = await hashPassword(password);
  if (req.body.role !== undefined) {
    if (!["ADMIN", "CASHIER", "WAITER"].includes(req.body.role)) {
      return res.status(400).json({ message: "Valid role is required" });
    }
    data.role = req.body.role;
  }
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
router.delete("/users/:id", async (req, res) => {
  const userId = id(req.params.id);
  if (!userId) return res.status(400).json({ message: "Invalid user ID" });
  if (req.user?.id === userId) {
    return res.status(409).json({ message: "You cannot delete your own account" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) return res.status(404).json({ message: "User not found" });

    if (
      user.role === "ADMIN" &&
      (await prisma.user.count({ where: { role: "ADMIN" } })) <= 1
    ) {
      return res.status(409).json({ message: "The last admin account cannot be deleted" });
    }

    if ((await prisma.order.count({ where: { waiterId: userId } })) > 0) {
      return res.status(409).json({
        message: "This user has order history and cannot be deleted",
      });
    }

    await prisma.user.delete({ where: { id: userId } });
    return res.status(204).end();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return res.status(409).json({
        message: "This user is linked to existing records and cannot be deleted",
      });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return res.status(404).json({ message: "User not found" });
    }
    console.error("Delete user error:", error);
    return res.status(500).json({ message: "Failed to delete user" });
  }
});

router.get("/categories", async (_req, res) => res.json(await prisma.category.findMany({ include: { _count: { select: { products: true } } }, orderBy: { name: "asc" } })));
router.post("/categories", async (req, res) => { const name = text(req.body.name); if (!name) return res.status(400).json({ message: "Category name is required" }); try { res.status(201).json(await prisma.category.create({ data: { name } })); } catch { res.status(409).json({ message: "Category already exists" }); } });
router.patch("/categories/:id", async (req, res) => { const categoryId = id(req.params.id), name = text(req.body.name); if (!categoryId || !name) return res.status(400).json({ message: "Valid category ID and name are required" }); try { res.json(await prisma.category.update({ where: { id: categoryId }, data: { name } })); } catch { res.status(404).json({ message: "Category not found" }); } });

router.get("/products", async (_req, res) => res.json(await prisma.product.findMany({ include: { category: true }, orderBy: { name: "asc" } })));
router.post("/products", async (req, res) => {
  const name = text(req.body.name);
  const categoryId = id(req.body.categoryId);
  const stock = Number(req.body.stock ?? 0);
  let price: string;
  try {
    price = toDecimalString(toMinorUnits(req.body.price, "Price"));
  } catch {
    return res.status(400).json({
      message: "Price must be a non-negative amount with at most 2 decimal places",
    });
  }
  if (!name || !categoryId || !Number.isInteger(stock) || stock < 0) {
    return res.status(400).json({
      message: "Valid name, categoryId, price and stock are required",
    });
  }
  try {
    return res.status(201).json(
      await prisma.product.create({
        data: { name, categoryId, price, stock },
        include: { category: true },
      }),
    );
  } catch (error) {
    console.error("Create product error:", error);
    return res.status(400).json({ message: "Unable to create product" });
  }
});
router.patch("/products/:id", async (req, res) => {
  const productId = id(req.params.id);
  if (!productId) return res.status(400).json({ message: "Invalid product ID" });
  const data: {
    name?: string;
    categoryId?: number;
    price?: string;
    stock?: number;
    isActive?: boolean;
  } = {};
  if (req.body.name !== undefined) {
    const name = text(req.body.name);
    if (!name) return res.status(400).json({ message: "A valid product name is required" });
    data.name = name;
  }
  if (req.body.categoryId !== undefined) {
    const categoryId = id(req.body.categoryId);
    if (!categoryId) return res.status(400).json({ message: "A valid category is required" });
    data.categoryId = categoryId;
  }
  if (req.body.price !== undefined) {
    try {
      data.price = toDecimalString(toMinorUnits(req.body.price, "Price"));
    } catch {
      return res.status(400).json({
        message: "Price must be a non-negative amount with at most 2 decimal places",
      });
    }
  }
  if (req.body.stock !== undefined) {
    const stock = Number(req.body.stock);
    if (!Number.isInteger(stock) || stock < 0) {
      return res.status(400).json({ message: "Stock must be a non-negative integer" });
    }
    data.stock = stock;
  }
  if (typeof req.body.isActive === "boolean") data.isActive = req.body.isActive;
  if (!Object.keys(data).length) {
    return res.status(400).json({ message: "No valid changes" });
  }
  try {
    return res.json(
      await prisma.product.update({
        where: { id: productId },
        data,
        include: { category: true },
      }),
    );
  } catch (error) {
    console.error("Update product error:", error);
    return res.status(404).json({ message: "Product or category not found" });
  }
});
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
      ...calculateOrderAmounts(order),
    })),
  );
});
router.delete("/orders/:id", requireRoles("ADMIN"), async (req, res) => {
  const orderId = id(req.params.id);
  if (!orderId) return res.status(400).json({ message: "Invalid order ID" });

  try {
    await prisma.$transaction(async (tx) => {
      await lockOrderSequence(tx);

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
        include: {
          items: { select: { productId: true, quantity: true } },
          payment: true,
        },
      });
      if (!currentOrder) {
        throw new Error("ORDER_NOT_FOUND");
      }

      const orderWasPaidOrCompleted =
        currentOrder.status === "COMPLETED" ||
        currentOrder.payment?.status === "PAID" ||
        currentOrder.payment?.status === "REFUNDED";

      if (!orderWasPaidOrCompleted) {
        for (const item of currentOrder.items) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
        }
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

      await resetOrderSequenceIfEmpty(tx);
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
