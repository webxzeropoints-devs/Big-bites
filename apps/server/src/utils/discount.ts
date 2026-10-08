import {
  fromMinorUnits,
  MAX_CURRENCY_MINOR_UNITS,
  roundRatioHalfUp,
  toMinorUnits,
  toRateBasisPoints,
} from "./currency.js";

export type DiscountKind = "AMOUNT" | "PERCENTAGE";

export type DiscountAmounts = {
  discountAmount: number;
  discountedSubtotal: number;
};

export type DiscountMinorAmounts = {
  discountAmountMinor: bigint;
  discountedSubtotalMinor: bigint;
};

export function calculateDiscountMinor(
  subtotalMinor: bigint,
  discountType: DiscountKind | null,
  discountValue: number | string | null,
): DiscountMinorAmounts {
  if (subtotalMinor < 0n || subtotalMinor > MAX_CURRENCY_MINOR_UNITS) {
    throw new Error("The bill total exceeds the supported currency range");
  }

  if (discountType === null && discountValue === null) {
    return { discountAmountMinor: 0n, discountedSubtotalMinor: subtotalMinor };
  }
  if (discountType === null || discountValue === null) {
    throw new Error("Select a discount type and enter a discount value");
  }

  const discountMinor = toMinorUnits(discountValue, "Discount");
  let discountAmountMinor: bigint;
  if (discountType === "AMOUNT") {
    if (discountMinor > subtotalMinor) {
      throw new Error("Discount cannot exceed the bill total");
    }
    discountAmountMinor = discountMinor;
  } else if (discountType === "PERCENTAGE") {
    const percentageBasisPoints = toRateBasisPoints(
      discountValue,
      "Percentage discount",
    );
    if (percentageBasisPoints > 10_000n) {
      throw new Error("Percentage discount cannot exceed 100%");
    }
    discountAmountMinor = roundRatioHalfUp(
      subtotalMinor * percentageBasisPoints,
      10_000n,
    );
  } else {
    throw new Error("Discount type must be AMOUNT or PERCENTAGE");
  }

  return {
    discountAmountMinor,
    discountedSubtotalMinor: subtotalMinor - discountAmountMinor,
  };
}

export function calculateDiscount(
  taxableSubtotal: number | string,
  discountType: DiscountKind | null,
  discountValue: number | string | null,
): DiscountAmounts {
  const amounts = calculateDiscountMinor(
    toMinorUnits(taxableSubtotal, "The bill subtotal"),
    discountType,
    discountValue,
  );

  return {
    discountAmount: fromMinorUnits(amounts.discountAmountMinor),
    discountedSubtotal: fromMinorUnits(amounts.discountedSubtotalMinor),
  };
}
