import {
  addFractions,
  compareFractions,
  divideFractions,
  fraction,
  subtractFractions,
  type Fraction,
} from "../../domain/fraction";
import { durationRate, type DurationRateMetric } from "../../domain/rates";
import { containsPitch, pitchMidiNumber, type PitchRange, type SpelledPitch, type Step } from "../../domain/pitch";
import type {
  IndependentHarmonyRun,
  RelationBucket,
  ResearchArrangement,
  ResearchDiagnostics,
  ResearchNoteEvent,
} from "./types";

export const POST_RC7_METRIC_DEFINITIONS = {
  leadSoundingDuration: "Union of intervals where the canonical Lead has an actual sounding pitch.",
  harmonyParticipation: "Actual H1 sounding duration / Lead sounding duration.",
  actualUnison: "Duration with Lead and H1 sounding the same MIDI pitch / Lead sounding duration.",
  harmonicDivergence: "Duration with Lead and H1 both sounding different MIDI pitches / Lead sounding duration.",
  independentHarmony: "For the one-H1 experiment, identical to harmonic divergence; rests and exact unisons do not count.",
  exactlyTwoDistinctPitches: "Duration where the actual sounding pitch set has cardinality two / Lead sounding duration.",
  thirdClassCoverage: "Actual H1 sounding duration at generic third class (3rd, 10th, etc.) / actual H1 sounding duration.",
  sixthClassCoverage: "Actual H1 sounding duration at generic sixth class (6th, 13th, etc.) / actual H1 sounding duration.",
  unisonClassCoverage: "Actual H1 sounding duration at generic unison class (unison, octave, etc.) / actual H1 sounding duration.",
  otherIntervalCoverage: "Actual H1 sounding duration in all other generic interval classes / actual H1 sounding duration.",
  comfortableRangeMiss: "H1 sounding duration outside comfortable range / H1 sounding duration.",
  preferredTessituraMiss: "H1 sounding duration outside preferred tessitura / H1 sounding duration.",
  oneAttackRunCount: "Independent actual-pitch runs containing exactly one H1 attack.",
  orphanAttackCount: "H1 attacks that do not overlap any independent actual-pitch run.",
} as const;

const ZERO = fraction(0);
const STEP_INDEX: Readonly<Record<Step, number>> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

function endOf(event: ResearchNoteEvent): Fraction {
  return addFractions(event.onsetQ, event.durationQ);
}

function eventAt(events: readonly ResearchNoteEvent[], at: Fraction): ResearchNoteEvent | undefined {
  return events.find((event) => compareFractions(event.onsetQ, at) <= 0 && compareFractions(at, endOf(event)) < 0);
}

function uniqueSortedBoundaries(events: readonly ResearchNoteEvent[]): readonly Fraction[] {
  const values = events.flatMap((event) => [event.onsetQ, endOf(event)]);
  return values
    .filter((value, index) => values.findIndex((candidate) => candidate.n === value.n && candidate.d === value.d) === index)
    .sort(compareFractions);
}

function genericIntervalNumber(lead: SpelledPitch, harmony: SpelledPitch): number {
  const leadOrdinal = lead.octave * 7 + STEP_INDEX[lead.step];
  const harmonyOrdinal = harmony.octave * 7 + STEP_INDEX[harmony.step];
  return Math.abs(harmonyOrdinal - leadOrdinal) + 1;
}

function genericDirectedRelation(lead: SpelledPitch, harmony: SpelledPitch): string {
  const leadOrdinal = lead.octave * 7 + STEP_INDEX[lead.step];
  const harmonyOrdinal = harmony.octave * 7 + STEP_INDEX[harmony.step];
  const directedSteps = harmonyOrdinal - leadOrdinal;
  const number = Math.abs(directedSteps) + 1;
  return `${directedSteps < 0 ? "LOWER" : directedSteps > 0 ? "UPPER" : "UNISON"}_${number}`;
}

function intervalClass(number: number): number {
  return ((number - 1) % 7) + 1;
}

function overlaps(left: { readonly onsetQ: Fraction; readonly durationQ: Fraction }, right: { readonly onsetQ: Fraction; readonly durationQ: Fraction }): boolean {
  return compareFractions(left.onsetQ, addFractions(right.onsetQ, right.durationQ)) < 0
    && compareFractions(right.onsetQ, addFractions(left.onsetQ, left.durationQ)) < 0;
}

