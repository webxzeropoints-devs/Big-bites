export type CurrencyValue = number | string;

export const MAX_CURRENCY_MINOR_UNITS = 9_999_999_999n;

function parseScaledInteger(
  value: CurrencyValue,
  label: string,
  maximum: bigint,
): bigint {
  const text = typeof value === "number" ? String(value) : value.trim();
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`${label} must be a valid number`);
  }

  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) {
    throw new Error(`${label} must be a non-negative amount with at most 2 decimal places`);
  }

  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  const scaled = whole * 100n + fraction;
  if (scaled > maximum) {
    throw new Error(`${label} exceeds the supported maximum`);
  }
  return scaled;
}

export function toMinorUnits(value: CurrencyValue, label = "Amount"): bigint {
  return parseScaledInteger(value, label, MAX_CURRENCY_MINOR_UNITS);
}

export function toRateBasisPoints(value: CurrencyValue, label = "Rate"): bigint {
  return parseScaledInteger(value, label, 10_000n);
}

export function fromMinorUnits(value: bigint): number {
  if (value < 0n || value > MAX_CURRENCY_MINOR_UNITS) {
    throw new Error("Amount exceeds the supported currency range");
  }
  return Number(value) / 100;
}

export function toDecimalString(value: bigint): string {
  if (value < 0n || value > MAX_CURRENCY_MINOR_UNITS) {
    throw new Error("Amount exceeds the supported currency range");
  }
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

export function multiplyMinorUnits(
  unitPrice: bigint,
  quantity: number,
): bigint {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new Error("Quantity must be a valid non-negative integer");
  }
  const total = unitPrice * BigInt(quantity);
  if (total > MAX_CURRENCY_MINOR_UNITS) {
    throw new Error("Line total exceeds the supported currency range");
  }
  return total;
}

export function roundRatioHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) {
    throw new Error("Invalid values for currency rounding");
  }
  return (numerator + denominator / 2n) / denominator;
}
