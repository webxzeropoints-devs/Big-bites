import { Router } from "express";
import { prisma } from "../config/database.js";
import { requireRoles } from "../middleware/auth.js";
import { calculateGstAmounts } from "../utils/gst.js";
import {
  toDecimalString,
  multiplyMinorUnits,
  toMinorUnits,
} from "../utils/currency.js";
import {
  lockOrderSequence,
  resetOrderSequenceIfEmpty,
} from "../utils/orderSequence.js";

const router = Router();

const safeWaiterSelect = {
  id: true,
  name: true,
  username: true,
  role: true,
  createdAt: true,
  updatedAt: true,
};

class OrderRequestError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

// ============================================================
// POST /api/orders
// Create a NEW order only when the table has no active order.
// ============================================================

router.post("/", requireRoles("WAITER", "ADMIN"), async (req, res) => {
  try {
    const { tableId, items } = req.body;

    const parsedTableId = Number(tableId);
    const authenticatedUser = req.user;

    if (
      !Number.isInteger(parsedTableId) ||
      parsedTableId <= 0 ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res.status(400).json({
        message: "tableId and items are required",
      });
    }

    if (!authenticatedUser) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const table = await prisma.restaurantTable.findUnique({
      where: {
        id: parsedTableId,
      },
    });

    if (!table) {
      return res.status(404).json({
        message: "Table not found",
      });
    }

    const orderOwner = await prisma.user.findUnique({
      where: {
        id: authenticatedUser.id,
      },
      select: { id: true, role: true },
    });

    if (!orderOwner || orderOwner.role !== authenticatedUser.role) {
      return res.status(401).json({
        message: "Authenticated user is no longer valid",
      });
    }

    const productQuantities = new Map<number, number>();

    for (const item of items) {
      if (!item || typeof item !== "object") {
        return res.status(400).json({
          message: "Each item must be an object",
        });
      }

      const productId = Number(item.productId);
      const quantity = Number(item.quantity);

      if (
        !Number.isInteger(productId) ||
        productId <= 0 ||
        !Number.isInteger(quantity) ||
        quantity <= 0
      ) {
        return res.status(400).json({
          message: "Invalid productId or quantity",
        });
      }

      productQuantities.set(
        productId,
        (productQuantities.get(productId) ?? 0) + quantity,
      );
    }

    const newItems: {
      productId: number;
      quantity: number;
      unitPrice: string;
      subtotal: string;
    }[] = [];
    let totalMinor = 0n;

    for (const [productId, quantity] of productQuantities.entries()) {
      const product = await prisma.product.findUnique({
        where: {
          id: productId,
        },
      });

      if (!product || !product.isActive) {
        return res.status(404).json({
          message: `Product ${productId} not found`,
        });
      }

      if (product.stock < quantity) {
        return res.status(400).json({
          message: `Insufficient stock for ${product.name}`,
        });
      }

      const unitPriceMinor = toMinorUnits(
        String(product.price),
        `Price for ${product.name}`,
      );
      const subtotalMinor = multiplyMinorUnits(unitPriceMinor, quantity);
      totalMinor += subtotalMinor;

      newItems.push({
        productId,
        quantity,
        unitPrice: toDecimalString(unitPriceMinor),
        subtotal: toDecimalString(subtotalMinor),
      });
    }

    let total: string;
    try {
      total = toDecimalString(totalMinor);
    } catch (error) {
      throw new OrderRequestError(
        400,
        error instanceof Error
          ? error.message
          : "Order total exceeds the supported amount",
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      await lockOrderSequence(tx);
      await resetOrderSequenceIfEmpty(tx);

      await tx.$queryRaw`
        SELECT "id"
        FROM "RestaurantTable"
        WHERE "id" = ${parsedTableId}
        FOR UPDATE
      `;

      const activeOrder = await tx.order.findFirst({
        where: {
          tableId: parsedTableId,
          status: {
            notIn: ["COMPLETED", "CANCELLED"],
          },
        },
        select: {
          id: true,
        },
      });

      if (activeOrder) {
        throw new OrderRequestError(
          409,
          "An active order already exists for this table",
        );
      }

      for (const item of newItems) {
        const stockUpdate = await tx.product.updateMany({
          where: {
            id: item.productId,
            isActive: true,
            stock: {
              gte: item.quantity,
            },
          },
          data: {
            stock: {
              decrement: item.quantity,
            },
          },
        });

        if (stockUpdate.count === 0) {
          const product = await tx.product.findUnique({
            where: {
              id: item.productId,
            },
            select: {
              name: true,
            },
          });

          if (!product) {
            throw new OrderRequestError(
              404,
              `Product ${item.productId} not found`,
            );
          }

          throw new OrderRequestError(
            400,
            `Insufficient stock for ${product.name}`,
          );
        }
      }

      const order = await tx.order.create({
        data: {
          tableId: parsedTableId,
          waiterId: authenticatedUser.id,
          status: "CONFIRMED",
          total,
          items: {
            create: newItems,
          },
          payment: {
            create: {
              amount: total,
              status: "PENDING",
            },
          },
        },
        include: {
          items: {
            include: {
              product: true,
            },
          },
          table: true,
          waiter: {
            select: safeWaiterSelect,
          },
          payment: true,
        },
      });

      await tx.restaurantTable.update({
        where: {
          id: parsedTableId,
        },
        data: {
          status: "OCCUPIED",
        },
      });

      return order;
    });

    return res.status(201).json({
      message: "Order created successfully",
      order: result,
    });
  } catch (error) {
    if (error instanceof OrderRequestError) {
      return res.status(error.statusCode).json({
        message: error.message,
      });
    }

    console.error("Create order error:", error);

    return res.status(500).json({
      message: "Failed to create order",
    });
  }
});

