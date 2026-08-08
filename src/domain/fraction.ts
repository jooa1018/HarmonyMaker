export interface Fraction {
  readonly n: number;
  readonly d: number;
}

export const FRACTION_LIMITS = {
  maxAbsoluteNumerator: 10_000_000,
  maxDenominator: 16_384,
  maxOperationAbsoluteNumerator: 500_000,
} as const;

export class FractionError extends RangeError {
  constructor(
    readonly code: "INPUT_INVALID_FRACTION" | "INPUT_FRACTION_LIMIT_EXCEEDED",
    message: string,
  ) {
    super(message);
    this.name = "FractionError";
  }
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new FractionError("INPUT_INVALID_FRACTION", `${label} must be a safe integer`);
  }
}

export function fraction(numerator: number, denominator = 1): Fraction {
  assertSafeInteger(numerator, "numerator");
  assertSafeInteger(denominator, "denominator");
  if (denominator === 0) {
    throw new FractionError("INPUT_INVALID_FRACTION", "denominator must be greater than zero");
  }

  const sign = denominator < 0 ? -1 : 1;
  const divisor = gcd(numerator, denominator);
  const n = (numerator / divisor) * sign;
  const d = Math.abs(denominator / divisor);
  if (
    Math.abs(n) > FRACTION_LIMITS.maxAbsoluteNumerator ||
    d > FRACTION_LIMITS.maxDenominator
  ) {
    throw new FractionError("INPUT_FRACTION_LIMIT_EXCEEDED", "fraction exceeds canonical storage limits");
  }
  return Object.freeze({ n: n === 0 ? 0 : n, d });
}

export function isFraction(value: unknown): value is Fraction {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Readonly<Record<string, unknown>>;
  if (typeof record.n !== "number" || typeof record.d !== "number") return false;
  try {
    const normalized = fraction(record.n, record.d);
    return normalized.n === record.n && normalized.d === record.d;
  } catch {
    return false;
  }
}

function checkedOperation(n: number, d: number): Fraction {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d)) {
    throw new FractionError("INPUT_FRACTION_LIMIT_EXCEEDED", "fraction operation overflowed safe integers");
  }
  const result = fraction(n, d);
  if (Math.abs(result.n) > FRACTION_LIMITS.maxOperationAbsoluteNumerator) {
    throw new FractionError("INPUT_FRACTION_LIMIT_EXCEEDED", "fraction operation exceeds runtime limit");
  }
  return result;
}

export function addFractions(left: Fraction, right: Fraction): Fraction {
  const divisor = gcd(left.d, right.d);
  return checkedOperation(
    left.n * (right.d / divisor) + right.n * (left.d / divisor),
    (left.d / divisor) * right.d,
  );
}

export function subtractFractions(left: Fraction, right: Fraction): Fraction {
  return addFractions(left, fraction(-right.n, right.d));
}

export function multiplyFractions(left: Fraction, right: Fraction): Fraction {
  const crossLeft = gcd(left.n, right.d);
  const crossRight = gcd(right.n, left.d);
  return checkedOperation(
    (left.n / crossLeft) * (right.n / crossRight),
    (left.d / crossRight) * (right.d / crossLeft),
  );
}

export function divideFractions(left: Fraction, right: Fraction): Fraction {
  if (right.n === 0) {
    throw new FractionError("INPUT_INVALID_FRACTION", "cannot divide by zero");
  }
  return multiplyFractions(left, fraction(right.d, right.n));
}

export function compareFractions(left: Fraction, right: Fraction): -1 | 0 | 1 {
  const divisor = gcd(left.d, right.d);
  const leftScaled = left.n * (right.d / divisor);
  const rightScaled = right.n * (left.d / divisor);
  if (!Number.isSafeInteger(leftScaled) || !Number.isSafeInteger(rightScaled)) {
    throw new FractionError("INPUT_FRACTION_LIMIT_EXCEEDED", "fraction comparison overflowed safe integers");
  }
  return leftScaled < rightScaled ? -1 : leftScaled > rightScaled ? 1 : 0;
}

export const equalFractions = (left: Fraction, right: Fraction): boolean =>
  left.n === right.n && left.d === right.d;

export const isPositiveFraction = (value: Fraction): boolean => value.n > 0;
export const isNonNegativeFraction = (value: Fraction): boolean => value.n >= 0;

/** Canonical time unit: one whole unit is one quarter note. */
export const QUARTER_NOTE = fraction(1);

