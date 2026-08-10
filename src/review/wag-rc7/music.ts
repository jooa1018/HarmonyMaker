import type { ChordToneSpec, ParsedChord } from "../../domain/chord/model";
import {
  addFractions,
  compareFractions,
  divideFractions,
  fraction,
  multiplyFractions,
  subtractFractions,
  type Fraction,
} from "../../domain/fraction";
import type { PerformanceChordSpan } from "../../domain/harmony/chord-timeline";
import {
  containsPitch,
  pitchMidiNumber,
  type PitchRange,
  type SpelledPitch,
  type SpelledPitchClass,
  type Step,
} from "../../domain/pitch";
import {
  comparePositions,
  musicalRange,
  type MusicalPosition,
  type MusicalRange,
} from "../../domain/time";

const DEGREE_SEMITONES: Readonly<Record<number, number>> = {
  1: 0,
  2: 2,
  3: 4,
  4: 5,
  5: 7,
  6: 9,
  7: 11,
  9: 14,
  11: 17,
  13: 21,
};

const NATURAL_PC: Readonly<Record<Step, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const SHARP_SPELLINGS: readonly SpelledPitchClass[] = [
  { step: "C", alter: 0 },
  { step: "C", alter: 1 },
  { step: "D", alter: 0 },
  { step: "D", alter: 1 },
  { step: "E", alter: 0 },
  { step: "F", alter: 0 },
  { step: "F", alter: 1 },
  { step: "G", alter: 0 },
  { step: "G", alter: 1 },
  { step: "A", alter: 0 },
  { step: "A", alter: 1 },
  { step: "B", alter: 0 },
];

export function configFraction(value: { readonly n: number; readonly d: number }): Fraction {
  return fraction(value.n, value.d);
}

export function fractionToNumber(value: Fraction): number {
  return value.n / value.d;
}

export function fractionMin(left: Fraction, right: Fraction): Fraction {
  return compareFractions(left, right) <= 0 ? left : right;
}

export function fractionMax(left: Fraction, right: Fraction): Fraction {
  return compareFractions(left, right) >= 0 ? left : right;
}

export function roundHalfUpBasisPoints(numerator: Fraction, denominator: Fraction): number {
  if (numerator.n < 0 || denominator.n <= 0) throw new RangeError("invalid basis-point ratio");
  const ratio = divideFractions(numerator, denominator);
  return Math.floor((ratio.n * 20_000 + ratio.d) / (2 * ratio.d));
}

export function fractionCeil(value: Fraction): number {
  if (value.n < 0) throw new RangeError("fractionCeil requires a non-negative value");
  return Math.floor((value.n + value.d - 1) / value.d);
}

export function totalDuration(measureDurations: readonly Fraction[]): Fraction {
  return measureDurations.reduce((sum, value) => addFractions(sum, value), fraction(0));
}

export function positionToGlobalQ(
  position: MusicalPosition,
  measureDurations: readonly Fraction[],
): Fraction {
  if (!Number.isSafeInteger(position.performanceMeasureIndex)
    || position.performanceMeasureIndex < 0
    || position.performanceMeasureIndex > measureDurations.length) {
    throw new RangeError("position is outside the performance sequence");
  }
  let result = fraction(0);
  for (let index = 0; index < position.performanceMeasureIndex; index += 1) {
    result = addFractions(result, measureDurations[index]);
  }
  return addFractions(result, position.offset);
}

export function globalQToPosition(
  globalQ: Fraction,
  measureDurations: readonly Fraction[],
): MusicalPosition {
  if (globalQ.n < 0 || compareFractions(globalQ, totalDuration(measureDurations)) > 0) {
    throw new RangeError("global position is outside the performance sequence");
  }
  let remaining = globalQ;
  for (let index = 0; index < measureDurations.length; index += 1) {
    const relation = compareFractions(remaining, measureDurations[index]);
    if (relation < 0) return { performanceMeasureIndex: index, offset: remaining };
    if (relation === 0) return { performanceMeasureIndex: index + 1, offset: fraction(0) };
    remaining = subtractFractions(remaining, measureDurations[index]);
  }
  return { performanceMeasureIndex: measureDurations.length, offset: fraction(0) };
}

