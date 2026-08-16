import { addFractions, fraction, subtractFractions, type Fraction } from "../domain/fraction";
import type { PerformanceMeasureOccurrence } from "../domain/performance/repeat";
import type { MusicalPosition, MusicalRange } from "../domain/time";

export function absoluteQuarter(measures: readonly PerformanceMeasureOccurrence[], position: MusicalPosition): Fraction {
  let result = fraction(0);
  for (let index = 0; index < position.performanceMeasureIndex; index += 1) result = addFractions(result, measures[index].duration);
  return addFractions(result, position.offset);
}

export function canonicalRangeDuration(measures: readonly PerformanceMeasureOccurrence[], range: MusicalRange): Fraction {
  return subtractFractions(absoluteQuarter(measures, range.end), absoluteQuarter(measures, range.start));
}
