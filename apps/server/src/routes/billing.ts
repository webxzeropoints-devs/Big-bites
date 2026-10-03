import { Router } from "express";
import { prisma } from "../config/database.js";
import { requireRoles } from "../middleware/auth.js";
import type { DiscountType } from "@prisma/client";
import { calculateGstAmounts } from "../utils/gst.js";
import { calculateDiscount, type DiscountKind } from "../utils/discount.js";

const router = Router();

type TaxableOrder = {
  total: unknown;
  gstRate: unknown;
  discountType?: DiscountType | null;
  discountValue?: unknown;
  discountAmount?: unknown;
};

const orderGstAmounts = (order: TaxableOrder) =>
  calculateGstAmounts(Number(order.total), Number(order.gstRate));

const orderDiscountAmounts = (order: TaxableOrder) => {
  const amounts = orderGstAmounts(order);
  return calculateDiscount(
    amounts.grandTotal,
    order.discountType ?? null,
    order.discountValue == null ? null : Number(order.discountValue),
  );
};

const withGstAmounts = <T extends TaxableOrder>(order: T) => {
  const amounts = orderGstAmounts(order);
  const discount = orderDiscountAmounts(order);
  const discountAmount = Number(order.discountAmount ?? discount.discountAmount);
  return {
    ...order,
    ...amounts,
    discountAmount,
    finalTotal: Math.round((amounts.grandTotal - discountAmount + Number.EPSILON) * 100) / 100,
  };
};

function sumGstAmounts(orders: TaxableOrder[]) {
  const amounts = orders.map(orderGstAmounts);
  const sumCurrency = (
    select: (amount: (typeof amounts)[number], index: number) => number,
  ) =>
    amounts.reduce(
      (sum, amount, index) => sum + Math.round(select(amount, index) * 100),
      0,
    ) / 100;
  const subtotal = sumCurrency((amount) => amount.subtotal);
  const cgstAmount = sumCurrency((amount) => amount.cgstAmount);
  const sgstAmount = sumCurrency((amount) => amount.sgstAmount);
  const gstAmount = sumCurrency((amount) => amount.gstAmount);
  const discountAmount = sumCurrency((_, index) =>
    Number(orders[index].discountAmount ?? 0),
  );
  const grandTotal = sumCurrency((amount, index) =>
    amount.grandTotal - Number(orders[index].discountAmount ?? 0),
  );

  return { subtotal, cgstAmount, sgstAmount, gstAmount, discountAmount, grandTotal };
}

