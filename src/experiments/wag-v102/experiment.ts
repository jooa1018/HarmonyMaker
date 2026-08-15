import type { ParsedChord } from "../../domain/chord/model";
import { parseChord } from "../../domain/chord/parser";
import type { EffectiveArrangementConfig } from "../../domain/config";
import { semanticDigest, type SemanticDigest } from "../../domain/digest/canonical";
import type { PerformerProfile, VocalPlacementRole } from "../../domain/performer";
import { containsPitch, pitchMidiNumber, type SpelledPitch } from "../../domain/pitch";
import { extendedBasisPoints } from "../../domain/rates";
import type { MusicalRange } from "../../domain/time";
import {
  realizeSourceChordTone,
  selectLocalHarmonyDecision,
  type LocalHarmonyDecisionContext,
  type LocalSelectionConstraints,
  type LocalSelectionResult,
  type RankedLocalHarmonyCandidate,
} from "../../grammar/local-selection";

export const WAG_V102_EXPERIMENT_SCHEMA = "hm-wag-v102-selector-experiment-v1" as const;

export type SelectorExperimentVariant =
  | "V0_FROZEN"
  | "V1_HARD_ONLY_TESSITURA"
  | "V2_NEXT_FEASIBILITY"
  | "V3_REENTRY_DISTANCE"
  | "V4_HARD_ONLY_PLUS_NEXT"
  | "V5_HARD_ONLY_PLUS_NEXT_PLUS_REENTRY";

export const SELECTOR_EXPERIMENT_VARIANTS: readonly SelectorExperimentVariant[] = [
  "V0_FROZEN",
  "V1_HARD_ONLY_TESSITURA",
  "V2_NEXT_FEASIBILITY",
  "V3_REENTRY_DISTANCE",
  "V4_HARD_ONLY_PLUS_NEXT",
  "V5_HARD_ONLY_PLUS_NEXT_PLUS_REENTRY",
] as const;

export interface ExperimentDecisionInput {
  readonly id: string;
  readonly leadPitch: SpelledPitch;
  readonly chord: ParsedChord;
  readonly chordSpanId: string;
  readonly activity: "sounding" | "forced-rest";
  readonly constraints?: LocalSelectionConstraints;
}

export interface ExperimentSequenceFixture {
  readonly id: string;
  readonly title: string;
  readonly feature: "E1" | "E3" | "E4" | "NEUTRAL";
  readonly placementRole: VocalPlacementRole;
  readonly performer: PerformerProfile;
  readonly config: EffectiveArrangementConfig;
  readonly decisions: readonly ExperimentDecisionInput[];
  readonly tags: readonly string[];
}

export interface CandidateExperimentTrace {
  readonly toneKey: string;
  readonly pitch: SpelledPitch;
  readonly family: RankedLocalHarmonyCandidate["family"];
  readonly productionRankTuple: readonly number[];
  readonly experimentRankTuple: readonly number[];
  readonly hardOnlyRangeOrdinal: 0 | 1;
  readonly immediateDeadEndOrdinal: 0 | 1;
  readonly reentryDistanceSemitones: number;
}

export interface DecisionExperimentTrace {
  readonly decisionId: string;
  readonly decisionOrdinal: number;
  readonly variant: SelectorExperimentVariant;
  readonly placementRole: VocalPlacementRole;
  readonly leadPitch: SpelledPitch;
  readonly chordSpanId: string;
  readonly sourceChordSymbol: string;
  readonly continuityState: LocalHarmonyDecisionContext["continuityState"];
  readonly previousSoundingPitch: SpelledPitch | null;
  readonly lastSoundingPitchBeforeRest: SpelledPitch | null;
  readonly nextFeasibilityProbeApplicable: boolean;
  readonly productionStatus: LocalSelectionResult["status"] | "forced-rest";
  readonly selectedStatus: "note" | "rest" | "blocked";
  readonly selectedPitch: SpelledPitch | null;
  readonly reason: "LOCAL_REST_HARD_IMPOSSIBILITY" | "FORCED_ACTIVITY_REST" | "GEN_NO_PITCH_CANDIDATE" | null;
  readonly candidates: readonly CandidateExperimentTrace[];
}

export interface SequenceExperimentResult {
  readonly schema: typeof WAG_V102_EXPERIMENT_SCHEMA;
  readonly fixtureId: string;
  readonly variant: SelectorExperimentVariant;
  readonly traces: readonly DecisionExperimentTrace[];
  readonly selectedPitches: readonly (SpelledPitch | null)[];
  readonly semanticDigest: SemanticDigest;
  readonly metrics: ExperimentMetrics;
}

