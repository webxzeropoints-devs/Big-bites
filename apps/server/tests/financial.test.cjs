const assert = require("node:assert/strict");
const { test } = require("node:test");

const { toDecimalString, toMinorUnits } = require("../dist/utils/currency.js");
const { calculateDiscount } = require("../dist/utils/discount.js");
const { calculateOrderAmounts, sumOrderAmounts } = require("../dist/utils/financial.js");
const { calculateGstAmounts } = require("../dist/utils/gst.js");

test("exact product-cent multiplication and decimal formatting", () => {
  assert.equal(
    toDecimalString(toMinorUnits("0.10") * 3n),
    "0.30",
  );
  assert.equal(toDecimalString(toMinorUnits("19.99") * 4n), "79.96");
});

test("default GST rounds total tax once, then splits 2.5% CGST and SGST", () => {
  assert.deepEqual(calculateGstAmounts("1.00", "5.00"), {
    subtotal: 1,
    gstRate: 5,
    cgstRate: 2.5,
    sgstRate: 2.5,
    cgstAmount: 0.03,
    sgstAmount: 0.02,
    gstAmount: 0.05,
    grandTotal: 1.05,
  });
  assert.deepEqual(calculateGstAmounts("0.10", "5"), {
    subtotal: 0.1,
    gstRate: 5,
    cgstRate: 2.5,
    sgstRate: 2.5,
    cgstAmount: 0.01,
    sgstAmount: 0,
    gstAmount: 0.01,
    grandTotal: 0.11,
  });
});

test("fixed and percentage discounts apply before GST with half-up paise rounding", () => {
  assert.deepEqual(calculateDiscount("10.00", "AMOUNT", "1.25"), {
    discountAmount: 1.25,
    discountedSubtotal: 8.75,
  });
  assert.deepEqual(calculateDiscount("10.00", "PERCENTAGE", "10"), {
    discountAmount: 1,
    discountedSubtotal: 9,
  });
  const amounts = calculateOrderAmounts({
    total: "10.00",
    gstRate: "5.00",
    discountType: "PERCENTAGE",
    discountValue: "10.00",
  });
  assert.equal(amounts.subtotal, 10);
  assert.equal(amounts.discountAmount, 1);
  assert.equal(amounts.taxableSubtotal, 9);
  assert.equal(amounts.cgstAmount, 0.23);
  assert.equal(amounts.sgstAmount, 0.22);
  assert.equal(amounts.grandTotal, 9.45);
});

test("discounted taxable subtotal is taxed once to produce the invoice grand total", () => {
  const amounts = calculateOrderAmounts({
    total: "205.00",
    gstRate: "5.00",
    discountType: "AMOUNT",
    discountValue: "5.00",
  });

  assert.equal(amounts.subtotal, 205);
  assert.equal(amounts.discountAmount, 5);
  assert.equal(amounts.taxableSubtotal, 200);
  assert.equal(amounts.cgstAmount, 5);
  assert.equal(amounts.sgstAmount, 5);
  assert.equal(amounts.gstAmount, 10);
  assert.equal(amounts.grandTotal, 210);
});

test("zero discount and zero GST preserve the taxable subtotal as the grand total", () => {
  const zeroDiscount = calculateOrderAmounts({
    total: "205.00",
    gstRate: "5.00",
    discountType: null,
    discountValue: null,
  });
  assert.equal(zeroDiscount.discountAmount, 0);
  assert.equal(zeroDiscount.taxableSubtotal, 205);
  assert.equal(zeroDiscount.grandTotal, 215.25);

  const noGst = calculateOrderAmounts({
    total: "205.00",
    gstRate: "0.00",
    discountType: "AMOUNT",
    discountValue: "5.00",
  });
  assert.equal(noGst.taxableSubtotal, 200);
  assert.equal(noGst.gstAmount, 0);
  assert.equal(noGst.grandTotal, 200);
});

test("invalid currency, discount, and GST values are rejected", () => {
  for (const value of ["1.001", "-0.01", "Infinity", "", "1e3"]) {
    assert.throws(() => toMinorUnits(value));
  }
  assert.throws(() => calculateDiscount("10.00", "AMOUNT", "10.01"));
  assert.throws(() => calculateDiscount("10.00", "PERCENTAGE", "100.01"));
  assert.throws(() => calculateDiscount("10.00", "AMOUNT", "0.001"));
  assert.throws(() => calculateGstAmounts("10.00", "100.001"));
});

test("table totals sum already-rounded per-order tax and discount amounts in paise", () => {
  const result = sumOrderAmounts([
    { total: "1.00", gstRate: "5.00", discountType: null, discountValue: null },
    {
      total: "10.00",
      gstRate: "5.00",
      discountType: "AMOUNT",
      discountValue: "1.00",
    },
  ]);
  assert.equal(result.subtotal, 11);
  assert.equal(result.discountAmount, 1);
  assert.equal(result.taxableSubtotal, 10);
  assert.equal(result.cgstAmount, 0.26);
  assert.equal(result.sgstAmount, 0.24);
  assert.equal(result.gstAmount, 0.5);
  assert.equal(result.grandTotal, 10.5);
});