export interface ResearchMetrics {
  readonly leadSoundingDurationQ: Fraction;
  readonly harmonyParticipation: DurationRateMetric;
  readonly actualUnison: DurationRateMetric;
  readonly harmonicDivergence: DurationRateMetric;
  readonly independentHarmony: DurationRateMetric;
  readonly exactlyTwoDistinctPitches: DurationRateMetric;
  readonly oneAttackRunCount: number;
  readonly orphanAttackCount: number;
  readonly thirdClassCoverage: DurationRateMetric;
  readonly sixthClassCoverage: DurationRateMetric;
  readonly unisonClassCoverage: DurationRateMetric;
  readonly otherIntervalCoverage: DurationRateMetric;
  readonly comfortableRangeMissCoverage: DurationRateMetric;
  readonly preferredTessituraMissCoverage: DurationRateMetric;
  readonly thirdClassCoverageBp: DurationRateMetric["valueBp"];
  readonly sixthClassCoverageBp: DurationRateMetric["valueBp"];
  readonly unisonClassCoverageBp: DurationRateMetric["valueBp"];
  readonly otherIntervalCoverageBp: DurationRateMetric["valueBp"];
  readonly comfortableRangeMissCoverageBp: DurationRateMetric["valueBp"];
  readonly preferredTessituraMissCoverageBp: DurationRateMetric["valueBp"];
  readonly independentRuns: readonly IndependentHarmonyRun[];
  readonly meanIndependentRunDurationQ: Fraction | null;
  readonly relationDurations: readonly RelationBucket[];
  readonly diagnostics: ResearchDiagnostics;
}

export interface MetricRanges {
  readonly hard: PitchRange;
  readonly comfortable: PitchRange;
  readonly preferred?: PitchRange;
  readonly preferredLeapSemitones: number;
  readonly hardLeapSemitones: number;
}

