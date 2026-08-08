import { divideFractions, fraction, isNonNegativeFraction, type Fraction } from "./fraction";

export type BasisPoints = number & { readonly __brand: "BasisPoints" };
export type ExtendedBasisPoints = number & { readonly __brand: "ExtendedBasisPoints" };
export type CostUnit = number & { readonly __brand: "CostUnit" };

function nonNegativeSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`);
  return value;
}
export function basisPoints(value: number): BasisPoints {
  nonNegativeSafeInteger(value, "BasisPoints");
  if (value > 10_000) throw new RangeError("BasisPoints cannot exceed 10000");
  return value as BasisPoints;
}
export function extendedBasisPoints(value: number): ExtendedBasisPoints {
  return nonNegativeSafeInteger(value, "ExtendedBasisPoints") as ExtendedBasisPoints;
}
export function costUnit(value: number): CostUnit {
  return nonNegativeSafeInteger(value, "CostUnit") as CostUnit;
}
function roundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((numerator * 10_000 + Math.floor(denominator / 2)) / denominator);
}
export interface CountRateMetric { readonly numerator: number; readonly denominator: number; readonly valueBp: BasisPoints | null; readonly unavailableReason?: "NO_EVALUABLE_ITEMS" }
export interface ExtendedCountRateMetric { readonly numerator: number; readonly denominator: number; readonly valueBp: ExtendedBasisPoints | null; readonly unavailableReason?: "NO_EVALUABLE_ITEMS" }
export interface DurationRateMetric { readonly numerator: Fraction; readonly denominator: Fraction; readonly valueBp: BasisPoints | null; readonly unavailableReason?: "NO_EVALUABLE_ITEMS" }

export function countRate(numerator: number, denominator: number): CountRateMetric {
  nonNegativeSafeInteger(numerator, "numerator"); nonNegativeSafeInteger(denominator, "denominator");
  if (numerator > denominator) throw new RangeError("bounded count rate numerator cannot exceed denominator");
  return denominator === 0
    ? { numerator, denominator, valueBp: null, unavailableReason: "NO_EVALUABLE_ITEMS" }
    : { numerator, denominator, valueBp: basisPoints(roundHalfUp(numerator, denominator)) };
}
export function extendedCountRate(numerator: number, denominator: number): ExtendedCountRateMetric {
  nonNegativeSafeInteger(numerator, "numerator"); nonNegativeSafeInteger(denominator, "denominator");
  return denominator === 0
    ? { numerator, denominator, valueBp: null, unavailableReason: "NO_EVALUABLE_ITEMS" }
    : { numerator, denominator, valueBp: extendedBasisPoints(roundHalfUp(numerator, denominator)) };
}
export function durationRate(numerator: Fraction, denominator: Fraction): DurationRateMetric {
  if (!isNonNegativeFraction(numerator) || !isNonNegativeFraction(denominator)) throw new RangeError("duration metric values must be non-negative");
  if (denominator.n === 0) return { numerator, denominator, valueBp: null, unavailableReason: "NO_EVALUABLE_ITEMS" };
  const ratio = divideFractions(numerator, denominator);
  if (ratio.n > ratio.d) throw new RangeError("bounded duration numerator cannot exceed denominator");
  return { numerator, denominator, valueBp: basisPoints(roundHalfUp(ratio.n, ratio.d)) };
}
export const ZERO_DURATION = fraction(0);

