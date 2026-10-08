const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const ExcelJS = require("exceljs");

const { prisma } = require("../dist/config/database.js");
const {
  exportAllOrderReports,
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

let reportDirectory;

async function readWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await readFile(filePath));
  return workbook.worksheets[0];
}

after(async () => {
  if (reportDirectory) {
    await rm(reportDirectory, { recursive: true, force: true });
  }
});

test("monthly export rebuilds paid orders once and recalculates income", async () => {
  reportDirectory = await mkdtemp(path.join(os.tmpdir(), "big-bites-reports-"));
  prisma.restaurantSettings.findUnique = async () => ({
    orderReportsPath: reportDirectory,
  });
  prisma.order.findMany = async () => orders;

  const firstExport = await exportAllOrderReports();
  const secondExport = await exportAllOrderReports();

  assert.equal(firstExport.length, 1);
  assert.equal(secondExport.length, 1);
  assert.equal(secondExport[0].fileName, "October 2026.xlsx");
  assert.equal(secondExport[0].orderCount, 2);
  assert.equal(secondExport[0].totalIncome, 31);

  const sheet = await readWorkbook(
    path.join(reportDirectory, "October 2026.xlsx"),
  );
  assert.equal(sheet.rowCount, 4);
  assert.deepEqual(
    [sheet.getCell("A2").value, sheet.getCell("A3").value],
    [101, 102],
  );
  assert.equal(sheet.getCell("I2").value, 1);
  assert.equal(sheet.getCell("I3").value, 0);
  assert.equal(sheet.getCell("J2").value, "ON");
  assert.equal(sheet.getCell("J3").value, "OFF");
  assert.equal(sheet.getCell("K4").value, 31);

  const summary = await getOrderReportSummary();
  assert.equal(summary.folderAvailable, true);
  assert.equal(summary.months[0].orderCount, 2);
  assert.equal(summary.months[0].totalIncome, 31);
  assert.equal(summary.months[0].fileExists, true);
});

test("monthly export reports an unavailable selected folder", async () => {
  prisma.restaurantSettings.findUnique = async () => ({
    orderReportsPath: path.join(reportDirectory, "not-available"),
  });

  await assert.rejects(
    exportAllOrderReports(),
    /selected Excel save folder is unavailable or not writable/i,
  );
});