export function measureArrangement(arrangement: ResearchArrangement, ranges: MetricRanges): ResearchMetrics {
  const boundaries = uniqueSortedBoundaries([...arrangement.lead, ...arrangement.harmony]);
  let leadDuration = ZERO;
  let participation = ZERO;
  let unison = ZERO;
  let divergent = ZERO;
  let exactlyTwo = ZERO;
  let thirdClass = ZERO;
  let sixthClass = ZERO;
  let unisonClass = ZERO;
  let otherClass = ZERO;
  let comfortableMiss = ZERO;
  let preferredMiss = ZERO;
  const relations = new Map<string, Fraction>();
  const runs: IndependentHarmonyRun[] = [];
  let openRun: { onsetQ: Fraction; durationQ: Fraction } | undefined;

  for (let index = 0; index + 1 < boundaries.length; index += 1) {
    const onsetQ = boundaries[index];
    const durationQ = subtractFractions(boundaries[index + 1], onsetQ);
    const lead = eventAt(arrangement.lead, onsetQ);
    const harmony = eventAt(arrangement.harmony, onsetQ);
    if (!lead) continue;
    leadDuration = addFractions(leadDuration, durationQ);
    if (!harmony) {
      if (openRun) { runs.push(openRun); openRun = undefined; }
      continue;
    }

    participation = addFractions(participation, durationQ);
    if (!containsPitch(ranges.comfortable, harmony.pitch)) comfortableMiss = addFractions(comfortableMiss, durationQ);
    if (ranges.preferred && !containsPitch(ranges.preferred, harmony.pitch)) preferredMiss = addFractions(preferredMiss, durationQ);

    const genericClass = intervalClass(genericIntervalNumber(lead.pitch, harmony.pitch));
    if (genericClass === 3) thirdClass = addFractions(thirdClass, durationQ);
    else if (genericClass === 6) sixthClass = addFractions(sixthClass, durationQ);
    else if (genericClass === 1) unisonClass = addFractions(unisonClass, durationQ);
    else otherClass = addFractions(otherClass, durationQ);

    const same = pitchMidiNumber(lead.pitch) === pitchMidiNumber(harmony.pitch);
    if (same) {
      unison = addFractions(unison, durationQ);
      if (openRun) { runs.push(openRun); openRun = undefined; }
    } else {
      divergent = addFractions(divergent, durationQ);
      exactlyTwo = addFractions(exactlyTwo, durationQ);
      if (openRun && compareFractions(addFractions(openRun.onsetQ, openRun.durationQ), onsetQ) === 0) {
        openRun.durationQ = addFractions(openRun.durationQ, durationQ);
      } else {
        if (openRun) runs.push(openRun);
        openRun = { onsetQ, durationQ };
      }
      const relation = genericDirectedRelation(lead.pitch, harmony.pitch);
      relations.set(relation, addFractions(relations.get(relation) ?? ZERO, durationQ));
    }
  }
  if (openRun) runs.push(openRun);

  let hardRangeFailures = 0;
  let comfortableRangeMisses = 0;
  let preferredTessituraMisses = 0;
  let preferredLeapFailures = 0;
  let hardLeapFailures = 0;
  let maxLeap: number | null = null;
  for (let index = 0; index < arrangement.harmony.length; index += 1) {
    const current = arrangement.harmony[index];
    if (!containsPitch(ranges.hard, current.pitch)) hardRangeFailures += 1;
    if (!containsPitch(ranges.comfortable, current.pitch)) comfortableRangeMisses += 1;
    if (ranges.preferred && !containsPitch(ranges.preferred, current.pitch)) preferredTessituraMisses += 1;
    if (index === 0) continue;
    const leap = Math.abs(pitchMidiNumber(current.pitch) - pitchMidiNumber(arrangement.harmony[index - 1].pitch));
    maxLeap = Math.max(maxLeap ?? 0, leap);
    if (leap > ranges.preferredLeapSemitones) preferredLeapFailures += 1;
    if (leap > ranges.hardLeapSemitones) hardLeapFailures += 1;
  }

  const attacks = arrangement.harmony.filter((event) => event.attack);
  const oneAttackRunCount = runs.filter((run) => attacks.filter((event) => overlaps(event, run)).length === 1).length;
  const orphanAttackCount = attacks.filter((event) => !runs.some((run) => overlaps(event, run))).length;
  const totalRunDuration = runs.reduce((sum, run) => addFractions(sum, run.durationQ), ZERO);
  const thirdClassCoverage = durationRate(thirdClass, participation);
  const sixthClassCoverage = durationRate(sixthClass, participation);
  const unisonClassCoverage = durationRate(unisonClass, participation);
  const otherIntervalCoverage = durationRate(otherClass, participation);
  const comfortableRangeMissCoverage = durationRate(comfortableMiss, participation);
  const preferredTessituraMissCoverage = durationRate(preferredMiss, ranges.preferred ? participation : ZERO);

  return {
    leadSoundingDurationQ: leadDuration,
    harmonyParticipation: durationRate(participation, leadDuration),
    actualUnison: durationRate(unison, leadDuration),
    harmonicDivergence: durationRate(divergent, leadDuration),
    independentHarmony: durationRate(divergent, leadDuration),
    exactlyTwoDistinctPitches: durationRate(exactlyTwo, leadDuration),
    oneAttackRunCount,
    orphanAttackCount,
    thirdClassCoverage,
    sixthClassCoverage,
    unisonClassCoverage,
    otherIntervalCoverage,
    comfortableRangeMissCoverage,
    preferredTessituraMissCoverage,
    thirdClassCoverageBp: thirdClassCoverage.valueBp,
    sixthClassCoverageBp: sixthClassCoverage.valueBp,
    unisonClassCoverageBp: unisonClassCoverage.valueBp,
    otherIntervalCoverageBp: otherIntervalCoverage.valueBp,
    comfortableRangeMissCoverageBp: comfortableRangeMissCoverage.valueBp,
    preferredTessituraMissCoverageBp: preferredTessituraMissCoverage.valueBp,
    independentRuns: runs,
    meanIndependentRunDurationQ: runs.length === 0 ? null : divideFractions(totalRunDuration, fraction(runs.length)),
    relationDurations: [...relations.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([relation, durationQ]) => ({ relation, durationQ })),
    diagnostics: {
      hardRangeFailures,
      comfortableRangeMisses,
      preferredTessituraMisses,
      preferredLeapFailures,
      hardLeapFailures,
      maxLeapSemitones: maxLeap,
    },
  };
}