export interface ExperimentMetrics {
  readonly soundingDecisionCount: number;
  readonly restCount: number;
  readonly avoidableMidPhraseRestCount: number;
  readonly hardOnlyRangeDecisionCount: number;
  readonly comfortableRangeMissCount: number;
  readonly preferredTessituraMissCount: number;
  readonly maximumContinuousLeap: number;
  readonly preferredLeapExcessSemitoneSum: number;
  readonly reentryDistances: readonly number[];
  readonly maximumReentryDistance: number;
  readonly thirdOrSixthDecisionCount: number;
  readonly longestRepeatedDirectedThirdOrSixthRun: number;
  readonly hardRangeViolations: number;
  readonly hardLeapViolations: number;
  readonly placementViolations: number;
  readonly changedPositionsFromV0: readonly number[];
}

export interface ListeningComparisonSpec {
  readonly id: string;
  readonly feature: "E1" | "E3" | "E4" | "CUMULATIVE" | "NEUTRAL";
  readonly fixtureId: string;
  readonly baselineVariant: SelectorExperimentVariant;
  readonly challengerVariant: SelectorExperimentVariant;
  readonly reverseDuplicateOf?: string;
}

const DIGEST = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as SemanticDigest;
const NATURAL_PC: Readonly<Record<SpelledPitch["step"], number>> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};
const STEPS: readonly SpelledPitch["step"][] = ["C", "D", "E", "F", "G", "A", "B"];

export const pitch = (
  step: SpelledPitch["step"],
  octave: number,
  alter: SpelledPitch["alter"] = 0,
): SpelledPitch => ({ step, alter, octave });

function exactRange(index: number): MusicalRange {
  return {
    start: { performanceMeasureIndex: 0, offset: { n: index, d: 1 } },
    end: { performanceMeasureIndex: 0, offset: { n: index + 1, d: 1 } },
  };
}

function parsedChord(symbol: string): ParsedChord {
  const result = parseChord(symbol);
  if (result.status !== "ok") throw new Error(`EXPERIMENT_CHORD_PARSE_FAILED:${symbol}`);
  return result.chord;
}

function performer(
  id: string,
  hardLow: SpelledPitch,
  hardHigh: SpelledPitch,
  comfortableLow: SpelledPitch,
  comfortableHigh: SpelledPitch,
  preferredLow = comfortableLow,
  preferredHigh = comfortableHigh,
): PerformerProfile {
  return {
    id,
    displayName: id,
    hardRange: { low: hardLow, high: hardHigh },
    comfortableRange: { low: comfortableLow, high: comfortableHigh },
    preferredTessitura: { low: preferredLow, high: preferredHigh },
  };
}

function config(overrides: Partial<EffectiveArrangementConfig> = {}): EffectiveArrangementConfig {
  return {
    presetId: "standard",
    maxActiveVoiceCount: 3,
    maxHarmonyAttackRatioBp: extendedBasisPoints(20000),
    preferredMaxLeapSemitones: 5,
    hardMaxLeapSemitones: 12,
    allowSuspension: false,
    allowColorTones: true,
    allowOctaveDouble: false,
    rhythmicComplexity: 0,
    maxRoleChangesPerSection: 1,
    maxSustainPrimaryPulses: 4,
    mode: { profileId: "worship-band-v1", harmonicContext: "band-supported" },
    presetProfileVersion: "preset-profile-v2-b15-v0",
    presetProfileDigest: DIGEST,
    maxHarmonyTracks: 1,
    digest: DIGEST,
    ...overrides,
  };
}

function decision(id: string, leadPitch: SpelledPitch, chordSymbol: string): ExperimentDecisionInput {
  return { id, leadPitch, chord: parsedChord(chordSymbol), chordSpanId: `span:${id}`, activity: "sounding" };
}

function forcedRest(id: string, leadPitch: SpelledPitch, chordSymbol: string): ExperimentDecisionInput {
  return { id, leadPitch, chord: parsedChord(chordSymbol), chordSpanId: `span:${id}`, activity: "forced-rest" };
}

const E1_UPPER = performer("performer:e1-upper", pitch("E", 4), pitch("G", 4), pitch("G", 4), pitch("G", 4));
const E1_LOWER = performer("performer:e1-lower", pitch("E", 4), pitch("G", 4), pitch("G", 4), pitch("G", 4));
const WIDE_UPPER = performer("performer:wide-upper", pitch("C", 4), pitch("G", 5), pitch("C", 4), pitch("G", 5));
const WIDE_LOWER = performer("performer:wide-lower", pitch("C", 3), pitch("E", 5), pitch("C", 3), pitch("E", 5));

