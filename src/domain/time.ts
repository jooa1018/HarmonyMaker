import {
  addFractions,
  compareFractions,
  equalFractions,
  fraction,
  isNonNegativeFraction,
  isPositiveFraction,
  subtractFractions,
  type Fraction,
} from "./fraction";

export interface MusicalPosition {
  readonly performanceMeasureIndex: number;
  readonly offset: Fraction;
}

export interface MusicalRange {
  readonly start: MusicalPosition;
  readonly end: MusicalPosition;
}

export interface TimedEventSegment {
  readonly range: MusicalRange;
  readonly tieStart: boolean;
  readonly tieStop: boolean;
}

export function comparePositions(left: MusicalPosition, right: MusicalPosition): -1 | 0 | 1 {
  if (left.performanceMeasureIndex !== right.performanceMeasureIndex) {
    return left.performanceMeasureIndex < right.performanceMeasureIndex ? -1 : 1;
  }
  return compareFractions(left.offset, right.offset);
}

export function canonicalizePosition(
  position: MusicalPosition,
  measureDurations: readonly Fraction[],
): MusicalPosition {
  const index = position.performanceMeasureIndex;
  if (!Number.isSafeInteger(index) || index < 0 || index > measureDurations.length) {
    throw new RangeError("performance measure index is outside the sequence");
  }
  if (!isNonNegativeFraction(position.offset)) throw new RangeError("position offset cannot be negative");
  if (index === measureDurations.length) {
    if (!equalFractions(position.offset, fraction(0))) throw new RangeError("final position offset must be zero");
    return { performanceMeasureIndex: index, offset: fraction(0) };
  }
  const duration = measureDurations[index];
  const relation = compareFractions(position.offset, duration);
  if (relation > 0) throw new RangeError("position offset exceeds its measure");
  return relation === 0
    ? { performanceMeasureIndex: index + 1, offset: fraction(0) }
    : { performanceMeasureIndex: index, offset: position.offset };
}

export function musicalRange(
  start: MusicalPosition,
  end: MusicalPosition,
  measureDurations?: readonly Fraction[],
): MusicalRange {
  const canonicalStart = measureDurations ? canonicalizePosition(start, measureDurations) : start;
  const canonicalEnd = measureDurations ? canonicalizePosition(end, measureDurations) : end;
  if (comparePositions(canonicalStart, canonicalEnd) >= 0) {
    throw new RangeError("musical range must be a non-empty [start,end) interval");
  }
  return { start: canonicalStart, end: canonicalEnd };
}

export function positionWithinRange(position: MusicalPosition, range: MusicalRange): boolean {
  return comparePositions(position, range.start) >= 0 && comparePositions(position, range.end) < 0;
}

export function splitEventAtMeasureBoundaries(
  start: MusicalPosition,
  duration: Fraction,
  measureDurations: readonly Fraction[],
): readonly TimedEventSegment[] {
  if (!isPositiveFraction(duration)) throw new RangeError("event duration must be positive");
  let cursor = canonicalizePosition(start, measureDurations);
  let remaining = duration;
  const segments: TimedEventSegment[] = [];
  while (remaining.n > 0) {
    if (cursor.performanceMeasureIndex >= measureDurations.length) {
      throw new RangeError("event extends beyond performance sequence");
    }
    const available = subtractFractions(
      measureDurations[cursor.performanceMeasureIndex],
      cursor.offset,
    );
    const segmentDuration = compareFractions(remaining, available) <= 0 ? remaining : available;
    const rawEnd: MusicalPosition = {
      performanceMeasureIndex: cursor.performanceMeasureIndex,
      offset: addFractions(cursor.offset, segmentDuration),
    };
    const end = canonicalizePosition(rawEnd, measureDurations);
    const isFirst = segments.length === 0;
    const hasMore = compareFractions(remaining, segmentDuration) > 0;
    segments.push({ range: musicalRange(cursor, end), tieStart: hasMore, tieStop: !isFirst });
    remaining = subtractFractions(remaining, segmentDuration);
    cursor = end;
  }
  return segments;
}

export function compareRanges(left: MusicalRange, right: MusicalRange): -1 | 0 | 1 {
  const start = comparePositions(left.start, right.start);
  return start === 0 ? comparePositions(left.end, right.end) : start;
}

