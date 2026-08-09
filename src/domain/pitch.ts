export type Step = "C" | "D" | "E" | "F" | "G" | "A" | "B";
export type Alter = -2 | -1 | 0 | 1 | 2;

export interface SpelledPitchClass {
  readonly step: Step;
  readonly alter: Alter;
}

export interface SpelledPitch extends SpelledPitchClass {
  readonly octave: number;
}

export interface PitchRange {
  readonly low: SpelledPitch;
  readonly high: SpelledPitch;
}

export type KeyMode = "major" | "minor";
export interface KeySignature {
  readonly tonic: SpelledPitchClass;
  readonly mode: KeyMode;
}

export function isSpelledPitchClass(value: unknown): value is SpelledPitchClass {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const pitch = value as Readonly<Record<string, unknown>>;
  return Object.keys(pitch).length === 2
    && ["C", "D", "E", "F", "G", "A", "B"].includes(String(pitch.step))
    && [-2, -1, 0, 1, 2].includes(pitch.alter as number);
}

export function isSpelledPitch(value: unknown): value is SpelledPitch {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const pitch = value as Readonly<Record<string, unknown>>;
  return Object.keys(pitch).length === 3
    && ["C", "D", "E", "F", "G", "A", "B"].includes(String(pitch.step))
    && [-2, -1, 0, 1, 2].includes(pitch.alter as number)
    && Number.isSafeInteger(pitch.octave);
}

export function isKeySignature(value: unknown): value is KeySignature {
  if (typeof value !== "object" || value === null) return false;
  const key = value as Readonly<Record<string, unknown>>;
  if (key.mode !== "major" && key.mode !== "minor") return false;
  if (!isSpelledPitchClass(key.tonic)) return false;
  const tonic = key.tonic;
  const typed: KeySignature = { tonic: { step: tonic.step as Step, alter: tonic.alter as Alter }, mode: key.mode };
  try { deriveFifths(typed); return true; } catch { return false; }
}

const NATURAL_SEMITONES: Readonly<Record<Step, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const NATURAL_FIFTHS: Readonly<Record<KeyMode, Readonly<Record<Step, number>>>> = {
  major: { C: 0, D: 2, E: 4, F: -1, G: 1, A: 3, B: 5 },
  minor: { C: -3, D: -1, E: 1, F: -4, G: -2, A: 0, B: 2 },
};

export function spelledPitchClass(step: Step, alter: Alter = 0): SpelledPitchClass {
  return { step, alter };
}

export function pitchMidiNumber(pitch: SpelledPitch): number {
  if (!Number.isSafeInteger(pitch.octave)) throw new RangeError("pitch octave must be an integer");
  return (pitch.octave + 1) * 12 + NATURAL_SEMITONES[pitch.step] + pitch.alter;
}

export function comparePitches(left: SpelledPitch, right: SpelledPitch): -1 | 0 | 1 {
  const leftMidi = pitchMidiNumber(left);
  const rightMidi = pitchMidiNumber(right);
  return leftMidi < rightMidi ? -1 : leftMidi > rightMidi ? 1 : 0;
}

export function pitchRange(low: SpelledPitch, high: SpelledPitch): PitchRange {
  if (comparePitches(low, high) > 0) throw new RangeError("pitch range low must not exceed high");
  return { low, high };
}

export function containsPitch(range: PitchRange, pitch: SpelledPitch): boolean {
  return comparePitches(range.low, pitch) <= 0 && comparePitches(pitch, range.high) <= 0;
}

export function containsRange(outer: PitchRange, inner: PitchRange): boolean {
  return containsPitch(outer, inner.low) && containsPitch(outer, inner.high);
}

export function deriveFifths(key: KeySignature): number {
  const fifths = NATURAL_FIFTHS[key.mode][key.tonic.step] + 7 * key.tonic.alter;
  if (!Number.isSafeInteger(fifths) || fifths < -7 || fifths > 7) {
    throw new RangeError("UNSUPPORTED_KEY_SIGNATURE");
  }
  return fifths;
}

export function validateImportedFifths(
  key: KeySignature,
  importedFifths: number,
): { readonly ok: true } | { readonly ok: false; readonly code: "INPUT_KEY_SIGNATURE_INCONSISTENT" } {
  return Number.isSafeInteger(importedFifths) && importedFifths === deriveFifths(key)
    ? { ok: true }
    : { ok: false, code: "INPUT_KEY_SIGNATURE_INCONSISTENT" };
}
