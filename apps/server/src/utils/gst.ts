import {
  fromMinorUnits,
  roundRatioHalfUp,
  toMinorUnits,
  toRateBasisPoints,
} from "./currency.js";

export type GstAmounts = {
  subtotal: number;
  gstRate: number;
  cgstRate: number;
  sgstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  gstAmount: number;
  grandTotal: number;
};

export function calculateGstAmounts(
  subtotal: number | string,
  gstRate: number | string,
): GstAmounts {
  let subtotalMinor: bigint;
  let rateBasisPoints: bigint;
  try {
    subtotalMinor = toMinorUnits(subtotal, "Subtotal");
    rateBasisPoints = toRateBasisPoints(gstRate, "GST rate");
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message.includes("GST rate")
        ? "GST rate must be between 0 and 100 with at most 2 decimal places"
        : error instanceof Error
          ? error.message
          : "Invalid GST amounts",
    );
  }

  const gstMinor = roundRatioHalfUp(
    subtotalMinor * rateBasisPoints,
    10_000n,
  );
  const cgstMinor = (gstMinor + 1n) / 2n;
  const sgstMinor = gstMinor / 2n;
  const rate = Number(rateBasisPoints) / 100;
  const cgstRate = rate / 2;

  return {
    subtotal: fromMinorUnits(subtotalMinor),
    gstRate: rate,
    cgstRate,
    sgstRate: cgstRate,
    cgstAmount: fromMinorUnits(cgstMinor),
    sgstAmount: fromMinorUnits(sgstMinor),
    gstAmount: fromMinorUnits(gstMinor),
    grandTotal: fromMinorUnits(subtotalMinor + gstMinor),
  };
}