// ============================================================
// GET /api/orders/table/:tableId/active
// Return the latest order that has not been completed or cancelled.
// ============================================================

router.get(
  "/table/:tableId/active",
  requireRoles("WAITER", "ADMIN"),
  async (req, res) => {
    try {
      const tableId = Number(req.params.tableId);

      console.log("GET ACTIVE ORDER", tableId);

      if (!Number.isInteger(tableId) || tableId <= 0) {
        return res.status(400).json({
          message: "Invalid table ID",
        });
      }

      const table = await prisma.restaurantTable.findUnique({
        where: {
          id: tableId,
        },
      });

      if (!table) {
        return res.status(404).json({
          message: "Table not found",
        });
      }

      const order = await prisma.order.findFirst({
        where: {
          tableId,
          status: {
            notIn: ["COMPLETED", "CANCELLED"],
          },
        },
        include: {
          items: {
            include: {
              product: true,
            },
          },
          table: true,
          waiter: {
            select: safeWaiterSelect,
          },
          payment: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      console.log(order);
      return res.json(order);
    } catch (error) {
      console.error("Fetch active table order error:", error);

      return res.status(500).json({
        message: "Failed to fetch active table order",
      });
    }
  },
);

// ============================================================
// PATCH /api/orders/:id/add-items
// Append items to an existing active order.
// ============================================================

router.patch(
  "/:id/add-items",
  requireRoles("WAITER", "ADMIN"),
  async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      const { items } = req.body;

      if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).json({
          message: "Invalid order ID",
        });
      }

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          message: "At least one item is required",
        });
      }

      const order = await prisma.order.findUnique({
        where: {
          id: orderId,
        },
      });

      if (!order) {
        return res.status(404).json({
          message: "Order not found",
        });
      }

      const canManageOrder =
        req.user?.role === "ADMIN" || req.user?.id === order.waiterId;

      if (!canManageOrder) {
        return res.status(403).json({
          message: "Orders may only be updated by the authenticated waiter",
        });
      }

      if (order.status !== "CONFIRMED") {
        return res.status(400).json({
          message: "Items can only be added before the order is sent to cashier",
        });
      }

      const productQuantities = new Map<number, number>();

      for (const item of items) {
        if (!item || typeof item !== "object") {
          return res.status(400).json({
            message: "Each item must be an object",
          });
        }

        const productId = Number(item.productId);
        const quantity = Number(item.quantity);

        if (
          !Number.isInteger(productId) ||
          productId <= 0 ||
          !Number.isInteger(quantity) ||
          quantity <= 0
        ) {
          return res.status(400).json({
            message: "Invalid productId or quantity",
          });
        }

        productQuantities.set(
          productId,
          (productQuantities.get(productId) ?? 0) + quantity,
        );
      }

      const updatedOrder = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "Order"
          WHERE "id" = ${orderId}
          FOR UPDATE
        `;

        const currentOrder = await tx.order.findUnique({
          where: {
            id: orderId,
          },
        });

        if (!currentOrder) {
          throw new OrderRequestError(404, "Order not found");
        }

        const canManageOrder =
          req.user?.role === "ADMIN" || req.user?.id === currentOrder.waiterId;

        if (!canManageOrder) {
          throw new OrderRequestError(
            403,
            "Orders may only be updated by the authenticated waiter",
          );
        }

        if (currentOrder.status !== "CONFIRMED") {
          throw new OrderRequestError(
            400,
            "Items can only be added before the order is sent to cashier",
          );
        }

        const newItems: {
          orderId: number;
          productId: number;
          quantity: number;
          unitPrice: string;
          subtotal: string;
        }[] = [];

        for (const [productId, quantity] of productQuantities.entries()) {
          const product = await tx.product.findUnique({
            where: {
              id: productId,
            },
          });

          if (!product || !product.isActive) {
            throw new OrderRequestError(
              404,
              `Product ${productId} not found`,
            );
          }

          if (product.stock < quantity) {
            throw new OrderRequestError(
              400,
              `Insufficient stock for ${product.name}`,
            );
          }

          const stockUpdate = await tx.product.updateMany({
            where: {
              id: productId,
              isActive: true,
              stock: {
                gte: quantity,
              },
            },
            data: {
              stock: {
                decrement: quantity,
              },
            },
          });

          if (stockUpdate.count === 0) {
            throw new OrderRequestError(
              400,
              `Insufficient stock for ${product.name}`,
            );
          }

          const unitPriceMinor = toMinorUnits(
            String(product.price),
            `Price for ${product.name}`,
          );
          const subtotalMinor = multiplyMinorUnits(unitPriceMinor, quantity);

          newItems.push({
            orderId,
            productId,
            quantity,
            unitPrice: toDecimalString(unitPriceMinor),
            subtotal: toDecimalString(subtotalMinor),
          });
        }

        const additionalTotalMinor = newItems.reduce(
          (sum, item) => sum + toMinorUnits(item.subtotal),
          0n,
        );
        const additionalTotal = toDecimalString(additionalTotalMinor);

        await tx.orderItem.createMany({
          data: newItems,
        });

        await tx.payment.updateMany({
          where: { orderId },
          data: {
            amount: {
              increment: additionalTotal,
            },
          },
        });

        return tx.order.update({
          where: {
            id: orderId,
          },
          data: {
            total: {
              increment: additionalTotal,
            },
          },
          include: {
            items: {
              include: {
                product: true,
              },
            },
            table: true,
            waiter: {
              select: safeWaiterSelect,
            },
            payment: true,
          },
        });
      });

      return res.json({
        message: "Items added to order successfully",
        order: updatedOrder,
      });
    } catch (error) {
      if (error instanceof OrderRequestError) {
        return res.status(error.statusCode).json({
          message: error.message,
        });
      }

      console.error("Add order items error:", error);

      return res.status(500).json({
        message: "Failed to add items to order",
      });
    }
  },
);

// ============================================================
// PATCH /api/orders/:id/send-to-cashier
// Confirm the order is complete and make it available for billing.
// ============================================================

router.patch(
  "/:id/send-to-cashier",
  requireRoles("WAITER", "ADMIN"),
  async (req, res) => {
    try {
      const orderId = Number(req.params.id);

      if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).json({ message: "Invalid order ID" });
      }

      const order = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "Order"
          WHERE "id" = ${orderId}
          FOR UPDATE
        `;

        const currentOrder = await tx.order.findUnique({
          where: { id: orderId },
          include: { payment: true },
        });

        if (!currentOrder) {
          throw new OrderRequestError(404, "Order not found");
        }

        const canManageOrder =
          req.user?.role === "ADMIN" || req.user?.id === currentOrder.waiterId;

        if (!canManageOrder) {
          throw new OrderRequestError(
            403,
            "Orders may only be sent by the authenticated waiter",
          );
        }

        if (currentOrder.status === "CANCELLED") {
          throw new OrderRequestError(400, "Cannot send a cancelled order");
        }

        if (currentOrder.status === "COMPLETED") {
          throw new OrderRequestError(400, "Order is already completed");
        }

        if (currentOrder.payment?.status === "PAID") {
          throw new OrderRequestError(
            409,
            "Order has already been paid",
          );
        }

        if (currentOrder.payment?.status === "REFUNDED") {
          throw new OrderRequestError(
            409,
            "A refunded order cannot be sent to cashier",
          );
        }

        if (currentOrder.status === "READY_FOR_BILLING") {
          return tx.order.findUniqueOrThrow({
            where: { id: orderId },
            include: {
              items: { include: { product: true } },
              table: true,
              waiter: { select: safeWaiterSelect },
              payment: true,
            },
          });
        }

        const settings = await tx.restaurantSettings.upsert({
          where: { id: 1 },
          create: { id: 1, gstRate: 5 },
          update: {},
        });
        const gstRate = String(settings.gstRate);
        const { grandTotal } = calculateGstAmounts(
          String(currentOrder.total),
          settings.gstEnabled ? gstRate : "0",
        );
        const paymentAmount = toDecimalString(
          toMinorUnits(grandTotal, "Order total"),
        );

        if (currentOrder.payment) {
          await tx.payment.update({
            where: { orderId },
            data: { amount: paymentAmount },
          });
        } else {
          await tx.payment.create({
            data: {
              orderId,
              amount: paymentAmount,
              status: "PENDING",
            },
          });
        }

        return tx.order.update({
          where: { id: orderId },
          data: {
            status: "READY_FOR_BILLING",
            gstRate,
            gstEnabled: settings.gstEnabled,
          },
          include: {
            items: { include: { product: true } },
            table: true,
            waiter: { select: safeWaiterSelect },
            payment: true,
          },
        });
      });

      return res.json({
        message: "Order sent to cashier",
        order,
      });
    } catch (error) {
      if (error instanceof OrderRequestError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      console.error("Send order to cashier error:", error);
      return res.status(500).json({
        message: "Failed to send order to cashier",
      });
    }
  },
);

