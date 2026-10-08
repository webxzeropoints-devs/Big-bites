import type { DiscountType } from "@prisma/client";
import { calculateDiscountMinor } from "./discount.js";
import {
  fromMinorUnits,
  toDecimalString,
  toMinorUnits,
} from "./currency.js";
import { calculateGstAmounts } from "./gst.js";

export type FinancialOrder = {
  total: unknown;
  gstRate: unknown;
  discountType?: DiscountType | null;
  discountValue?: unknown;
};

export function calculateOrderAmounts(order: FinancialOrder) {
  const subtotalMinor = toMinorUnits(String(order.total ?? 0), "Order subtotal");
  const discount = calculateDiscountMinor(
    subtotalMinor,
    order.discountType ?? null,
    order.discountValue == null ? null : String(order.discountValue),
  );
  const taxableMinor = discount.discountedSubtotalMinor;
  const gst = calculateGstAmounts(
    toDecimalString(taxableMinor),
    String(order.gstRate ?? 0),
  );

  return {
    subtotal: fromMinorUnits(subtotalMinor),
    discountAmount: fromMinorUnits(discount.discountAmountMinor),
    taxableSubtotal: fromMinorUnits(taxableMinor),
    gstRate: gst.gstRate,
    cgstRate: gst.cgstRate,
    sgstRate: gst.sgstRate,
    cgstAmount: gst.cgstAmount,
    sgstAmount: gst.sgstAmount,
    gstAmount: gst.gstAmount,
    grandTotal: gst.grandTotal,
    finalTotal: gst.grandTotal,
  };
}

export function sumOrderAmounts(orders: FinancialOrder[]) {
  const amounts = orders.map(calculateOrderAmounts);
  const sumMinor = (
    select: (amount: (typeof amounts)[number]) => number,
  ) =>
    amounts.reduce(
      (sum, amount) => sum + toMinorUnits(select(amount)),
      0n,
    );

  return {
    subtotal: fromMinorUnits(sumMinor((amount) => amount.subtotal)),
    discountAmount: fromMinorUnits(
      sumMinor((amount) => amount.discountAmount),
    ),
    taxableSubtotal: fromMinorUnits(
      sumMinor((amount) => amount.taxableSubtotal),
    ),
    cgstAmount: fromMinorUnits(sumMinor((amount) => amount.cgstAmount)),
    sgstAmount: fromMinorUnits(sumMinor((amount) => amount.sgstAmount)),
    gstAmount: fromMinorUnits(sumMinor((amount) => amount.gstAmount)),
    grandTotal: fromMinorUnits(sumMinor((amount) => amount.grandTotal)),
  };
}
