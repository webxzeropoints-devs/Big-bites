import ExcelJS from "exceljs";
import { prisma } from "../config/database.js";
import { toMinorUnits, fromMinorUnits } from "./currency.js";
import { calculateOrderAmounts } from "./financial.js";

const monthQueues = new Map<string, Promise<void>>();
const currencyFormat = '"₹"#,##0.00';

type PaidOrder = Awaited<ReturnType<typeof loadPaidOrders>>[number];

function paymentDate(order: {
  payment?: { paidAt: Date | null } | null;
  updatedAt: Date;
  createdAt: Date;
}) {
  return order.payment?.paidAt ?? order.updatedAt ?? order.createdAt;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(key: string) {
  const [year, month] = key.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  return {
    start,
    end: new Date(year, month, 1),
  };
}

function monthFileName(key: string) {
  const { start } = monthBounds(key);
  const month = new Intl.DateTimeFormat("en", { month: "long" }).format(start);
  return `${month} ${start.getFullYear()}.xlsx`;
}

async function loadPaidOrders(month?: string) {
  const orders = await prisma.order.findMany({
    where: {
      status: "COMPLETED",
      payment: {
        status: "PAID",
      },
    },
    include: {
      items: { include: { product: true, variant: true } },
      table: true,
      waiter: { select: { name: true } },
      payment: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return month
    ? orders.filter((order) => monthKey(paymentDate(order)) === month)
    : orders;
}

async function withMonthLock<T>(key: string, action: () => Promise<T>) {
  const previous = monthQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  monthQueues.set(key, current);
  await previous;

  try {
    return await action();
  } finally {
    release();
    if (monthQueues.get(key) === current) {
      monthQueues.delete(key);
    }
  }
}

async function writeMonthWorkbook(key: string) {
  const orders = await loadPaidOrders(key);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BIG BITES POS";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Orders");
  sheet.columns = [
    { header: "Order No", key: "orderNo", width: 12 },
    { header: "Date", key: "date", width: 14 },
    { header: "Time", key: "time", width: 12 },
    { header: "Paid At", key: "paidAt", width: 20 },
    { header: "Table", key: "table", width: 12 },
    { header: "Items", key: "items", width: 42 },
    { header: "Subtotal", key: "subtotal", width: 14, style: { numFmt: currencyFormat } },
    { header: "Discount", key: "discount", width: 14, style: { numFmt: currencyFormat } },
    { header: "GST", key: "gst", width: 14, style: { numFmt: currencyFormat } },
    { header: "GST Status", key: "gstStatus", width: 14 },
    { header: "Final Total", key: "total", width: 14, style: { numFmt: currencyFormat } },
    { header: "Payment Method", key: "method", width: 18 },
    { header: "Amount Received", key: "received", width: 18, style: { numFmt: currencyFormat } },
    { header: "Change", key: "change", width: 14, style: { numFmt: currencyFormat } },
    { header: "Waiter", key: "waiter", width: 22 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF252A31" },
  };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: "O1" };

  let incomeMinor = 0n;
  for (const order of orders) {
    const payment = order.payment;
    if (!payment || payment.status !== "PAID") continue;

    const paidAt = paymentDate(order);
    const amounts = calculateOrderAmounts(order);
    incomeMinor += toMinorUnits(String(payment.amount));
    sheet.addRow({
      orderNo: order.id,
      date: order.createdAt,
      time: order.createdAt,
      paidAt,
      table: order.table.isParcel ? "Parcel" : `Table ${order.table.number}`,
      items: order.items
        .map(
          (item) =>
            `${item.product.name}${item.variant ? ` - ${item.variant.name}` : ""} × ${item.quantity}`,
        )
        .join(", "),
      subtotal: amounts.subtotal,
      discount: amounts.discountAmount,
      gst: amounts.gstAmount,
      gstStatus: order.gstEnabled ? "ON" : "OFF",
      total: Number(payment.amount),
      method: payment.method ?? "",
      received:
        payment.amountReceived == null ? null : Number(payment.amountReceived),
      change: payment.change == null ? null : Number(payment.change),
      waiter: order.waiter.name,
    });
  }

  sheet.getColumn("date").numFmt = "dd/mm/yyyy";
  sheet.getColumn("time").numFmt = "hh:mm";
  sheet.getColumn("paidAt").numFmt = "dd/mm/yyyy hh:mm";
  const totalRow = sheet.addRow([]);
  totalRow.getCell(1).value = "MONTH TOTAL INCOME";
  totalRow.getCell(11).value = fromMinorUnits(incomeMinor);
  totalRow.font = { bold: true };
  totalRow.getCell(11).numFmt = currencyFormat;

  const fileName = monthFileName(key);
  const contentBase64 = Buffer.from(await workbook.xlsx.writeBuffer()).toString(
    "base64",
  );

  return {
    month: key,
    fileName,
    orderCount: orders.length,
    totalIncome: fromMinorUnits(incomeMinor),
    contentBase64,
  };
}

export async function exportPaidOrderReport(orderId: number) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payment: true },
  });
  if (
    !order ||
    order.status !== "COMPLETED" ||
    order.payment?.status !== "PAID"
  ) {
    throw new Error(`Order #${orderId} is not completed and paid.`);
  }

  const key = monthKey(paymentDate(order));
  return withMonthLock(key, () => writeMonthWorkbook(key));
}

export async function exportPaidOrderReports(orderIds: number[]) {
  const orders = await prisma.order.findMany({
    where: {
      id: { in: orderIds },
      status: "COMPLETED",
      payment: { status: "PAID" },
    },
    include: { payment: true },
  });
  if (orders.length !== new Set(orderIds).size) {
    throw new Error("One or more orders are not completed and paid.");
  }

  const months = [
    ...new Set(orders.map((order) => monthKey(paymentDate(order)))),
  ].sort();
  const reports = [];
  for (const month of months) {
    reports.push(await withMonthLock(month, () => writeMonthWorkbook(month)));
  }
  return reports;
}

export async function exportAllOrderReports() {
  const orders = await loadPaidOrders();
  const months = [...new Set(orders.map((order) => monthKey(paymentDate(order))))].sort();
  const reports = [];

  for (const month of months) {
    reports.push(await withMonthLock(month, () => writeMonthWorkbook(month)));
  }

  return reports;
}

export async function getOrderReportSummary() {
  const [orders, settings] = await Promise.all([
    loadPaidOrders(),
    prisma.restaurantSettings.findUnique({
      where: { id: 1 },
      select: { orderReportsPath: true },
    }),
  ]);
  const grouped = new Map<string, PaidOrder[]>();
  for (const order of orders) {
    const key = monthKey(paymentDate(order));
    const monthOrders = grouped.get(key) ?? [];
    monthOrders.push(order);
    grouped.set(key, monthOrders);
  }

  const months = [...grouped.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([key, monthOrders]) => {
      const incomeMinor = monthOrders.reduce(
        (sum, order) =>
          sum + toMinorUnits(String(order.payment?.amount ?? 0)),
        0n,
      );
      return {
        month: key,
        fileName: monthFileName(key),
        orderCount: monthOrders.length,
        totalIncome: fromMinorUnits(incomeMinor),
      };
    });

  return {
    folderPath: settings?.orderReportsPath.trim() ?? "",
    months,
  };
}