export const EXPERIMENT_FIXTURES: readonly ExperimentSequenceFixture[] = [
  {
    id: "hm-v102-e1-hard-only-upper-v0",
    title: "Hard-only upper third versus comfortable fifth",
    feature: "E1",
    placementRole: "upper",
    performer: E1_UPPER,
    config: config(),
    decisions: [decision("e1-u-0", pitch("C", 4), "C")],
    tags: ["major", "upper", "hard-only"],
  },
  {
    id: "hm-v102-e1-hard-only-lower-v0",
    title: "Hard-only lower sixth versus comfortable fourth",
    feature: "E1",
    placementRole: "lower",
    performer: E1_LOWER,
    config: config(),
    decisions: [decision("e1-l-0", pitch("C", 5), "C")],
    tags: ["major", "lower", "hard-only"],
  },
  {
    id: "hm-v102-e1-hard-only-upper-minor-v0",
    title: "Minor upper hard-only third",
    feature: "E1",
    placementRole: "upper",
    performer: performer("performer:e1-upper-minor", pitch("C", 5), pitch("E", 5), pitch("E", 5), pitch("E", 5)),
    config: config(),
    decisions: [decision("e1-um-0", pitch("A", 4), "Am")],
    tags: ["minor", "upper", "hard-only"],
  },
  {
    id: "hm-v102-e1-hard-only-lower-minor-v0",
    title: "Minor lower hard-only sixth",
    feature: "E1",
    placementRole: "lower",
    performer: performer("performer:e1-lower-minor", pitch("C", 4), pitch("E", 4), pitch("E", 4), pitch("E", 4)),
    config: config(),
    decisions: [decision("e1-lm-0", pitch("A", 4), "Am")],
    tags: ["minor", "lower", "hard-only"],
  },
  {
    id: "hm-v102-e3-dead-end-upper-v0",
    title: "Upper immediate dead-end",
    feature: "E3",
    placementRole: "upper",
    performer: WIDE_UPPER,
    config: config({ hardMaxLeapSemitones: 2, preferredMaxLeapSemitones: 2 }),
    decisions: [decision("e3-u-0", pitch("C", 4), "C"), decision("e3-u-1", pitch("F", 4), "C")],
    tags: ["major", "upper", "dead-end"],
  },
  {
    id: "hm-v102-e3-dead-end-lower-v0",
    title: "Lower immediate dead-end",
    feature: "E3",
    placementRole: "lower",
    performer: WIDE_LOWER,
    config: config({ hardMaxLeapSemitones: 2, preferredMaxLeapSemitones: 2 }),
    decisions: [decision("e3-l-0", pitch("G", 4), "C"), decision("e3-l-1", pitch("D", 4), "C")],
    tags: ["major", "lower", "dead-end"],
  },
  {
    id: "hm-v102-e3-dead-end-upper-minor-v0",
    title: "Minor upper immediate dead-end",
    feature: "E3",
    placementRole: "upper",
    performer: performer("performer:e3-upper-minor", pitch("A", 4), pitch("E", 5), pitch("A", 4), pitch("E", 5)),
    config: config({ hardMaxLeapSemitones: 2, preferredMaxLeapSemitones: 2 }),
    decisions: [decision("e3-um-0", pitch("A", 4), "Am"), decision("e3-um-1", pitch("D", 5), "Am")],
    tags: ["minor", "upper", "dead-end"],
  },
  {
    id: "hm-v102-e3-dead-end-lower-minor-v0",
    title: "Minor lower immediate dead-end",
    feature: "E3",
    placementRole: "lower",
    performer: performer("performer:e3-lower-minor", pitch("A", 4), pitch("C", 5), pitch("A", 4), pitch("C", 5)),
    config: config({ hardMaxLeapSemitones: 2, preferredMaxLeapSemitones: 2 }),
    decisions: [decision("e3-lm-0", pitch("E", 5), "Am"), decision("e3-lm-1", pitch("B", 4), "Am")],
    tags: ["minor", "lower", "dead-end"],
  },
  {
    id: "hm-v102-e4-reentry-upper-v0",
    title: "Upper re-entry distance",
    feature: "E4",
    placementRole: "upper",
    performer: WIDE_UPPER,
    config: config(),
    decisions: [
      decision("e4-u-0", pitch("F", 4), "Dm"),
      forcedRest("e4-u-rest", pitch("G", 4), "C"),
      decision("e4-u-2", pitch("C", 4), "Cadd6"),
    ],
    tags: ["major", "upper", "reentry"],
  },
  {
    id: "hm-v102-e4-reentry-lower-v0",
    title: "Lower re-entry distance",
    feature: "E4",
    placementRole: "lower",
    performer: WIDE_LOWER,
    config: config(),
    decisions: [
      decision("e4-l-0", pitch("C", 5), "F"),
      forcedRest("e4-l-rest", pitch("B", 4), "C"),
      decision("e4-l-2", pitch("C", 5), "Cadd6"),
    ],
    tags: ["major", "lower", "reentry"],
  },
  {
    id: "hm-v102-e4-reentry-upper-minor-v0",
    title: "Upper alternate-key re-entry distance",
    feature: "E4",
    placementRole: "upper",
    performer: WIDE_UPPER,
    config: config(),
    decisions: [
      decision("e4-um-0", pitch("C", 5), "Am"),
      forcedRest("e4-um-rest", pitch("D", 5), "G"),
      decision("e4-um-2", pitch("G", 4), "Gadd6"),
    ],
    tags: ["minor-context", "upper", "reentry"],
  },
  {
    id: "hm-v102-e4-reentry-lower-minor-v0",
    title: "Lower alternate-key re-entry distance",
    feature: "E4",
    placementRole: "lower",
    performer: WIDE_LOWER,
    config: config(),
    decisions: [
      decision("e4-lm-0", pitch("A", 4), "D"),
      forcedRest("e4-lm-rest", pitch("G", 4), "Am"),
      decision("e4-lm-2", pitch("A", 4), "Am6"),
    ],
    tags: ["minor", "lower", "reentry"],
  },
  {
    id: "hm-v102-neutral-upper-v0",
    title: "Upper neutral control",
    feature: "NEUTRAL",
    placementRole: "upper",
    performer: performer("performer:neutral-upper", pitch("E", 4), pitch("E", 4), pitch("E", 4), pitch("E", 4)),
    config: config(),
    decisions: [decision("neutral-u-0", pitch("C", 4), "C")],
    tags: ["neutral", "upper"],
  },
  {
    id: "hm-v102-neutral-lower-v0",
    title: "Lower neutral control",
    feature: "NEUTRAL",
    placementRole: "lower",
    performer: performer("performer:neutral-lower", pitch("E", 3), pitch("E", 3), pitch("E", 3), pitch("E", 3)),
    config: config(),
    decisions: [decision("neutral-l-0", pitch("C", 4), "C")],
    tags: ["neutral", "lower"],
  },
] as const;

