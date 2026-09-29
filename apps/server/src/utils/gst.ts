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

const roundCurrency = (amount: number) =>
  Math.round((amount + Number.EPSILON) * 100) / 100;

export function calculateGstAmounts(
  subtotal: number,
  gstRate: number,
): GstAmounts {
  const halfRate = gstRate / 2;
  const cgstAmount = roundCurrency((subtotal * halfRate) / 100);
  const sgstAmount = roundCurrency((subtotal * halfRate) / 100);
  const gstAmount = roundCurrency(cgstAmount + sgstAmount);

  return {
    subtotal: roundCurrency(subtotal),
    gstRate,
    cgstRate: halfRate,
    sgstRate: halfRate,
    cgstAmount,
    sgstAmount,
    gstAmount,
    grandTotal: roundCurrency(subtotal + gstAmount),
  };
}