export function rangeDurationQ(range: MusicalRange, measureDurations: readonly Fraction[]): Fraction {
  return subtractFractions(
    positionToGlobalQ(range.end, measureDurations),
    positionToGlobalQ(range.start, measureDurations),
  );
}

export function rangeFromGlobalQ(
  start: Fraction,
  end: Fraction,
  measureDurations: readonly Fraction[],
): MusicalRange {
  return musicalRange(
    globalQToPosition(start, measureDurations),
    globalQToPosition(end, measureDurations),
    measureDurations,
  );
}

export function rangesOverlap(left: MusicalRange, right: MusicalRange): boolean {
  return comparePositions(left.start, right.end) < 0 && comparePositions(right.start, left.end) < 0;
}

export function positionInRange(position: MusicalPosition, range: MusicalRange): boolean {
  return comparePositions(position, range.start) >= 0 && comparePositions(position, range.end) < 0;
}

export function rootPitchClass(root: SpelledPitchClass): number {
  return ((NATURAL_PC[root.step] + root.alter) % 12 + 12) % 12;
}

export function chordTonePitchClass(chord: ParsedChord, tone: ChordToneSpec): number {
  const base = DEGREE_SEMITONES[tone.degree];
  if (base === undefined) throw new RangeError(`unsupported chord degree: ${tone.degree}`);
  return (rootPitchClass(chord.root) + base + tone.alteration) % 12;
}

export function pitchClass(pitch: SpelledPitch): number {
  return ((pitchMidiNumber(pitch) % 12) + 12) % 12;
}

export function midiToPitch(midi: number): SpelledPitch {
  if (!Number.isSafeInteger(midi) || midi < 0 || midi > 127) throw new RangeError("MIDI pitch is outside 0..127");
  const spelling = SHARP_SPELLINGS[midi % 12];
  return { ...spelling, octave: Math.floor(midi / 12) - 1 };
}

export function pitchesForToneInRange(
  chord: ParsedChord,
  tone: ChordToneSpec,
  range: PitchRange,
): readonly SpelledPitch[] {
  const targetPc = chordTonePitchClass(chord, tone);
  const low = pitchMidiNumber(range.low);
  const high = pitchMidiNumber(range.high);
  const result: SpelledPitch[] = [];
  for (let midi = low; midi <= high; midi += 1) {
    if (midi % 12 !== targetPc) continue;
    const pitch = midiToPitch(midi);
    if (containsPitch(range, pitch)) result.push(pitch);
  }
  return result;
}

export function chordSpanAt(
  position: MusicalPosition,
  spans: readonly PerformanceChordSpan[],
): PerformanceChordSpan | undefined {
  return spans.find((span) => positionInRange(position, span.range));
}

export function leadPitchAt(
  position: MusicalPosition,
  atoms: readonly { readonly range: MusicalRange; readonly pitch: SpelledPitch | null }[],
): SpelledPitch | null {
  return atoms.find((atom) => atom.pitch && positionInRange(position, atom.range))?.pitch ?? null;
}

export function toneForPitch(chord: ParsedChord, pitch: SpelledPitch): ChordToneSpec | undefined {
  const pc = pitchClass(pitch);
  return chord.tones.find((tone) => chordTonePitchClass(chord, tone) === pc);
}

export function intervalSemitones(left: SpelledPitch, right: SpelledPitch): number {
  return Math.abs(pitchMidiNumber(left) - pitchMidiNumber(right));
}

export function primaryPulseDuration(meterFamily: "simple-quadruple" | "compound-duple"): Fraction {
  return meterFamily === "simple-quadruple" ? fraction(1) : fraction(3, 2);
}

export function scaleFraction(value: Fraction, numerator: number, denominator = 1): Fraction {
  return multiplyFractions(value, fraction(numerator, denominator));
}

export function comparePositionsByGlobalQ(
  left: MusicalPosition,
  right: MusicalPosition,
  measureDurations: readonly Fraction[],
): -1 | 0 | 1 {
  return compareFractions(positionToGlobalQ(left, measureDurations), positionToGlobalQ(right, measureDurations));
}
