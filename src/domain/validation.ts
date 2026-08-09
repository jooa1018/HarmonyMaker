import { isSha256LowerHex } from "./digest/canonical";
import { isFraction, type Fraction } from "./fraction";
import {
  comparePitches, isKeySignature, isSpelledPitch,
  type KeySignature, type PitchRange, type SpelledPitch,
} from "./pitch";
import { isTimeSignature, type TimeSignature } from "./meter";
import type { MusicalPosition, MusicalRange } from "./time";

export type UnknownRecord = Readonly<Record<string, unknown>>;

export function isPlainRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function hasExactKeys(
  value: UnknownRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => allowed.has(key));
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isCanonicalId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value === value.normalize("NFC")
    && !/\s/u.test(value)
    && /^[A-Za-z0-9][A-Za-z0-9:._/-]*$/u.test(value);
}

export function isSemanticDigest(value: unknown): value is string {
  return isSha256LowerHex(value);
}

export function isCanonicalFraction(value: unknown): value is Fraction {
  return isFraction(value) && isPlainRecord(value) && hasExactKeys(value, ["n", "d"]);
}

export function isCanonicalSpelledPitch(value: unknown): value is SpelledPitch {
  return isSpelledPitch(value) && isPlainRecord(value)
    && hasExactKeys(value, ["step", "alter", "octave"]);
}

export function isCanonicalKeySignature(value: unknown): value is KeySignature {
  if (!isKeySignature(value) || !isPlainRecord(value) || !hasExactKeys(value, ["tonic", "mode"])) return false;
  return isPlainRecord(value.tonic) && hasExactKeys(value.tonic, ["step", "alter"]);
}

export function isCanonicalPitchRange(value: unknown): value is PitchRange {
  return isPlainRecord(value)
    && hasExactKeys(value, ["low", "high"])
    && isCanonicalSpelledPitch(value.low)
    && isCanonicalSpelledPitch(value.high)
    && comparePitches(value.low, value.high) <= 0;
}

export function isCanonicalTimeSignature(value: unknown): value is TimeSignature {
  return isTimeSignature(value) && isPlainRecord(value)
    && hasExactKeys(value, ["numerator", "denominator", "beatGroups"]);
}

export function isMusicalPosition(value: unknown): value is MusicalPosition {
  return isPlainRecord(value)
    && hasExactKeys(value, ["performanceMeasureIndex", "offset"])
    && Number.isSafeInteger(value.performanceMeasureIndex)
    && (value.performanceMeasureIndex as number) >= 0
    && isCanonicalFraction(value.offset)
    && value.offset.n >= 0;
}

export function isMusicalRange(value: unknown): value is MusicalRange {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["start", "end"])) return false;
  if (!isMusicalPosition(value.start) || !isMusicalPosition(value.end)) return false;
  const start = value.start;
  const end = value.end;
  if (start.performanceMeasureIndex !== end.performanceMeasureIndex) {
    return start.performanceMeasureIndex < end.performanceMeasureIndex;
  }
  return start.offset.n * end.offset.d < end.offset.n * start.offset.d;
}

export function hasUniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}
