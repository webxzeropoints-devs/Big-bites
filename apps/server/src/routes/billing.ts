import { Router } from "express";
import { prisma } from "../config/database.js";
import { requireRoles } from "../middleware/auth.js";
import type { DiscountType } from "@prisma/client";
import { calculateDiscount, type DiscountKind } from "../utils/discount.js";
import {
  fromMinorUnits,
  toDecimalString,
  toMinorUnits,
} from "../utils/currency.js";
import {
  calculateOrderAmounts,
  sumOrderAmounts,
} from "../utils/financial.js";
import type { CurrencyValue } from "../utils/currency.js";
import {
  exportPaidOrderReport,
  exportPaidOrderReports,
} from "../utils/orderReports.js";

const router = Router();

class BillingRequestError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

function parseAmountReceived(method: string, rawValue: unknown) {
  if (method !== "CASH") {
    if (rawValue !== undefined) {
      throw new BillingRequestError(
        400,
        "Amount received is only valid for cash payments",
      );
    }
    return undefined;
  }
  if (rawValue === undefined) return undefined;
  if (typeof rawValue !== "number" && typeof rawValue !== "string") {
    throw new BillingRequestError(
      400,
      "Amount received must be a valid non-negative amount",
    );
  }
  try {
    return toMinorUnits(rawValue as CurrencyValue, "Amount received");
  } catch (error) {
    throw new BillingRequestError(
      400,
      error instanceof Error
        ? error.message
        : "Amount received must be a valid non-negative amount",
    );
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
  requireRoles("ADMIN", "CASHIER"),
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
          gstEnabled: true,
          gstRate: true,
          restaurantAddress: true,
          fssaiEnabled: true,
          fssaiNumber: true,
          gstinEnabled: true,
          gstinNumber: true,
        },
      });

      return res.json(
        orders.map((order) => ({
          ...order,
          ...calculateOrderAmounts({
            ...order,
            gstRate:
              settings?.gstEnabled === false
                ? 0
                : settings?.gstRate ?? order.gstRate,
          }),
          gstEnabled: settings?.gstEnabled ?? true,
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
  requireRoles("ADMIN", "CASHIER"),
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
          gstEnabled: true,
          gstRate: true,
          restaurantAddress: true,
          fssaiEnabled: true,
          fssaiNumber: true,
          gstinEnabled: true,
          gstinNumber: true,
        },
      });

      return res.json(
        orders.map((order) => ({
          ...order,
          ...calculateOrderAmounts(order),
          gstEnabled: order.gstEnabled,
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
          gstEnabled: true,
          gstRate: true,
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
        ...calculateOrderAmounts({
          ...order,
          gstRate:
            order.payment?.status === "PAID"
              ? order.gstRate
              : settings?.gstEnabled === false
                ? 0
                : settings?.gstRate ?? order.gstRate,
        }),
        gstEnabled:
          order.payment?.status === "PAID"
            ? order.gstEnabled
            : settings?.gstEnabled ?? true,
        discountType: order.discountType,
        discountValue: order.discountValue,
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
  requireRoles("ADMIN", "CASHIER"),
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

      let discountValue: string | null = null;
      if (rawValue !== null && rawValue !== undefined && rawValue !== "") {
        if (typeof rawValue !== "number" && typeof rawValue !== "string") {
          return res.status(400).json({
            message: "Discount must be a valid non-negative number",
          });
        }
        try {
          discountValue = toDecimalString(
            toMinorUnits(rawValue, "Discount"),
          );
        } catch (error) {
          return res.status(400).json({
            message: error instanceof Error
              ? error.message
              : "Discount must be a valid non-negative amount",
          });
        }
      }

      const updated = await prisma.$transaction(async (tx) => {
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
        if (
          order.status !== "READY_FOR_BILLING" ||
          order.payment?.status === "PAID" ||
          order.payment?.status === "REFUNDED"
        ) {
          throw new BillingRequestError(
            409,
            "Discounts can only be changed before payment",
          );
        }

        let discount;
        try {
          discount = calculateDiscount(
            String(order.total),
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
        const settings = await tx.restaurantSettings.findUnique({
          where: { id: 1 },
          select: { gstEnabled: true, gstRate: true },
        });
        const amounts = calculateOrderAmounts({
          ...order,
          gstRate:
            settings?.gstEnabled === false
              ? 0
              : settings?.gstRate ?? order.gstRate,
          total: String(order.total),
          discountType: nextType,
          discountValue,
        });
        const saved = await tx.order.update({
          where: { id: orderId },
          data: {
            discountType: nextType,
            discountValue,
            discountAmount: toDecimalString(
              toMinorUnits(discount.discountAmount, "Discount"),
            ),
          },
        });
        if (order.payment) {
          await tx.payment.update({
            where: { orderId },
            data: {
              amount: toDecimalString(
                toMinorUnits(amounts.grandTotal, "Order total"),
              ),
            },
          });
        }

        return {
          saved,
          discount,
          amounts,
          gstEnabled: settings?.gstEnabled ?? true,
        };
      });

      return res.json({
        discountType: updated.saved.discountType,
        discountValue: updated.saved.discountValue,
        gstEnabled: updated.gstEnabled,
        ...updated.amounts,
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
  requireRoles("ADMIN", "CASHIER"),
  async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const { method, amountReceived } = body;

      if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).json({ message: "Invalid order ID" });
      }

      const allowedMethods = ["CASH", "UPI", "CARD"];
      if (!allowedMethods.includes(method)) {
        return res.status(400).json({
          message: "Payment method must be CASH, UPI or CARD",
        });
      }

      const receivedMinor = parseAmountReceived(method, amountReceived);

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

        const settings = await tx.restaurantSettings.upsert({
          where: { id: 1 },
          create: { id: 1, gstRate: 5, gstEnabled: true },
          update: {},
        });
        const billableOrder = {
          ...order,
          gstRate: settings.gstEnabled ? settings.gstRate : 0,
          gstEnabled: settings.gstEnabled,
        };
        const gstAmounts = calculateOrderAmounts(billableOrder);
        const totalMinor = toMinorUnits(gstAmounts.grandTotal);
        if (
          method === "CASH" &&
          receivedMinor !== undefined &&
          receivedMinor < totalMinor
        ) {
          throw new BillingRequestError(
            400,
            "Amount received cannot be less than the amount due",
          );
        }

        const paidAt = new Date();
        const received = receivedMinor ?? totalMinor;
        const changeMinor =
          method === "CASH" ? received - totalMinor : undefined;
        const payment = order.payment
          ? await tx.payment.update({
              where: { orderId },
              data: {
                amount: toDecimalString(totalMinor),
                amountReceived:
                  receivedMinor === undefined && method !== "CASH"
                    ? null
                    : toDecimalString(received),
                change:
                  changeMinor === undefined
                    ? null
                    : toDecimalString(changeMinor),
                method,
                status: "PAID",
                paidAt,
              },
            })
          : await tx.payment.create({
              data: {
                orderId,
                amount: toDecimalString(totalMinor),
                amountReceived:
                  receivedMinor === undefined && method !== "CASH"
                    ? null
                    : toDecimalString(received),
                change:
                  changeMinor === undefined
                    ? null
                    : toDecimalString(changeMinor),
                method,
                status: "PAID",
                paidAt,
              },
            });

        const updatedOrder = await tx.order.update({
          where: { id: orderId },
          data: {
            status: "COMPLETED",
            gstRate: billableOrder.gstRate,
            gstEnabled: billableOrder.gstEnabled,
          },
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

        return {
          payment,
          order: updatedOrder,
          ...gstAmounts,
        };
      });

      const totalMinor = toMinorUnits(result.grandTotal);
      const received = receivedMinor ?? totalMinor;
      let orderReportError: string | undefined;
      try {
        await exportPaidOrderReport(result.order.id);
      } catch (error) {
        console.error("Paid order report export failed:", {
          orderId: result.order.id,
          error,
        });
        orderReportError =
          error instanceof Error
            ? error.message
            : "The monthly Excel order report could not be updated.";
      }
      return res.json({
        message: "Payment received",
        ...result,
        gstEnabled: result.order.gstEnabled,
        total: fromMinorUnits(totalMinor),
        finalTotal: fromMinorUnits(totalMinor),
        amountReceived:
          method === "CASH" ? fromMinorUnits(received) : null,
        change:
          method === "CASH"
            ? fromMinorUnits(received - totalMinor)
            : null,
        ...(orderReportError ? { orderReportError } : {}),
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
  requireRoles("ADMIN", "CASHIER"),
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

      const settings = await prisma.restaurantSettings.findUnique({
        where: { id: 1 },
        select: {
          gstEnabled: true,
          gstRate: true,
          restaurantAddress: true,
          fssaiEnabled: true,
          fssaiNumber: true,
          gstinEnabled: true,
          gstinNumber: true,
        },
      });
      const billableOrders = orders.map((order) => ({
        ...order,
        gstRate:
          settings?.gstEnabled === false
            ? 0
            : settings?.gstRate ?? order.gstRate,
        gstEnabled: settings?.gstEnabled ?? true,
      }));
      const amounts = sumOrderAmounts(billableOrders);

      return res.json({
        tableId: table.id,
        tableNumber: table.number,
        tableLabel: table.isParcel
          ? "Parcel"
          : `Table ${table.number}`,
        orderCount: orders.length,
        orders: billableOrders.map((order) => ({
          ...order,
          ...calculateOrderAmounts(order),
        })),
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
  requireRoles("ADMIN", "CASHIER"),
  async (req, res) => {
    try {
      const tableId = Number(req.params.tableId);
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const { method, amountReceived } = body;

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

      const receivedMinor = parseAmountReceived(method, amountReceived);

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

        const settings = await tx.restaurantSettings.upsert({
          where: { id: 1 },
          create: { id: 1, gstRate: 5, gstEnabled: true },
          update: {},
        });
        const billableOrders = orders.map((order) => ({
          ...order,
          gstRate: settings.gstEnabled ? settings.gstRate : 0,
          gstEnabled: settings.gstEnabled,
        }));
        const amounts = sumOrderAmounts(billableOrders);
        const totalMinor = toMinorUnits(amounts.grandTotal);

        if (
          method === "CASH" &&
          receivedMinor !== undefined &&
          receivedMinor < totalMinor
        ) {
          throw new BillingRequestError(
            400,
            "Amount received cannot be less than the amount due",
          );
        }

        const payments = [];

        for (const order of billableOrders) {
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
          const orderTotalMinor = toMinorUnits(
            calculateOrderAmounts(order).grandTotal,
          );
          const tableChangeMinor =
            method === "CASH"
              ? (receivedMinor ?? totalMinor) - totalMinor
              : undefined;
          const orderReceivedMinor =
            tableChangeMinor === undefined
              ? undefined
              : orderTotalMinor +
                (order.id === orders[0].id ? tableChangeMinor : 0n);
          const orderChangeMinor =
            tableChangeMinor === undefined
              ? undefined
              : order.id === orders[0].id
                ? tableChangeMinor
                : 0n;
          const payment = order.payment
            ? await tx.payment.update({
                where: { orderId: order.id },
                data: {
                  amount: toDecimalString(orderTotalMinor),
                  amountReceived:
                    orderReceivedMinor === undefined
                      ? null
                      : toDecimalString(orderReceivedMinor),
                  change:
                    orderChangeMinor === undefined
                      ? null
                      : toDecimalString(orderChangeMinor),
                  method,
                  status: "PAID",
                  paidAt,
                },
              })
            : await tx.payment.create({
                data: {
                  orderId: order.id,
                  amount: toDecimalString(orderTotalMinor),
                  amountReceived:
                    orderReceivedMinor === undefined
                      ? null
                      : toDecimalString(orderReceivedMinor),
                  change:
                    orderChangeMinor === undefined
                      ? null
                      : toDecimalString(orderChangeMinor),
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
              gstRate: order.gstRate,
              gstEnabled: order.gstEnabled,
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
          orders: billableOrders,
          amounts,
          totalMinor,
          tableStatus,
        };
      });

      const received = receivedMinor ?? result.totalMinor;

      const change =
        method === "CASH"
          ? received - result.totalMinor
          : 0n;
      let orderReportErrors: string[] = [];
      try {
        await exportPaidOrderReports(
          result.orders.map((order) => order.id),
        );
      } catch (error) {
        console.error("Table paid order report export failed:", {
          orderIds: result.orders.map((order) => order.id),
          error,
        });
        orderReportErrors = [
          error instanceof Error
            ? error.message
            : "The monthly Excel order report could not be updated.",
        ];
      }

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
        taxableSubtotal: result.amounts.taxableSubtotal,
        discountAmount: result.amounts.discountAmount,
        cgstAmount: result.amounts.cgstAmount,
        sgstAmount: result.amounts.sgstAmount,
        gstAmount: result.amounts.gstAmount,
        grandTotal: result.amounts.grandTotal,
        total: fromMinorUnits(result.totalMinor),

        amountReceived:
          method === "CASH" ? fromMinorUnits(received) : null,

        change:
          method === "CASH" ? fromMinorUnits(change) : null,

        method,

        payments: result.payments,
        ...(orderReportErrors.length > 0 ? { orderReportErrors } : {}),
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