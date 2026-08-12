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
  independentHarmony: "For the one-H1 experiment, identical to harmonic divergence; rests and unisons do not count.",
  exactlyTwoDistinctPitches: "Duration where the actual sounding pitch set has cardinality two / Lead sounding duration.",
  comfortableRangeMiss: "H1 sounding duration outside comfortable range / H1 sounding duration.",
  preferredTessituraMiss: "H1 sounding duration outside preferred tessitura / H1 sounding duration.",
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

function genericDirectedRelation(lead: SpelledPitch, harmony: SpelledPitch): string {
  const leadOrdinal = lead.octave * 7 + STEP_INDEX[lead.step];
  const harmonyOrdinal = harmony.octave * 7 + STEP_INDEX[harmony.step];
  const directedSteps = harmonyOrdinal - leadOrdinal;
  const number = Math.abs(directedSteps) + 1;
  return `${directedSteps < 0 ? "LOWER" : directedSteps > 0 ? "UPPER" : "UNISON"}_${number}`;
}

export interface ResearchMetrics {
  readonly leadSoundingDurationQ: Fraction;
  readonly harmonyParticipation: DurationRateMetric;
  readonly actualUnison: DurationRateMetric;
  readonly harmonicDivergence: DurationRateMetric;
  readonly independentHarmony: DurationRateMetric;
  readonly exactlyTwoDistinctPitches: DurationRateMetric;
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
  let preferredLeapFailures = 0;
  let hardLeapFailures = 0;
  let maxLeap: number | null = null;
  for (let index = 0; index < arrangement.harmony.length; index += 1) {
    const current = arrangement.harmony[index];
    if (!containsPitch(ranges.hard, current.pitch)) hardRangeFailures += 1;
    if (index === 0) continue;
    const leap = Math.abs(pitchMidiNumber(current.pitch) - pitchMidiNumber(arrangement.harmony[index - 1].pitch));
    maxLeap = Math.max(maxLeap ?? 0, leap);
    if (leap > ranges.preferredLeapSemitones) preferredLeapFailures += 1;
    if (leap > ranges.hardLeapSemitones) hardLeapFailures += 1;
  }
  const totalRunDuration = runs.reduce((sum, run) => addFractions(sum, run.durationQ), ZERO);
  return {
    leadSoundingDurationQ: leadDuration,
    harmonyParticipation: durationRate(participation, leadDuration),
    actualUnison: durationRate(unison, leadDuration),
    harmonicDivergence: durationRate(divergent, leadDuration),
    independentHarmony: durationRate(divergent, leadDuration),
    exactlyTwoDistinctPitches: durationRate(exactlyTwo, leadDuration),
    independentRuns: runs,
    meanIndependentRunDurationQ: runs.length === 0 ? null : divideFractions(totalRunDuration, fraction(runs.length)),
    relationDurations: [...relations.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([relation, durationQ]) => ({ relation, durationQ })),
    diagnostics: {
      hardRangeFailures,
      comfortableRangeMisses: comfortableMiss.n === 0 ? 0 : 1,
      preferredTessituraMisses: preferredMiss.n === 0 ? 0 : 1,
      preferredLeapFailures,
      hardLeapFailures,
      maxLeapSemitones: maxLeap,
    },
  };
}
