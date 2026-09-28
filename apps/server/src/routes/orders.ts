import { Router } from "express";
import { prisma } from "../config/database.js";
import { requireRoles } from "../middleware/auth.js";

const router = Router();

const safeWaiterSelect = {
  id: true,
  name: true,
  username: true,
  role: true,
  createdAt: true,
  updatedAt: true,
};

// ============================================================
// POST /api/orders
// Always create a NEW order.
// Multiple orders are allowed for the same table.
// ============================================================

router.post("/", requireRoles("WAITER"), async (req, res) => {
  try {
    const { tableId, waiterId, items } = req.body;

    const parsedTableId = Number(tableId);
    const parsedWaiterId = Number(waiterId);

    if (
      !Number.isInteger(parsedTableId) ||
      parsedTableId <= 0 ||
      !Number.isInteger(parsedWaiterId) ||
      parsedWaiterId <= 0 ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res.status(400).json({
        message: "tableId, waiterId and items are required",
      });
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

    const waiter = await prisma.user.findUnique({
      where: {
        id: parsedWaiterId,
      },
    });

    if (!waiter || waiter.role !== "WAITER") {
      return res.status(404).json({
        message: "Waiter not found",
      });
    }

    if (req.user?.id !== parsedWaiterId) {
      return res.status(403).json({
        message: "Orders may only be created for the authenticated waiter",
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
      unitPrice: number;
      subtotal: number;
    }[] = [];

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

      const unitPrice = Number(product.price);
      const subtotal = unitPrice * quantity;

      newItems.push({
        productId,
        quantity,
        unitPrice,
        subtotal,
      });
    }

    const total = newItems.reduce(
      (sum, item) => sum + item.subtotal,
      0,
    );

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          tableId: parsedTableId,
          waiterId: parsedWaiterId,
          status: "CONFIRMED",
          total,
          items: {
            create: newItems,
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

      for (const item of newItems) {
        await tx.product.update({
          where: {
            id: item.productId,
          },
          data: {
            stock: {
              decrement: item.quantity,
            },
          },
        });
      }

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
    console.error("Create order error:", error);

    return res.status(500).json({
      message: "Failed to create order",
    });
  }
});

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
  requireRoles("WAITER"),
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
// Admin / Manager / Cashier only.
// ============================================================

router.get(
  "/",
  requireRoles("ADMIN", "MANAGER", "CASHIER"),
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
// Admin / Manager / Cashier only.
// ============================================================

router.get(
  "/:id",
  requireRoles("ADMIN", "MANAGER", "CASHIER"),
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