export function fixtureById(id: string): ExperimentSequenceFixture {
  const fixture = EXPERIMENT_FIXTURES.find((item) => item.id === id);
  if (!fixture) throw new Error(`UNKNOWN_EXPERIMENT_FIXTURE:${id}`);
  return fixture;
}

function contextFor(
  fixture: ExperimentSequenceFixture,
  decisionInput: ExperimentDecisionInput,
  decisionOrdinal: number,
  previousSoundingPitch: SpelledPitch | undefined,
  continuityState: LocalHarmonyDecisionContext["continuityState"],
): LocalHarmonyDecisionContext {
  return {
    phraseId: `phrase:${fixture.id}`,
    trackPlanId: `track:${fixture.placementRole}`,
    placementRole: fixture.placementRole,
    sourceLeadAtomizationDigest: DIGEST,
    leadAtomId: `atom:${fixture.id}:${decisionOrdinal}`,
    exactRange: exactRange(decisionOrdinal),
    chordSpanId: decisionInput.chordSpanId,
    leadPitch: decisionInput.leadPitch,
    trigger: decisionOrdinal === 0 ? "LEAD_ATTACK" : "CANONICAL_CHORD_BOUNDARY",
    lyricOnset: decisionOrdinal === 0,
    ...(previousSoundingPitch ? { previousSoundingPitch } : {}),
    continuityState,
  };
}

