const MAX_MINOR_UNITS = 9_999_999_999n;

export function parseMinorUnits(value: string | number): bigint | null {
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const text = String(value).trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const amount =
    BigInt(match[1]) * 100n +
    BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  return amount <= MAX_MINOR_UNITS ? amount : null;
}

export function minorUnitsToNumber(value: bigint): number {
  if (value < 0n || value > MAX_MINOR_UNITS) {
    throw new Error("Amount exceeds the supported currency range");
  }
  return Number(value) / 100;
}

export function roundRatioHalfUp(
  numerator: bigint,
  denominator: bigint,
): bigint {
  return (numerator + denominator / 2n) / denominator;
}

export function sumMinorUnits(values: Array<string | number>): bigint {
  return values.reduce((sum, value) => {
    const minor = parseMinorUnits(value);
    if (minor === null) throw new Error("Invalid currency amount");
    return sum + minor;
  }, 0n);
}

export function calculateAmounts(
  subtotal: string | number,
  gstRate: string | number,
  discountAmount: string | number,
) {
  const subtotalMinor = parseMinorUnits(subtotal);
  const rateMinor = parseMinorUnits(gstRate);
  const discountMinor = parseMinorUnits(discountAmount);
  if (
    subtotalMinor === null ||
    rateMinor === null ||
    discountMinor === null ||
    discountMinor > subtotalMinor
  ) {
    throw new Error("Invalid billing amount");
  }

  const taxableMinor = subtotalMinor - discountMinor;
  const gstMinor = roundRatioHalfUp(taxableMinor * rateMinor, 10_000n);
  const cgstMinor = (gstMinor + 1n) / 2n;
  const sgstMinor = gstMinor / 2n;

  return {
    subtotal: minorUnitsToNumber(subtotalMinor),
    discountAmount: minorUnitsToNumber(discountMinor),
    taxableSubtotal: minorUnitsToNumber(taxableMinor),
    gstRate: minorUnitsToNumber(rateMinor),
    cgstRate: minorUnitsToNumber(rateMinor) / 2,
    sgstRate: minorUnitsToNumber(rateMinor) / 2,
    cgstAmount: minorUnitsToNumber(cgstMinor),
    sgstAmount: minorUnitsToNumber(sgstMinor),
    gstAmount: minorUnitsToNumber(gstMinor),
    grandTotal: minorUnitsToNumber(taxableMinor + gstMinor),
  };
}

export function calculateDiscountAmount(
  subtotal: string | number,
  type: "AMOUNT" | "PERCENTAGE",
  rawValue: string,
): bigint | null {
  const subtotalMinor = parseMinorUnits(subtotal);
  if (subtotalMinor === null) return null;
  if (!rawValue.trim()) return 0n;
  const valueMinor = parseMinorUnits(rawValue);
  if (valueMinor === null) return null;

  if (type === "AMOUNT") {
    return valueMinor <= subtotalMinor ? valueMinor : null;
  }
  if (valueMinor > 10_000n) return null;
  return roundRatioHalfUp(subtotalMinor * valueMinor, 10_000n);
}
