export type BeatUnit = 4 | 8;

export interface TimeSignature {
  readonly numerator: number;
  readonly denominator: BeatUnit;
  readonly beatGroups: readonly number[];
}

export function timeSignature(
  numerator: number,
  denominator: BeatUnit,
  beatGroups: readonly number[],
): TimeSignature {
  if (!Number.isSafeInteger(numerator) || numerator <= 0 || (denominator !== 4 && denominator !== 8)) {
    throw new RangeError("UNSUPPORTED_METER");
  }
  if (
    beatGroups.length === 0 ||
    beatGroups.some((group) => !Number.isSafeInteger(group) || group <= 0) ||
    beatGroups.reduce((sum, group) => sum + group, 0) !== numerator
  ) {
    throw new RangeError("INPUT_BEAT_GROUPS_INVALID");
  }
  return { numerator, denominator, beatGroups: Object.freeze([...beatGroups]) };
}

export const COMMON_TIME = timeSignature(4, 4, [1, 1, 1, 1]);
export const COMPOUND_DUPLE = timeSignature(6, 8, [3, 3]);

export function isTimeSignature(value: unknown): value is TimeSignature {
  if (typeof value !== "object" || value === null) return false;
  const time = value as Readonly<Record<string, unknown>>;
  if (typeof time.numerator !== "number" || (time.denominator !== 4 && time.denominator !== 8) || !Array.isArray(time.beatGroups)) return false;
  try { timeSignature(time.numerator, time.denominator, time.beatGroups as readonly number[]); return true; } catch { return false; }
}