class BillingRequestError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/*
|--------------------------------------------------------------------------
| GET /api/billing/orders
|--------------------------------------------------------------------------
| Get all orders that have been sent to billing.
|
| Only orders explicitly sent by a waiter are included.
|--------------------------------------------------------------------------
*/
router.get(
  "/orders",
  requireRoles("ADMIN", "MANAGER", "CASHIER"),
  async (req, res) => {
    try {
      const orders = await prisma.order.findMany({
        where: {
          status: "READY_FOR_BILLING",
        },
        include: {
          items: {
            include: {
              product: true,
            },
          },
          table: true,
          waiter: {
            select: {
              id: true,
              name: true,
              username: true,
              role: true,
            },
          },
          payment: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      });

      const settings = await prisma.restaurantSettings.findUnique({
        where: { id: 1 },
        select: {
          restaurantAddress: true,
          fssaiEnabled: true,
          fssaiNumber: true,
          gstinEnabled: true,
          gstinNumber: true,
        },
      });

      return res.json(
        orders.map((order) => ({
          ...withGstAmounts(order),
          restaurantAddress: settings?.restaurantAddress ?? "",
          fssaiEnabled: settings?.fssaiEnabled ?? false,
          fssaiNumber: settings?.fssaiNumber ?? "",
          gstinEnabled: settings?.gstinEnabled ?? false,
          gstinNumber: settings?.gstinNumber ?? "",
        })),
      );
    } catch (error) {
      console.error("Billing orders error:", error);

      return res.status(500).json({
        message: "Failed to fetch billing orders",
      });
    }
  },
);

/*
|--------------------------------------------------------------------------
| GET /api/billing/completed
|--------------------------------------------------------------------------
| Recently completed orders.
|--------------------------------------------------------------------------
*/
router.get(
  "/completed",
  requireRoles("ADMIN", "MANAGER", "CASHIER"),
  async (req, res) => {
    try {
      const orders = await prisma.order.findMany({
        where: {
          status: "COMPLETED",
          payment: {
            status: "PAID",
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
            select: {
              id: true,
              name: true,
              username: true,
              role: true,
            },
          },
          payment: true,
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 50,
      });

      const settings = await prisma.restaurantSettings.findUnique({
        where: { id: 1 },
        select: {
          restaurantAddress: true,
          fssaiEnabled: true,
          fssaiNumber: true,
          gstinEnabled: true,
          gstinNumber: true,
        },
      });

      return res.json(
        orders.map((order) => ({
          ...withGstAmounts(order),
          restaurantAddress: settings?.restaurantAddress ?? "",
          fssaiEnabled: settings?.fssaiEnabled ?? false,
          fssaiNumber: settings?.fssaiNumber ?? "",
          gstinEnabled: settings?.gstinEnabled ?? false,
          gstinNumber: settings?.gstinNumber ?? "",
        })),
      );
    } catch (error) {
      console.error("Completed billing orders error:", error);

      return res.status(500).json({
        message: "Failed to fetch completed orders",
      });
    }
  },
);

/*
|--------------------------------------------------------------------------
| GET /api/billing/orders/:id
|--------------------------------------------------------------------------
| Get one individual order/bill.
|--------------------------------------------------------------------------
*/
router.get(
  "/orders/:id",
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
        where: { id },
        include: {
          items: {
            include: {
              product: true,
            },
          },
          table: true,
          waiter: {
            select: {
              id: true,
              name: true,
              username: true,
              role: true,
            },
          },
          payment: true,
        },
      });

      if (!order) {
        return res.status(404).json({
          message: "Order not found",
        });
      }

      const settings = await prisma.restaurantSettings.findUnique({
        where: { id: 1 },
        select: {
          restaurantAddress: true,
          fssaiEnabled: true,
          fssaiNumber: true,
          gstinEnabled: true,
          gstinNumber: true,
        },
      });

      return res.json({
        orderId: order.id,
        tableNumber: order.table.number,
        tableLabel: order.table.isParcel
          ? "Parcel"
          : `Table ${order.table.number}`,
        waiterName: order.waiter.name,
        status: order.status,
        items: order.items,
        total: order.total,
        ...orderGstAmounts(order),
        discountType: order.discountType,
        discountValue: order.discountValue,
        discountAmount: order.discountAmount,
        restaurantAddress: settings?.restaurantAddress ?? "",
        fssaiEnabled: settings?.fssaiEnabled ?? false,
        fssaiNumber: settings?.fssaiNumber ?? "",
        gstinEnabled: settings?.gstinEnabled ?? false,
        gstinNumber: settings?.gstinNumber ?? "",
        payment: order.payment,
        createdAt: order.createdAt,
      });
    } catch (error) {
      console.error("Billing order error:", error);

      return res.status(500).json({
        message: "Failed to fetch bill",
      });
    }
  },
);