// ============================================================
// GET /api/orders/table/:tableId
// Get ALL orders belonging to one table.
//
// This allows the waiter to see:
// Order #1
// Order #2
// Order #3
// etc.
//
// Orders are returned oldest first.
// ============================================================

router.get(
  "/table/:tableId",
  requireRoles("WAITER", "ADMIN"),
  async (req, res) => {
    try {
      const tableId = Number(req.params.tableId);

      if (!Number.isInteger(tableId) || tableId <= 0) {
        return res.status(400).json({
          message: "Invalid table ID",
        });
      }

      const table = await prisma.restaurantTable.findUnique({
        where: {
          id: tableId,
        },
      });

      if (!table) {
        return res.status(404).json({
          message: "Table not found",
        });
      }

      const orders = await prisma.order.findMany({
        where: {
          tableId,
          status: {
            not: "CANCELLED",
          },
        },
        include: {
          items: {
            include: {
              product: true,
            },
          },
          table: true,
          waiter: {
            select: safeWaiterSelect,
          },
          payment: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      });

      return res.json(orders);
    } catch (error) {
      console.error("Fetch table orders error:", error);

      return res.status(500).json({
        message: "Failed to fetch table orders",
      });
    }
  },
);

// ============================================================
// GET /api/orders
// Get all orders.
// Admin / Cashier only.
// ============================================================

router.get(
  "/",
  requireRoles("ADMIN", "CASHIER"),
  async (req, res) => {
    try {
      const orders = await prisma.order.findMany({
        include: {
          items: {
            include: {
              product: true,
            },
          },
          table: true,
          waiter: {
            select: safeWaiterSelect,
          },
          payment: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      return res.json(orders);
    } catch (error) {
      console.error("Fetch orders error:", error);

      return res.status(500).json({
        message: "Failed to fetch orders",
      });
    }
  },
);

// ============================================================
// GET /api/orders/:id
// Get one specific order.
// Admin / Cashier only.
// ============================================================

router.get(
  "/:id",
  requireRoles("ADMIN", "CASHIER"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
          message: "Invalid order ID",
        });
      }

      const order = await prisma.order.findUnique({
        where: {
          id,
        },
        include: {
          items: {
            include: {
              product: true,
            },
          },
          table: true,
          waiter: {
            select: safeWaiterSelect,
          },
          payment: true,
        },
      });

      if (!order) {
        return res.status(404).json({
          message: "Order not found",
        });
      }

      return res.json(order);
    } catch (error) {
      console.error("Fetch order error:", error);

      return res.status(500).json({
        message: "Failed to fetch order",
      });
    }
  },
);

export default router;
