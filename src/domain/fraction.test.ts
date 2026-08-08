import { describe, expect, it } from "vitest";
import {
  QUARTER_NOTE, addFractions, compareFractions, divideFractions, equalFractions,
  fraction, multiplyFractions, subtractFractions,
} from "./fraction";
import { canonicalizePosition, musicalRange, positionWithinRange, splitEventAtMeasureBoundaries } from "./time";

describe("canonical Fraction and quarter-note time", () => {
  it("normalizes sign and gcd", () => {
    expect(fraction(2, -4)).toEqual({ n: -1, d: 2 });
    expect(fraction(0, -9)).toEqual({ n: 0, d: 1 });
    expect(QUARTER_NOTE).toEqual({ n: 1, d: 1 });
  });

  it("implements exact arithmetic and comparison", () => {
    expect(addFractions(fraction(1, 3), fraction(1, 6))).toEqual(fraction(1, 2));
    expect(subtractFractions(fraction(3, 4), fraction(1, 2))).toEqual(fraction(1, 4));
    expect(multiplyFractions(fraction(2, 3), fraction(9, 4))).toEqual(fraction(3, 2));
    expect(divideFractions(fraction(3, 2), fraction(9, 4))).toEqual(fraction(2, 3));
    expect(compareFractions(fraction(2, 4), fraction(1, 2))).toBe(0);
    expect(equalFractions(fraction(2, 4), fraction(1, 2))).toBe(true);
  });

  it("rejects invalid and unsafe fractions", () => {
    expect(() => fraction(1, 0)).toThrow("denominator");
    expect(() => fraction(Number.MAX_SAFE_INTEGER + 1, 1)).toThrow("safe integer");
    expect(() => fraction(10_000_001, 1)).toThrow("storage limits");
  });

  it("canonicalizes an exact measure boundary to the next occurrence", () => {
    expect(canonicalizePosition({ performanceMeasureIndex: 0, offset: fraction(4) }, [fraction(4), fraction(4)])).toEqual({
      performanceMeasureIndex: 1,
      offset: fraction(0),
    });
  });

  it("enforces half-open, non-empty ranges", () => {
    const range = musicalRange(
      { performanceMeasureIndex: 0, offset: fraction(0) },
      { performanceMeasureIndex: 0, offset: fraction(2) },
    );
    expect(positionWithinRange({ performanceMeasureIndex: 0, offset: fraction(0) }, range)).toBe(true);
    expect(positionWithinRange({ performanceMeasureIndex: 0, offset: fraction(2) }, range)).toBe(false);
    expect(() => musicalRange(range.start, range.start)).toThrow("non-empty");
  });

  it("splits a cross-boundary event and supplies tie semantics", () => {
    const segments = splitEventAtMeasureBoundaries(
      { performanceMeasureIndex: 0, offset: fraction(3) },
      fraction(2),
      [fraction(4), fraction(4)],
    );
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ tieStart: true, tieStop: false });
    expect(segments[1]).toMatchObject({ tieStart: false, tieStop: true });
  });
});