router.patch(
  "/orders/:id/discount",
  requireRoles("ADMIN", "MANAGER", "CASHIER"),
  async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).json({ message: "Invalid order ID" });
      }

      const rawType = req.body?.discountType;
      const rawValue = req.body?.discountValue;
      if (
        rawType !== null &&
        rawType !== "AMOUNT" &&
        rawType !== "PERCENTAGE"
      ) {
        return res.status(400).json({
          message: "Discount type must be AMOUNT, PERCENTAGE, or null",
        });
      }

      let discountValue: number | null = null;
      if (rawValue !== null && rawValue !== undefined && rawValue !== "") {
        if (
          (typeof rawValue !== "number" && typeof rawValue !== "string") ||
          (typeof rawValue === "string" && rawValue.trim() === "") ||
          !Number.isFinite(Number(rawValue))
        ) {
          return res.status(400).json({
            message: "Discount must be a valid non-negative number",
          });
        }
        discountValue = Number(rawValue);
      }

      if ((rawType === null) !== (discountValue === null)) {
        return res.status(400).json({
          message: "Select a discount type and enter a discount value",
        });
      }
      if (discountValue !== null && discountValue < 0) {
        return res.status(400).json({
          message: "Discount must be a valid non-negative number",
        });
      }
      if (
        discountValue !== null &&
        Math.abs(discountValue * 100 - Math.round(discountValue * 100)) > 1e-8
      ) {
        return res.status(400).json({
          message: "Discount can have at most 2 decimal places",
        });
      }

      const updated = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "Order"
          WHERE "id" = ${orderId}
          FOR UPDATE
        `;

        const order = await tx.order.findUnique({ where: { id: orderId } });
        if (!order) {
          throw new BillingRequestError(404, "Order not found");
        }
        if (order.status !== "READY_FOR_BILLING") {
          throw new BillingRequestError(
            409,
            "Discounts can only be changed before payment",
          );
        }

        let discount;
        try {
          discount = calculateDiscount(
            orderGstAmounts(order).grandTotal,
            rawType as DiscountKind | null,
            discountValue,
          );
        } catch (error) {
          throw new BillingRequestError(
            400,
            error instanceof Error ? error.message : "Invalid discount",
          );
        }

        const nextType = rawType as DiscountType | null;
        const saved = await tx.order.update({
          where: { id: orderId },
          data: {
            discountType: nextType,
            discountValue,
            discountAmount: discount.discountAmount,
          },
        });
        return { saved, discount };
      });

      return res.json({
        discountType: updated.saved.discountType,
        discountValue: updated.saved.discountValue,
        discountAmount: updated.saved.discountAmount,
        finalTotal: updated.discount.grandTotal,
      });
    } catch (error) {
      if (error instanceof BillingRequestError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      console.error("Order discount error:", error);
      return res.status(500).json({ message: "Failed to save bill discount" });
    }
  },
);

/*
|--------------------------------------------------------------------------
| POST /api/billing/orders/:id/pay
|--------------------------------------------------------------------------
| Record a payment and close one READY_FOR_BILLING order atomically.
|--------------------------------------------------------------------------
*/
router.post(
  "/orders/:id/pay",
  requireRoles("ADMIN", "MANAGER", "CASHIER"),
  async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      const { method, amountReceived } = req.body;

      if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).json({ message: "Invalid order ID" });
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

      const result = await prisma.$transaction(async (tx) => {
        const initialOrder = await tx.order.findUnique({
          where: { id: orderId },
          select: { tableId: true },
        });
        if (!initialOrder) {
          throw new BillingRequestError(404, "Order not found");
        }

        await tx.$queryRaw`
          SELECT "id"
          FROM "RestaurantTable"
          WHERE "id" = ${initialOrder.tableId}
          FOR UPDATE
        `;

        await tx.$queryRaw`
          SELECT "id"
          FROM "Order"
          WHERE "id" = ${orderId}
          FOR UPDATE
        `;

        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: { payment: true },
        });
        if (!order) {
          throw new BillingRequestError(404, "Order not found");
        }
        if (order.status !== "READY_FOR_BILLING") {
          throw new BillingRequestError(
            409,
            "Order is not ready for billing",
          );
        }
        if (order.payment?.status === "PAID") {
          throw new BillingRequestError(409, "Order is already paid");
        }
        if (order.payment?.status === "REFUNDED") {
          throw new BillingRequestError(
            409,
            "A refunded order cannot be paid again",
          );
        }

        const gstAmounts = orderGstAmounts(order);
        const discountAmounts = orderDiscountAmounts(order);
        const total = Math.round(
          (gstAmounts.grandTotal -
            Number(order.discountAmount ?? discountAmounts.discountAmount) +
            Number.EPSILON) *
            100,
        ) / 100;
        if (
          method === "CASH" &&
          parsedAmountReceived !== undefined &&
          parsedAmountReceived < total
        ) {
          throw new BillingRequestError(
            400,
            "Amount received cannot be less than the amount due",
          );
        }

        const paidAt = new Date();
        const payment = order.payment
          ? await tx.payment.update({
              where: { orderId },
              data: {
                amount: total,
                method,
                status: "PAID",
                paidAt,
              },
            })
          : await tx.payment.create({
              data: {
                orderId,
                amount: total,
                method,
                status: "PAID",
                paidAt,
              },
            });

        const updatedOrder = await tx.order.update({
          where: { id: orderId },
          data: { status: "COMPLETED" },
          include: {
            items: { include: { product: true } },
            table: true,
            waiter: {
              select: {
                id: true,
                name: true,
                username: true,
                role: true,
              },
            },
            payment: true,
          },
        });

        const otherActiveOrder = await tx.order.findFirst({
          where: {
            tableId: order.tableId,
            id: { not: orderId },
            status: { notIn: ["COMPLETED", "CANCELLED"] },
          },
          select: { id: true },
        });

        if (!otherActiveOrder) {
          await tx.restaurantTable.update({
            where: { id: order.tableId },
            data: { status: "AVAILABLE" },
          });
        }

        return { payment, order: updatedOrder, ...gstAmounts, discountAmounts };
      });

      const received = parsedAmountReceived ?? result.discountAmounts.grandTotal;
      return res.json({
        message: "Payment received",
        ...result,
        total: result.discountAmounts.grandTotal,
        finalTotal: result.discountAmounts.grandTotal,
        amountReceived: received,
        change: method === "CASH" ? received - result.discountAmounts.grandTotal : 0,
      });
    } catch (error) {
      if (error instanceof BillingRequestError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      console.error("Order payment error:", error);
      return res.status(500).json({ message: "Payment failed" });
    }
  },
);

/*
|--------------------------------------------------------------------------
| GET /api/billing/tables/:tableId
|--------------------------------------------------------------------------
| Get the COMPLETE bill for a table.
|
| Example:
|
| Order #1 = ₹720
| Order #2 = ₹560
| ----------------
| Table total = ₹1280
|
| Only READY_FOR_BILLING orders are included.
|--------------------------------------------------------------------------
*/
router.get(
  "/tables/:tableId",
  requireRoles("ADMIN", "MANAGER", "CASHIER"),
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
          status: "READY_FOR_BILLING",
        },
        include: {
          items: {
            include: {
              product: true,
            },
          },
          waiter: {
            select: {
              id: true,
              name: true,
              username: true,
              role: true,
            },
          },
          payment: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      });

      if (orders.length === 0) {
        return res.status(404).json({
          message: "No billable orders found for this table",
        });
      }

      const amounts = sumGstAmounts(orders);
      const settings = await prisma.restaurantSettings.findUnique({
        where: { id: 1 },
        select: {
          restaurantAddress: true,
          fssaiEnabled: true,
          fssaiNumber: true,
          gstinEnabled: true,
          gstinNumber: true,
        },
      });

      return res.json({
        tableId: table.id,
        tableNumber: table.number,
        tableLabel: table.isParcel
          ? "Parcel"
          : `Table ${table.number}`,
        orderCount: orders.length,
        orders: orders.map(withGstAmounts),
        restaurantAddress: settings?.restaurantAddress ?? "",
        fssaiEnabled: settings?.fssaiEnabled ?? false,
        fssaiNumber: settings?.fssaiNumber ?? "",
        gstinEnabled: settings?.gstinEnabled ?? false,
        gstinNumber: settings?.gstinNumber ?? "",
        ...amounts,
        total: amounts.grandTotal,
      });
    } catch (error) {
      console.error("Table billing error:", error);

      return res.status(500).json({
        message: "Failed to fetch table bill",
      });
    }
  },
);

/*
|--------------------------------------------------------------------------
| POST /api/billing/tables/:tableId/pay
|--------------------------------------------------------------------------
| Pay the COMPLETE bill for a table.
|
| Every READY_FOR_BILLING order belonging to the table is:
|
| READY_FOR_BILLING -> COMPLETED
|
| A PAID payment record is created for every order.
|
| Finally:
|
| OCCUPIED -> AVAILABLE
|--------------------------------------------------------------------------
*/
router.post(
  "/tables/:tableId/pay",
  requireRoles("ADMIN", "MANAGER", "CASHIER"),
  async (req, res) => {
    try {
      const tableId = Number(req.params.tableId);
      const { method, amountReceived } = req.body;

      if (!Number.isInteger(tableId) || tableId <= 0) {
        return res.status(400).json({
          message: "Invalid table ID",
        });
      }

      const allowedMethods = ["CASH", "UPI", "CARD"];

      if (!allowedMethods.includes(method)) {
        return res.status(400).json({
          message: "Payment method must be CASH, UPI or CARD",
        });
      }

      const parsedAmountReceived =
        amountReceived === undefined
          ? undefined
          : Number(amountReceived);

      if (
        method === "CASH" &&
        parsedAmountReceived !== undefined &&
        (!Number.isFinite(parsedAmountReceived) ||
          parsedAmountReceived < 0)
      ) {
        return res.status(400).json({
          message: "Amount received must be a valid non-negative number",
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

      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "RestaurantTable"
          WHERE "id" = ${tableId}
          FOR UPDATE
        `;

        const currentTable = await tx.restaurantTable.findUnique({
          where: { id: tableId },
        });
        if (!currentTable) {
          throw new BillingRequestError(404, "Table not found");
        }

        const orders = await tx.order.findMany({
          where: {
            tableId,
            status: "READY_FOR_BILLING",
          },
          include: {
            payment: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        });

        if (orders.length === 0) {
          throw new BillingRequestError(
            400,
            "No billable orders found for this table",
          );
        }

        const amounts = sumGstAmounts(orders);
        const total = amounts.grandTotal;

        if (
          method === "CASH" &&
          parsedAmountReceived !== undefined &&
          parsedAmountReceived < total
        ) {
          throw new BillingRequestError(
            400,
            "Amount received cannot be less than the amount due",
          );
        }

        const payments = [];

        for (const order of orders) {
          if (order.payment?.status === "PAID") {
            throw new BillingRequestError(
              409,
              `Order #${order.id} is already paid`,
            );
          }
          if (order.payment?.status === "REFUNDED") {
            throw new BillingRequestError(
              409,
              `Order #${order.id} has a refunded payment`,
            );
          }

          const paidAt = new Date();
          const orderTotal = Math.round(
            (orderGstAmounts(order).grandTotal -
              Number(order.discountAmount ?? 0) +
              Number.EPSILON) *
              100,
          ) / 100;
          const payment = order.payment
            ? await tx.payment.update({
                where: { orderId: order.id },
                data: {
                  amount: orderTotal,
                  method,
                  status: "PAID",
                  paidAt,
                },
              })
            : await tx.payment.create({
                data: {
                  orderId: order.id,
                  amount: orderTotal,
                  method,
                  status: "PAID",
                  paidAt,
                },
              });

          payments.push(payment);

          await tx.order.update({
            where: {
              id: order.id,
            },
            data: {
              status: "COMPLETED",
            },
          });
        }

        const otherActiveOrder = await tx.order.findFirst({
          where: {
            tableId,
            status: { notIn: ["COMPLETED", "CANCELLED"] },
          },
          select: { id: true },
        });
        const tableStatus = otherActiveOrder
          ? currentTable.status
          : "AVAILABLE";

        if (!otherActiveOrder) {
          await tx.restaurantTable.update({
            where: {
              id: tableId,
            },
            data: {
              status: "AVAILABLE",
            },
          });
        }

        return {
          payments,
          orders,
          amounts,
          total,
          tableStatus,
        };
      });

      const received =
        parsedAmountReceived === undefined
          ? result.total
          : parsedAmountReceived;

      const change =
        method === "CASH"
          ? received - result.total
          : 0;

      return res.json({
        message: "Table bill paid successfully",

        table: {
          id: table.id,
          number: table.number,
          status: result.tableStatus,
        },

        orderCount: result.orders.length,

        orderIds: result.orders.map((order) => order.id),

        subtotal: result.amounts.subtotal,
        cgstAmount: result.amounts.cgstAmount,
        sgstAmount: result.amounts.sgstAmount,
        gstAmount: result.amounts.gstAmount,
        grandTotal: result.amounts.grandTotal,
        total: result.total,

        amountReceived: received,

        change,

        method,

        payments: result.payments,
      });
    } catch (error) {
      if (error instanceof BillingRequestError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      console.error("Table payment error:", error);

      return res.status(500).json({
        message: "Table payment failed",
      });
    }
  },
);

export default router;