function compareRank(left: readonly number[], right: readonly number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function hardOnlyRangeOrdinal(candidate: RankedLocalHarmonyCandidate, singer: PerformerProfile): 0 | 1 {
  return containsPitch(singer.comfortableRange, candidate.pitch) ? 0 : 1;
}

function toneKey(candidate: RankedLocalHarmonyCandidate): string {
  return `${candidate.tone.degree}:${candidate.tone.alteration}:${candidate.tone.role}:${candidate.tone.origin}`;
}

function variantFeatures(variant: SelectorExperimentVariant): {
  readonly e1: boolean;
  readonly e3: boolean;
  readonly e4: boolean;
} {
  return {
    e1: variant === "V1_HARD_ONLY_TESSITURA" || variant === "V4_HARD_ONLY_PLUS_NEXT" || variant === "V5_HARD_ONLY_PLUS_NEXT_PLUS_REENTRY",
    e3: variant === "V2_NEXT_FEASIBILITY" || variant === "V4_HARD_ONLY_PLUS_NEXT" || variant === "V5_HARD_ONLY_PLUS_NEXT_PLUS_REENTRY",
    e4: variant === "V3_REENTRY_DISTANCE" || variant === "V5_HARD_ONLY_PLUS_NEXT_PLUS_REENTRY",
  };
}

function e1Rank(
  candidate: RankedLocalHarmonyCandidate,
  leadIsSourceChordTone: boolean,
  singer: PerformerProfile,
): readonly number[] {
  const hardOnly = hardOnlyRangeOrdinal(candidate, singer);
  if (leadIsSourceChordTone) return [hardOnly, ...candidate.rankTuple];
  return [candidate.rankTuple[0], candidate.rankTuple[1], hardOnly, ...candidate.rankTuple.slice(2)];
}

function insertReentryDistance(
  rank: readonly number[],
  leadIsSourceChordTone: boolean,
  e1Enabled: boolean,
  distance: number,
): readonly number[] {
  const insertionIndex = leadIsSourceChordTone
    ? (e1Enabled ? 6 : 5)
    : (e1Enabled ? 8 : 7);
  return [...rank.slice(0, insertionIndex), distance, ...rank.slice(insertionIndex)];
}

function nextProbeApplicable(next: ExperimentDecisionInput | undefined): next is ExperimentDecisionInput {
  return next !== undefined && next.activity === "sounding";
}

function immediateDeadEnd(
  fixture: ExperimentSequenceFixture,
  candidate: RankedLocalHarmonyCandidate,
  next: ExperimentDecisionInput | undefined,
): 0 | 1 {
  if (!nextProbeApplicable(next)) return 0;
  const nextOrdinal = fixture.decisions.indexOf(next);
  const nextContext = contextFor(fixture, next, nextOrdinal, candidate.pitch, "continuous");
  const nextResult = selectLocalHarmonyDecision(
    nextContext,
    next.chord,
    fixture.performer,
    fixture.config,
    { ...(next.constraints ?? {}), restFallback: "permitted" },
  );
  return nextResult.status === "note" ? 0 : 1;
}

function experimentalRank(
  fixture: ExperimentSequenceFixture,
  variant: SelectorExperimentVariant,
  candidate: RankedLocalHarmonyCandidate,
  production: LocalSelectionResult,
  next: ExperimentDecisionInput | undefined,
  continuityState: LocalHarmonyDecisionContext["continuityState"],
  lastSoundingPitchBeforeRest: SpelledPitch | undefined,
): { readonly rank: readonly number[]; readonly hardOnly: 0 | 1; readonly deadEnd: 0 | 1; readonly reentryDistance: number } {
  const features = variantFeatures(variant);
  const hardOnly = hardOnlyRangeOrdinal(candidate, fixture.performer);
  const deadEnd = features.e3 ? immediateDeadEnd(fixture, candidate, next) : 0;
  const reentryDistance = features.e4 && continuityState === "reentry" && lastSoundingPitchBeforeRest
    ? Math.abs(pitchMidiNumber(candidate.pitch) - pitchMidiNumber(lastSoundingPitchBeforeRest))
    : 0;
  let rank = features.e1 ? e1Rank(candidate, production.leadIsSourceChordTone, fixture.performer) : candidate.rankTuple;
  if (features.e4) rank = insertReentryDistance(rank, production.leadIsSourceChordTone, features.e1, reentryDistance);
  if (features.e3) rank = [deadEnd, ...rank];
  return { rank, hardOnly, deadEnd, reentryDistance };
}

function rankCandidates(
  fixture: ExperimentSequenceFixture,
  variant: SelectorExperimentVariant,
  production: LocalSelectionResult,
  next: ExperimentDecisionInput | undefined,
  continuityState: LocalHarmonyDecisionContext["continuityState"],
  lastSoundingPitchBeforeRest: SpelledPitch | undefined,
): readonly CandidateExperimentTrace[] {
  return production.candidates.map((candidate) => {
    const extra = experimentalRank(
      fixture,
      variant,
      candidate,
      production,
      next,
      continuityState,
      lastSoundingPitchBeforeRest,
    );
    return {
      toneKey: toneKey(candidate),
      pitch: candidate.pitch,
      family: candidate.family,
      productionRankTuple: candidate.rankTuple,
      experimentRankTuple: extra.rank,
      hardOnlyRangeOrdinal: extra.hardOnly,
      immediateDeadEndOrdinal: extra.deadEnd,
      reentryDistanceSemitones: extra.reentryDistance,
    };
  }).sort((left, right) => compareRank(left.experimentRankTuple, right.experimentRankTuple));
}

function isThirdOrSixth(lead: SpelledPitch, harmony: SpelledPitch): boolean {
  const leadIndex = lead.octave * 7 + STEPS.indexOf(lead.step);
  const harmonyIndex = harmony.octave * 7 + STEPS.indexOf(harmony.step);
  const simple = (Math.abs(harmonyIndex - leadIndex) % 7) + 1;
  return simple === 3 || simple === 6;
}

function directedRelation(lead: SpelledPitch, harmony: SpelledPitch): string | null {
  if (!isThirdOrSixth(lead, harmony)) return null;
  return pitchMidiNumber(harmony) > pitchMidiNumber(lead) ? "UPPER_3_OR_6" : "LOWER_3_OR_6";
}

function sourceChordContains(chord: ParsedChord, selected: SpelledPitch): boolean {
  const selectedPc = ((pitchMidiNumber(selected) % 12) + 12) % 12;
  return chord.tones.some((tone) => {
    const realized = realizeSourceChordTone(chord.root, tone);
    if (!realized) return false;
    const pc = ((NATURAL_PC[realized.step] + realized.alter) % 12 + 12) % 12;
    return pc === selectedPc;
  });
}

function calculateMetrics(
  fixture: ExperimentSequenceFixture,
  traces: readonly DecisionExperimentTrace[],
  v0Pitches: readonly (SpelledPitch | null)[],
): ExperimentMetrics {
  let maximumContinuousLeap = 0;
  let preferredLeapExcessSemitoneSum = 0;
  let hardRangeViolations = 0;
  let hardLeapViolations = 0;
  let placementViolations = 0;
  let previous: SpelledPitch | undefined;
  let previousWasRest = false;
  let runRelation: string | null = null;
  let runLength = 0;
  let longestRun = 0;
  const reentryDistances: number[] = [];
  const changedPositionsFromV0: number[] = [];

  traces.forEach((trace, index) => {
    const selected = trace.selectedPitch;
    const baseline = v0Pitches[index];
    if (JSON.stringify(selected) !== JSON.stringify(baseline)) changedPositionsFromV0.push(index);
    if (!selected) {
      previousWasRest = previous !== undefined || previousWasRest;
      runRelation = null;
      runLength = 0;
      return;
    }
    if (!containsPitch(fixture.performer.hardRange, selected)) hardRangeViolations += 1;
    const leadMidi = pitchMidiNumber(trace.leadPitch);
    const selectedMidi = pitchMidiNumber(selected);
    if (fixture.placementRole === "upper" ? selectedMidi <= leadMidi : selectedMidi >= leadMidi) placementViolations += 1;
    if (previous) {
      const leap = Math.abs(selectedMidi - pitchMidiNumber(previous));
      if (previousWasRest) reentryDistances.push(leap);
      else {
        maximumContinuousLeap = Math.max(maximumContinuousLeap, leap);
        preferredLeapExcessSemitoneSum += Math.max(0, leap - fixture.config.preferredMaxLeapSemitones);
        if (leap > fixture.config.hardMaxLeapSemitones) hardLeapViolations += 1;
      }
    }
    const relation = directedRelation(trace.leadPitch, selected);
    if (relation && relation === runRelation) runLength += 1;
    else {
      runRelation = relation;
      runLength = relation ? 1 : 0;
    }
    longestRun = Math.max(longestRun, runLength);
    previous = selected;
    previousWasRest = false;
  });

  const selectedNotes = traces.filter((trace) => trace.selectedPitch !== null);
  const rests = traces.filter((trace) => trace.selectedStatus === "rest");
  return {
    soundingDecisionCount: selectedNotes.length,
    restCount: rests.length,
    avoidableMidPhraseRestCount: rests.filter((trace, index) => index > 0 && index < traces.length - 1 && trace.reason === "LOCAL_REST_HARD_IMPOSSIBILITY").length,
    hardOnlyRangeDecisionCount: selectedNotes.filter((trace) => trace.selectedPitch && !containsPitch(fixture.performer.comfortableRange, trace.selectedPitch)).length,
    comfortableRangeMissCount: selectedNotes.filter((trace) => trace.selectedPitch && !containsPitch(fixture.performer.comfortableRange, trace.selectedPitch)).length,
    preferredTessituraMissCount: selectedNotes.filter((trace) => trace.selectedPitch && fixture.performer.preferredTessitura && !containsPitch(fixture.performer.preferredTessitura, trace.selectedPitch)).length,
    maximumContinuousLeap,
    preferredLeapExcessSemitoneSum,
    reentryDistances,
    maximumReentryDistance: reentryDistances.length === 0 ? 0 : Math.max(...reentryDistances),
    thirdOrSixthDecisionCount: selectedNotes.filter((trace) => trace.selectedPitch && isThirdOrSixth(trace.leadPitch, trace.selectedPitch)).length,
    longestRepeatedDirectedThirdOrSixthRun: longestRun,
    hardRangeViolations,
    hardLeapViolations,
    placementViolations,
    changedPositionsFromV0,
  };
}

export async function runExperimentSequence(
  fixture: ExperimentSequenceFixture,
  variant: SelectorExperimentVariant,
  v0PitchesOverride?: readonly (SpelledPitch | null)[],
): Promise<SequenceExperimentResult> {
  const traces: DecisionExperimentTrace[] = [];
  let previousSoundingPitch: SpelledPitch | undefined;
  let lastSoundingPitchBeforeRest: SpelledPitch | undefined;
  let afterRest = false;

  for (let index = 0; index < fixture.decisions.length; index += 1) {
    const input = fixture.decisions[index];
    const next = fixture.decisions[index + 1];
    const continuityState: LocalHarmonyDecisionContext["continuityState"] = index === 0
      ? "initial"
      : afterRest
        ? "reentry"
        : "continuous";

    if (input.activity === "forced-rest") {
      if (previousSoundingPitch) lastSoundingPitchBeforeRest = previousSoundingPitch;
      traces.push({
        decisionId: input.id,
        decisionOrdinal: index,
        variant,
        placementRole: fixture.placementRole,
        leadPitch: input.leadPitch,
        chordSpanId: input.chordSpanId,
        sourceChordSymbol: input.chord.canonicalSymbol,
        continuityState,
        previousSoundingPitch: previousSoundingPitch ?? null,
        lastSoundingPitchBeforeRest: lastSoundingPitchBeforeRest ?? null,
        nextFeasibilityProbeApplicable: false,
        productionStatus: "forced-rest",
        selectedStatus: "rest",
        selectedPitch: null,
        reason: "FORCED_ACTIVITY_REST",
        candidates: [],
      });
      previousSoundingPitch = undefined;
      afterRest = true;
      continue;
    }

    const context = contextFor(fixture, input, index, previousSoundingPitch, continuityState);
    const production = selectLocalHarmonyDecision(
      context,
      input.chord,
      fixture.performer,
      fixture.config,
      input.constraints ?? { restFallback: "permitted" },
    );
    const candidates = rankCandidates(
      fixture,
      variant,
      production,
      next,
      continuityState,
      lastSoundingPitchBeforeRest,
    );
    const selected = candidates[0];
    const selectedStatus = selected ? "note" : production.status === "blocked" ? "blocked" : "rest";
    const selectedPitch = selected?.pitch ?? null;
    const reason = selected
      ? null
      : production.status === "blocked"
        ? "GEN_NO_PITCH_CANDIDATE"
        : "LOCAL_REST_HARD_IMPOSSIBILITY";

    traces.push({
      decisionId: input.id,
      decisionOrdinal: index,
      variant,
      placementRole: fixture.placementRole,
      leadPitch: input.leadPitch,
      chordSpanId: input.chordSpanId,
      sourceChordSymbol: input.chord.canonicalSymbol,
      continuityState,
      previousSoundingPitch: previousSoundingPitch ?? null,
      lastSoundingPitchBeforeRest: lastSoundingPitchBeforeRest ?? null,
      nextFeasibilityProbeApplicable: variantFeatures(variant).e3 && nextProbeApplicable(next),
      productionStatus: production.status,
      selectedStatus,
      selectedPitch,
      reason,
      candidates,
    });

    if (selectedPitch) {
      if (!sourceChordContains(input.chord, selectedPitch)) throw new Error(`EXPERIMENT_SOURCE_CHORD_VIOLATION:${fixture.id}:${index}`);
      previousSoundingPitch = selectedPitch;
      afterRest = false;
    } else {
      if (previousSoundingPitch) lastSoundingPitchBeforeRest = previousSoundingPitch;
      previousSoundingPitch = undefined;
      afterRest = true;
    }
  }

  const selectedPitches = traces.map((trace) => trace.selectedPitch);
  const v0Pitches = v0PitchesOverride ?? (variant === "V0_FROZEN"
    ? selectedPitches
    : (await runExperimentSequence(fixture, "V0_FROZEN")).selectedPitches);
  const metrics = calculateMetrics(fixture, traces, v0Pitches);
  const semanticExperimentDigest = await semanticDigest({
    schema: WAG_V102_EXPERIMENT_SCHEMA,
    fixtureId: fixture.id,
    variant,
    selectedPitches,
    reasons: traces.map((trace) => trace.reason),
  });
  return {
    schema: WAG_V102_EXPERIMENT_SCHEMA,
    fixtureId: fixture.id,
    variant,
    traces,
    selectedPitches,
    semanticDigest: semanticExperimentDigest,
    metrics,
  };
}

export async function runExperimentMatrix(): Promise<readonly SequenceExperimentResult[]> {
  const results: SequenceExperimentResult[] = [];
  for (const fixture of EXPERIMENT_FIXTURES) {
    const v0 = await runExperimentSequence(fixture, "V0_FROZEN");
    results.push(v0);
    for (const variant of SELECTOR_EXPERIMENT_VARIANTS.slice(1)) {
      results.push(await runExperimentSequence(fixture, variant, v0.selectedPitches));
    }
  }
  return results;
}

export const LISTENING_COMPARISONS: readonly ListeningComparisonSpec[] = [
  ...EXPERIMENT_FIXTURES.filter((fixture) => fixture.feature === "E1").map((fixture, index) => ({
    id: `listen:e1:${index + 1}`,
    feature: "E1" as const,
    fixtureId: fixture.id,
    baselineVariant: "V0_FROZEN" as const,
    challengerVariant: "V1_HARD_ONLY_TESSITURA" as const,
  })),
  {
    id: "listen:e1:duplicate-reversed",
    feature: "E1",
    fixtureId: "hm-v102-e1-hard-only-upper-v0",
    baselineVariant: "V1_HARD_ONLY_TESSITURA",
    challengerVariant: "V0_FROZEN",
    reverseDuplicateOf: "listen:e1:1",
  },
  ...EXPERIMENT_FIXTURES.filter((fixture) => fixture.feature === "E3").map((fixture, index) => ({
    id: `listen:e3:${index + 1}`,
    feature: "E3" as const,
    fixtureId: fixture.id,
    baselineVariant: "V0_FROZEN" as const,
    challengerVariant: "V2_NEXT_FEASIBILITY" as const,
  })),
  {
    id: "listen:e3:duplicate-reversed",
    feature: "E3",
    fixtureId: "hm-v102-e3-dead-end-upper-v0",
    baselineVariant: "V2_NEXT_FEASIBILITY",
    challengerVariant: "V0_FROZEN",
    reverseDuplicateOf: "listen:e3:1",
  },
  ...EXPERIMENT_FIXTURES.filter((fixture) => fixture.feature === "E4").map((fixture, index) => ({
    id: `listen:e4:${index + 1}`,
    feature: "E4" as const,
    fixtureId: fixture.id,
    baselineVariant: "V0_FROZEN" as const,
    challengerVariant: "V3_REENTRY_DISTANCE" as const,
  })),
  {
    id: "listen:cumulative:1",
    feature: "CUMULATIVE",
    fixtureId: "hm-v102-e1-hard-only-upper-v0",
    baselineVariant: "V0_FROZEN",
    challengerVariant: "V5_HARD_ONLY_PLUS_NEXT_PLUS_REENTRY",
  },
  {
    id: "listen:cumulative:2",
    feature: "CUMULATIVE",
    fixtureId: "hm-v102-e3-dead-end-lower-v0",
    baselineVariant: "V0_FROZEN",
    challengerVariant: "V5_HARD_ONLY_PLUS_NEXT_PLUS_REENTRY",
  },
  ...EXPERIMENT_FIXTURES.filter((fixture) => fixture.feature === "NEUTRAL").map((fixture, index) => ({
    id: `listen:neutral:${index + 1}`,
    feature: "NEUTRAL" as const,
    fixtureId: fixture.id,
    baselineVariant: "V0_FROZEN" as const,
    challengerVariant: "V5_HARD_ONLY_PLUS_NEXT_PLUS_REENTRY" as const,
  })),
] as const;

export function deterministicBlindSwap(seed: string, comparisonId: string): boolean {
  let hash = 2166136261;
  for (const char of `${seed}:${comparisonId}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2 === 1;
}

export function pitchLabel(value: SpelledPitch | null): string {
  if (!value) return "rest";
  const accidental = value.alter < 0 ? "b".repeat(-value.alter) : "#".repeat(value.alter);
  return `${value.step}${accidental}${value.octave}`;
}
