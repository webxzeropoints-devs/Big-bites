export type DiscountKind = "AMOUNT" | "PERCENTAGE";

export type DiscountAmounts = {
  discountAmount: number;
  grandTotal: number;
};

const roundCurrency = (amount: number) =>
  Math.round((amount + Number.EPSILON) * 100) / 100;

export function calculateDiscount(
  taxableGrandTotal: number,
  discountType: DiscountKind | null,
  discountValue: number | null,
): DiscountAmounts {
  if (!Number.isFinite(taxableGrandTotal) || taxableGrandTotal < 0) {
    throw new Error("The bill total is invalid");
  }

  if (discountType === null && discountValue === null) {
    return { discountAmount: 0, grandTotal: roundCurrency(taxableGrandTotal) };
  }
  if (discountType === null || discountValue === null) {
    throw new Error("Select a discount type and enter a discount value");
  }
  if (!Number.isFinite(discountValue) || discountValue < 0) {
    throw new Error("Discount must be a valid non-negative number");
  }

  let discountAmount: number;
  if (discountType === "AMOUNT") {
    if (discountValue > taxableGrandTotal) {
      throw new Error("Discount cannot exceed the bill total");
    }
    discountAmount = roundCurrency(discountValue);
  } else {
    if (discountValue > 100) {
      throw new Error("Percentage discount cannot exceed 100%");
    }
    discountAmount = roundCurrency((taxableGrandTotal * discountValue) / 100);
  }

  return {
    discountAmount,
    grandTotal: roundCurrency(taxableGrandTotal - discountAmount),
  };
}
