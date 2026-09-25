import { Router } from "express";
import { prisma } from "../config/database.js";
import { requireRoles } from "../middleware/auth.js";

const router = Router();
router.use(requireRoles("ADMIN", "MANAGER", "CASHIER"));

// GET /api/billing/orders
// Get orders ready for billing
router.get("/orders", async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
      include: {
        items: {
          include: {
            product: true,
          },
        },
        table: true,
        waiter: { select: { id: true, name: true, username: true, role: true } },
        payment: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    // GET /api/billing/completed
    // Get recently completed orders for receipt/history display
    router.get("/completed", async (req, res) => {
      try {
        const orders = await prisma.order.findMany({
          where: { status: "COMPLETED", payment: { status: "PAID" } },
          include: {
            items: { include: { product: true } },
            table: true,
            payment: true,
          },
          orderBy: { updatedAt: "desc" },
          take: 50,
        });

        res.json(orders);
      } catch (error) {
        console.error("Completed billing orders error:", error);
        res.status(500).json({ message: "Failed to fetch completed orders" });
      }
    });

    res.json(orders);
  } catch (error) {
    console.error("Billing orders error:", error);

    res.status(500).json({
      message: "Failed to fetch billing orders",
    });
  }
});

// GET /api/billing/orders/:id
// Get one bill
router.get("/orders/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({
        message: "Invalid order ID",
      });
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: true,
          },
        },
        table: true,
        waiter: { select: { id: true, name: true, username: true, role: true } },
        payment: true,
      },
    });

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
      });
    }

    res.json({
      orderId: order.id,
      tableNumber: order.table.number,
      tableLabel: order.table.isParcel ? "Parcel" : `Table ${order.table.number}`,
      waiterName: order.waiter.name,
      status: order.status,
      items: order.items,
      total: order.total,
      payment: order.payment,
      createdAt: order.createdAt,
    });
  } catch (error) {
    console.error("Billing order error:", error);

    res.status(500).json({
      message: "Failed to fetch bill",
    });
  }
});

// POST /api/billing/orders/:id/pay
// Complete payment
router.post("/orders/:id/pay", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { method, amountReceived } = req.body;

    if (isNaN(id)) {
      return res.status(400).json({
        message: "Invalid order ID",
      });
    }

    const allowedMethods = ["CASH", "UPI", "CARD"];

    if (!allowedMethods.includes(method)) {
      return res.status(400).json({
        message: "Payment method must be CASH, UPI or CARD",
      });
    }

    const parsedAmountReceived =
      amountReceived === undefined ? undefined : Number(amountReceived);
    if (
      method === "CASH" &&
      parsedAmountReceived !== undefined &&
      (!Number.isFinite(parsedAmountReceived) || parsedAmountReceived < 0)
    ) {
      return res.status(400).json({
        message: "Amount received must be a valid non-negative number",
      });
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        payment: true,
        table: true,
      },
    });

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
      });
    }

    if (["COMPLETED", "CANCELLED"].includes(order.status)) {
      return res.status(400).json({
        message: "Order is not ready for payment",
      });
    }

    if (order.payment?.status === "PAID") {
      return res.status(400).json({
        message: "Order is already paid",
      });
    }

    if (
      method === "CASH" &&
      parsedAmountReceived !== undefined &&
      parsedAmountReceived < Number(order.total)
    ) {
      return res.status(400).json({
        message: "Amount received cannot be less than the amount due",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          amount: order.total,
          method,
          status: "PAID",
          paidAt: new Date(),
        },
      });

      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          status: "COMPLETED",
        },
      });

      await tx.restaurantTable.update({
        where: { id: order.tableId },
        data: {
          status: "AVAILABLE",
        },
      });

      return {
        payment,
        updatedOrder,
      };
    });

    res.json({
      message: "Payment successful",
      payment: result.payment,
      order: result.updatedOrder,
      table: {
        number: order.table.number,
        status: "AVAILABLE",
      },
      amountReceived: parsedAmountReceived ?? Number(order.total),
      change:
        method === "CASH"
          ? (parsedAmountReceived ?? Number(order.total)) - Number(order.total)
          : 0,
    });
  } catch (error) {
    console.error("Payment error:", error);

    res.status(500).json({
      message: "Payment failed",
    });
  }
});

export default router;