const assert = require("node:assert/strict");
const { test } = require("node:test");
const ExcelJS = require("exceljs");

const { prisma } = require("../dist/config/database.js");
const {
  exportAllOrderReports,
  exportMonthlyOrderReport,
  getOrderReportSummary,
} = require("../dist/utils/orderReports.js");

const paidAt = new Date(2026, 9, 6, 12, 30);
const orders = [
  {
    id: 101,
    status: "COMPLETED",
    total: "20.00",
    gstRate: "5.00",
    gstEnabled: true,
    discountType: null,
    discountValue: null,
    discountAmount: "0.00",
    createdAt: paidAt,
    updatedAt: paidAt,
    table: { number: 4, isParcel: false },
    waiter: { name: "Test Waiter" },
    items: [
      {
        quantity: 2,
        unitPrice: "10.00",
        subtotal: "20.00",
        product: { name: "Test Meal" },
      },
    ],
    payment: {
      status: "PAID",
      paidAt,
      amount: "21.00",
      amountReceived: "25.00",
      change: "4.00",
      method: "CASH",
    },
  },
  {
    id: 103,
    status: "COMPLETED",
    total: "15.00",
    gstRate: "0.00",
    gstEnabled: false,
    discountType: null,
    discountValue: null,
    discountAmount: "0.00",
    createdAt: paidAt,
    updatedAt: paidAt,
    table: { number: 6, isParcel: false },
    waiter: { name: "Test Waiter" },
    items: [
      {
        quantity: 1,
        unitPrice: "15.00",
        subtotal: "15.00",
        product: { name: "Test Plate" },
      },
    ],
    payment: {
      status: "PAID",
      paidAt,
      amount: "15.00",
      amountReceived: "15.00",
      change: "0.00",
      cashAmount: "5.00",
      upiAmount: "10.00",
      method: "CASH_UPI",
    },
  },
  {
    id: 102,
    status: "COMPLETED",
    total: "10.00",
    gstRate: "0.00",
    gstEnabled: false,
    discountType: null,
    discountValue: null,
    discountAmount: "0.00",
    createdAt: paidAt,
    updatedAt: paidAt,
    table: { number: 5, isParcel: false },
    waiter: { name: "Test Waiter" },
    items: [
      {
        quantity: 1,
        unitPrice: "10.00",
        subtotal: "10.00",
        product: { name: "Test Snack" },
      },
    ],
    payment: {
      status: "PAID",
      paidAt,
      amount: "10.00",
      amountReceived: null,
      change: null,
      method: "UPI",
    },
  },
];

async function readWorkbook(contentBase64) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(contentBase64, "base64"));
  return workbook.worksheets[0];
}

test("monthly export rebuilds paid orders and returns workbooks for local saving", async () => {
  prisma.order.findMany = async () => orders;

  const firstExport = await exportAllOrderReports();
  const secondExport = await exportAllOrderReports();

  assert.equal(firstExport.length, 1);
  assert.equal(secondExport.length, 1);
  assert.equal(secondExport[0].fileName, "October 2026.xlsx");
  assert.equal(secondExport[0].orderCount, 3);
  assert.equal(secondExport[0].totalIncome, 46);
  assert.equal(typeof secondExport[0].contentBase64, "string");

  const sheet = await readWorkbook(secondExport[0].contentBase64);
  assert.equal(sheet.rowCount, 5);
  assert.deepEqual(
    [sheet.getCell("A2").value, sheet.getCell("A3").value, sheet.getCell("A4").value],
    [101, 103, 102],
  );
  assert.equal(sheet.getCell("I2").value, 1);
  assert.equal(sheet.getCell("I3").value, 0);
  assert.equal(sheet.getCell("L3").value, "CASH_UPI");
  assert.equal(sheet.getCell("M3").value, 5);
  assert.equal(sheet.getCell("N3").value, 10);
  assert.equal(sheet.getCell("J2").value, "ON");
  assert.equal(sheet.getCell("J3").value, "OFF");
  assert.equal(sheet.getCell("K5").value, 46);

  const summary = await getOrderReportSummary();
  assert.equal(summary.months.length, 1);
  assert.equal(summary.months[0].orderCount, 3);
  assert.equal(summary.months[0].totalIncome, 46);
});

test("selected-month export contains only the selected reporting period", async () => {
  const novemberOrder = {
    ...orders[0],
    id: 104,
    createdAt: new Date(2026, 10, 6, 12, 30),
    payment: {
      ...orders[0].payment,
      paidAt: new Date(2026, 10, 6, 12, 30),
    },
  };
  prisma.order.findMany = async () => [...orders, novemberOrder];

  const report = await exportMonthlyOrderReport("2026-10");
  assert.equal(report.fileName, "October 2026.xlsx");
  assert.equal(report.orderCount, 3);
  const sheet = await readWorkbook(report.contentBase64);
  assert.equal(sheet.rowCount, 5);
  assert.equal(sheet.getCell("A2").value, 101);
  assert.equal(sheet.getCell("A4").value, 102);

  await assert.rejects(
    exportMonthlyOrderReport("2026-13"),
    /YYYY-MM|supported range/i,
  );
});
