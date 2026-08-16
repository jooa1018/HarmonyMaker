import { APPLICATION_ALGORITHM_VERSION_REGISTRY } from "../app/algorithm-version-registry";
import { buildArrangementCandidate, validateGenerationResultState, type CandidateOrdinalRegistry } from "../domain/generation/candidate";
import type {
  ArrangementCandidate,
  ArrangementGenerationResult,
  FullSongMetrics,
  TextureDensityMetrics,
} from "../domain/generation/model";
import { createDiagnostics, type Diagnostic } from "../domain/diagnostics";
import { digestGenerationInput } from "../domain/digest/stages";
import {
  addFractions,
  compareFractions,
  fraction,
  type Fraction,
} from "../domain/fraction";
import type { ArrangementActivityPlan, ArrangementAnchorPlan, ArrangementIntentPlan } from "../domain/plans";
import { pitchMidiNumber, containsPitch, type SpelledPitch } from "../domain/pitch";
import {
  countRate,
  durationRate,
  extendedCountRate,
  type CountRateMetric,
  type DurationRateMetric,
} from "../domain/rates";
import { comparePositions, compareRanges, type MusicalRange } from "../domain/time";
import type { VocalPlacementRole } from "../domain/performer";
import {
  placementRoleFor,
  prepareWagLifecycle,
  primaryPulseAt,
  rangeDuration,
  type PreparedWagLifecycle,
  type WagLifecycleInput,
} from "./lifecycle";
import {
  immutableTrackProjectionEqual,
  type SolvedWagDecision,
  type SolvedWagTrack,
  type WagLocalSolverOutput,
} from "./solver";

export type WagCandidateReasonCode =
  | "OPTIONAL_MARGINAL_NOT_PERCEPTIBLE"
  | "OPTIONAL_MARGINAL_LASI_REJECTED"
  | "OPTIONAL_PAIR_LASI_REJECTED"
  | "OPTIONAL_PAIR_DEGRADED_TO_SINGLE";

export interface WagMarginalMetrics {
  readonly independentSoundingDuration: Fraction;
  readonly participationCoverage: DurationRateMetric;
  readonly localRestFallbackDuration: Fraction;
  readonly localRestFallbackCount: number;
  readonly thirdSixthRelationDuration: Fraction;
  readonly legalContinuationCount: number;
  readonly legalContinuationDuration: Fraction;
  readonly lowMotionCount: number;
  readonly lowMotionDuration: Fraction;
  readonly contextualChordToneCount: number;
  readonly contextualChordToneDuration: Fraction;
  readonly hardRangeDuration: Fraction;
  readonly comfortableRangeDuration: Fraction;
  readonly preferredRangeDuration: Fraction;
  readonly localRestDurationBp: number;
  readonly hardOnlyRangeDurationBp: number;
  readonly preferredMissDurationBp: number;
  readonly maxLeapSemitones: number;
  readonly preferredLeapExcessSemitoneSum: number;
  readonly totalMotionSemitones: number;
  readonly leadProximityDurationBp: number;
  readonly longestRepeatedDirectedRelationRun: number;
  readonly sourceChordRespect: CountRateMetric;
  readonly perceptible: boolean;
  readonly firstPitch?: SpelledPitch;
  readonly lastPitch?: SpelledPitch;
  readonly placementRole: VocalPlacementRole;
}

export interface WagMarginalAdmission {
  readonly track: SolvedWagTrack;
  readonly placementRole: VocalPlacementRole;
  readonly candidateStatus: "complete" | "partial";
  readonly lasiPass: true;
  readonly metrics: WagMarginalMetrics;
  readonly candidate?: ArrangementCandidate;
}

export interface WagPairMetrics {
  readonly overlapDuration: Fraction;
  readonly threeDistinctPitchDuration: Fraction;
  readonly threeDistinctPitchDecisionCount: number;
  readonly dropoutParity: boolean;
  readonly upperLowerSpreadSemitones: readonly number[];
}

export interface WagCandidateRejection {
  readonly scope: "marginal" | "pair";
  readonly reason: WagCandidateReasonCode;
  readonly trackPlanIds: readonly string[];
}

export interface WagGenerationAssembly {
  readonly result: ArrangementGenerationResult;
  readonly defaultCandidateId?: string;
  readonly marginals: readonly WagMarginalAdmission[];
  readonly pairMetrics?: WagPairMetrics;
  readonly rejections: readonly WagCandidateRejection[];
}

const ZERO = fraction(0);
const STEP_ORDINAL = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 } as const;
const ROLE_ORDINAL: Readonly<Record<VocalPlacementRole, number>> = { upper: 0, lower: 1 };

function sumDurations(
  prepared: PreparedWagLifecycle,
  decisions: readonly SolvedWagDecision[],
  predicate: (decision: SolvedWagDecision) => boolean,
): Fraction {
  return decisions.reduce((sum, decision) => predicate(decision)
    ? addFractions(sum, rangeDuration(decision.range, prepared.measureDurations))
    : sum, ZERO);
}

function equalRange(left: MusicalRange, right: MusicalRange): boolean {
  return compareRanges(left, right) === 0;
}

function percentage(metric: DurationRateMetric): number {
  return metric.valueBp ?? 0;
}

function pitchEqual(left: SpelledPitch, right: SpelledPitch): boolean {
  return left.step === right.step && left.alter === right.alter && left.octave === right.octave;
}

function marginalMetrics(
  prepared: PreparedWagLifecycle,
  track: SolvedWagTrack,
  role: VocalPlacementRole,
): WagMarginalMetrics {
  const performer = prepared.performerByTrackId[track.trackPlanId];
  if (!performer) throw new RangeError(`TRACK_ASSIGNMENT_INVALID:${track.trackPlanId}`);
  const evaluable = track.decisions.filter((decision) => decision.leadPitch !== null && decision.chordSpanId !== undefined);
  const sounding = track.decisions.filter((decision) => decision.selectedPitch !== undefined);
  const denominator = sumDurations(prepared, evaluable, () => true);
  const independentSoundingDuration = sumDurations(prepared, sounding, () => true);
  const localRestDecisions = evaluable.filter((decision) => decision.activity.state === "rest");
  const localRestFallbackDuration = sumDurations(prepared, localRestDecisions, () => true);
  const comfortableRangeDuration = sumDurations(prepared, sounding, (decision) =>
    Boolean(decision.selectedPitch && containsPitch(performer.comfortableRange, decision.selectedPitch)));
  const preferredRangeDuration = performer.preferredTessitura
    ? sumDurations(prepared, sounding, (decision) =>
      Boolean(decision.selectedPitch && containsPitch(performer.preferredTessitura!, decision.selectedPitch)))
    : comfortableRangeDuration;
  const hardOnlyDuration = sumDurations(prepared, sounding, (decision) =>
    Boolean(decision.selectedPitch && !containsPitch(performer.comfortableRange, decision.selectedPitch)));
  const preferredMissDuration = performer.preferredTessitura
    ? sumDurations(prepared, sounding, (decision) =>
      Boolean(decision.selectedPitch && !containsPitch(performer.preferredTessitura!, decision.selectedPitch)))
    : sumDurations(prepared, sounding, (decision) =>
      Boolean(decision.selectedPitch && !containsPitch(performer.comfortableRange, decision.selectedPitch)));
  const leadProximityDuration = sumDurations(prepared, sounding, (decision) =>
    Boolean(decision.selectedPitch && decision.leadPitch
      && Math.abs(pitchMidiNumber(decision.selectedPitch) - pitchMidiNumber(decision.leadPitch)) < 3));
  let maxLeapSemitones = 0;
  let preferredLeapExcessSemitoneSum = 0;
  let totalMotionSemitones = 0;
  let previous: SpelledPitch | undefined;
  let previousRelation: number | undefined;
  let currentRun = 0;
  let longestRepeatedDirectedRelationRun = 0;
  for (const decision of track.decisions) {
    if (!decision.selectedPitch) {
      previous = undefined;
      previousRelation = undefined;
      currentRun = 0;
      continue;
    }
    if (previous) {
      const leap = Math.abs(pitchMidiNumber(decision.selectedPitch) - pitchMidiNumber(previous));
      maxLeapSemitones = Math.max(maxLeapSemitones, leap);
      totalMotionSemitones += leap;
      preferredLeapExcessSemitoneSum += Math.max(0, leap - prepared.input.effectiveConfig.preferredMaxLeapSemitones);
    }
    const relation = decision.leadPitch
      ? pitchMidiNumber(decision.selectedPitch) - pitchMidiNumber(decision.leadPitch)
      : undefined;
    if (relation !== undefined && relation === previousRelation) currentRun += 1;
    else currentRun = 1;
    longestRepeatedDirectedRelationRun = Math.max(longestRepeatedDirectedRelationRun, currentRun);
    previousRelation = relation;
    previous = decision.selectedPitch;
  }
  const familyDuration = (family: SolvedWagDecision["candidateFamily"]): Fraction =>
    sumDurations(prepared, sounding, (decision) => decision.candidateFamily === family);
  const familyCount = (family: SolvedWagDecision["candidateFamily"]): number =>
    sounding.filter((decision) => decision.candidateFamily === family).length;
  return {
    independentSoundingDuration,
    participationCoverage: durationRate(independentSoundingDuration, denominator),
    localRestFallbackDuration,
    localRestFallbackCount: localRestDecisions.length,
    thirdSixthRelationDuration: familyDuration("CHORD_AWARE_THIRD_SIXTH"),
    legalContinuationCount: familyCount("LEGAL_CONTINUATION"),
    legalContinuationDuration: familyDuration("LEGAL_CONTINUATION"),
    lowMotionCount: familyCount("LOW_MOTION_CHORD_TONE"),
    lowMotionDuration: familyDuration("LOW_MOTION_CHORD_TONE"),
    contextualChordToneCount: familyCount("CONTEXTUAL_CHORD_TONE"),
    contextualChordToneDuration: familyDuration("CONTEXTUAL_CHORD_TONE"),
    hardRangeDuration: independentSoundingDuration,
    comfortableRangeDuration,
    preferredRangeDuration,
    localRestDurationBp: percentage(durationRate(localRestFallbackDuration, denominator)),
    hardOnlyRangeDurationBp: percentage(durationRate(hardOnlyDuration, denominator)),
    preferredMissDurationBp: percentage(durationRate(preferredMissDuration, denominator)),
    maxLeapSemitones,
    preferredLeapExcessSemitoneSum,
    totalMotionSemitones,
    leadProximityDurationBp: percentage(durationRate(leadProximityDuration, denominator)),
    longestRepeatedDirectedRelationRun,
    sourceChordRespect: countRate(sounding.length, sounding.length),
    perceptible: track.perceptible,
    ...(sounding[0]?.selectedPitch ? { firstPitch: sounding[0].selectedPitch } : {}),
    ...(sounding.at(-1)?.selectedPitch ? { lastPitch: sounding.at(-1)!.selectedPitch } : {}),
    placementRole: role,
  };
}

function candidateOrdinals(
  prepared: PreparedWagLifecycle,
  anchorPlan: ArrangementAnchorPlan,
): CandidateOrdinalRegistry {
  const lyricIds = prepared.input.source.sourceMeasures.flatMap((measure) =>
    measure.lyricTokens.map((token) => token.id));
  const directives = anchorPlan.phraseAnchorPlans.flatMap((phrase) => phrase.anchorDirectives)
    .sort((left, right) => comparePositions(left.position, right.position)
      || prepared.ordinals.trackOrdinalById[left.trackPlanId] - prepared.ordinals.trackOrdinalById[right.trackPlanId]);
  return {
    trackOrdinalById: prepared.ordinals.trackOrdinalById,
    lyricOrdinalById: Object.fromEntries(lyricIds.map((id, ordinal) => [id, ordinal])),
    anchorDirectiveOrdinalById: Object.fromEntries(directives.map((directive, ordinal) => [directive.id, ordinal])),
  };
}

function candidatePathKey(
  tracks: readonly SolvedWagTrack[],
  ordinals: CandidateOrdinalRegistry,
): string {
  if (tracks.length === 0) return "wag1-local-v1|tx=0";
  const uniqueRanges = tracks.flatMap((track) => track.decisions.map((decision) => decision.range))
    .sort(compareRanges)
    .filter((range, index, ranges) => index === 0 || !equalRange(range, ranges[index - 1]));
  const entries: Array<{ readonly decisionOrdinal: number; readonly track: SolvedWagTrack; readonly decision: SolvedWagDecision }> = [];
  for (const track of tracks) {
    for (const decision of track.decisions) {
      const decisionOrdinal = uniqueRanges.findIndex((range) => equalRange(range, decision.range));
      entries.push({ decisionOrdinal, track, decision });
    }
  }
  entries.sort((left, right) => left.decisionOrdinal - right.decisionOrdinal || left.track.trackOrdinal - right.track.trackOrdinal);
  const priorSounding = new Map<string, boolean>();
  return ["wag1-local-v1", "tx=2", ...entries.map(({ decisionOrdinal, track, decision }) => {
    const sounding = decision.selectedPitch !== undefined;
    const hadPrior = priorSounding.has(track.trackPlanId);
    const wasSounding = priorSounding.get(track.trackPlanId) ?? false;
    const transition = sounding ? (wasSounding ? 2 : hadPrior ? 3 : 1) : wasSounding ? 4 : 0;
    priorSounding.set(track.trackPlanId, sounding);
    const directiveOrdinal = decision.originDirectiveId === undefined
      ? -1
      : ordinals.anchorDirectiveOrdinalById[decision.originDirectiveId];
    if (!Number.isSafeInteger(directiveOrdinal)) throw new RangeError("missing canonical anchor directive ordinal");
    const pitch = decision.selectedPitch;
    return `d=${decisionOrdinal},tr=${track.trackOrdinal},a=${transition},dir=${directiveOrdinal},m=${pitch ? pitchMidiNumber(pitch) : -1},s=${pitch ? STEP_ORDINAL[pitch.step] : -1},x=${pitch?.alter ?? 0},o=${pitch?.octave ?? -1}`;
  })].join("|");
}

function sectionDensity(
  prepared: PreparedWagLifecycle,
  tracks: readonly SolvedWagTrack[],
): Readonly<Record<string, TextureDensityMetrics>> {
  const result: Record<string, TextureDensityMetrics> = {};
  for (const section of prepared.sections) {
    const sectionAtoms = prepared.input.sourceLeadAtomization.atoms.filter((atom) =>
      atom.range.start.performanceMeasureIndex >= section.startPerformanceMeasureIndex
      && atom.range.start.performanceMeasureIndex < section.endPerformanceMeasureIndexExclusive
      && atom.pitch !== null);
    const denominator = sectionAtoms.reduce((sum, atom) => addFractions(sum, rangeDuration(atom.range, prepared.measureDurations)), ZERO);
    let participation = ZERO;
    let divergence = ZERO;
    let exactlyTwo = ZERO;
    let exactlyThree = ZERO;
    const spreads: number[] = [];
    let maxSimultaneous = 0;
    for (const atom of sectionAtoms) {
      const notes = tracks.flatMap((track) => track.decisions.filter((decision) => equalRange(decision.range, atom.range) && decision.selectedPitch).map((decision) => decision.selectedPitch!));
      const duration = rangeDuration(atom.range, prepared.measureDurations);
      if (notes.length > 0) participation = addFractions(participation, duration);
      if (notes.some((note) => !pitchEqual(note, atom.pitch!))) divergence = addFractions(divergence, duration);
      const distinct = new Set([pitchMidiNumber(atom.pitch!), ...notes.map(pitchMidiNumber)]).size;
      if (distinct === 2) exactlyTwo = addFractions(exactlyTwo, duration);
      if (distinct === 3) exactlyThree = addFractions(exactlyThree, duration);
      maxSimultaneous = Math.max(maxSimultaneous, notes.length);
      if (notes.length > 0) {
        const midis = [pitchMidiNumber(atom.pitch!), ...notes.map(pitchMidiNumber)];
        spreads.push(Math.max(...midis) - Math.min(...midis));
      }
    }
    const leadAttackCount = sectionAtoms.filter((atom) => atom.lyricTokenIds.length > 0).length;
    const harmonyAttackCount = tracks.reduce((count, track) => count + track.decisions.filter((decision, index, decisions) =>
      decision.sectionOccurrenceId === section.id && decision.selectedPitch
        && (index === 0 || !decisions[index - 1].selectedPitch)).length, 0);
    const orderedSpreads = spreads.sort((left, right) => left - right);
    result[section.id] = {
      participationCoverage: durationRate(participation, denominator),
      harmonyAttackRatio: extendedCountRate(harmonyAttackCount, leadAttackCount),
      harmonyOverLeadRestCoverage: durationRate(ZERO, ZERO),
      maxSimultaneousHarmonyTracks: Math.min(2, maxSimultaneous) as 0 | 1 | 2,
      harmonicDivergenceCoverage: durationRate(divergence, denominator),
      exactlyTwoPitchCoverage: durationRate(exactlyTwo, denominator),
      exactlyThreePitchCoverage: durationRate(exactlyThree, denominator),
      medianRegisterSpreadSemitones: orderedSpreads.length === 0 ? 0 : orderedSpreads[Math.floor((orderedSpreads.length - 1) / 2)],
    };
  }
  return result;
}

function fullSongMetrics(
  prepared: PreparedWagLifecycle,
  tracks: readonly SolvedWagTrack[],
  diagnostics: readonly Diagnostic[],
): FullSongMetrics {
  const maxLeapSemitonesByTrack = Object.fromEntries(tracks.map((track) => {
    let previous: SpelledPitch | undefined;
    let maxLeap = 0;
    for (const decision of track.decisions) {
      if (!decision.selectedPitch) {
        previous = undefined;
        continue;
      }
      if (previous) maxLeap = Math.max(maxLeap, Math.abs(pitchMidiNumber(decision.selectedPitch) - pitchMidiNumber(previous)));
      previous = decision.selectedPitch;
    }
    return [track.trackPlanId, maxLeap];
  }));
  const soundingCount = tracks.reduce((count, track) => count + track.decisions.filter((decision) => decision.selectedPitch).length, 0);
  return {
    densityBySectionOccurrence: sectionDensity(prepared, tracks),
    maxLeapSemitonesByTrack,
    hardDiagnosticCount: diagnostics.filter((entry) => entry.severity === "blocking" || entry.severity === "error").length,
    plannedNctResolution: countRate(0, 0),
    sourceChordRespect: countRate(soundingCount, soundingCount),
  };
}

function h1Compare(left: WagMarginalAdmission, right: WagMarginalAdmission): number {
  const status = (left.candidateStatus === "complete" ? 0 : 1) - (right.candidateStatus === "complete" ? 0 : 1);
  if (status !== 0) return status;
  const tupleLeft = [
    left.metrics.localRestDurationBp,
    left.metrics.hardOnlyRangeDurationBp,
    left.metrics.preferredMissDurationBp,
    left.metrics.preferredLeapExcessSemitoneSum,
    left.metrics.totalMotionSemitones,
    left.metrics.leadProximityDurationBp,
    left.track.trackOrdinal,
    ROLE_ORDINAL[left.placementRole],
  ];
  const tupleRight = [
    right.metrics.localRestDurationBp,
    right.metrics.hardOnlyRangeDurationBp,
    right.metrics.preferredMissDurationBp,
    right.metrics.preferredLeapExcessSemitoneSum,
    right.metrics.totalMotionSemitones,
    right.metrics.leadProximityDurationBp,
    right.track.trackOrdinal,
    ROLE_ORDINAL[right.placementRole],
  ];
  for (let index = 0; index < tupleLeft.length; index += 1) {
    if (tupleLeft[index] !== tupleRight[index]) return tupleLeft[index] - tupleRight[index];
  }
  return (left.candidate?.contentDigest ?? "").localeCompare(right.candidate?.contentDigest ?? "");
}

function pairScreen(
  prepared: PreparedWagLifecycle,
  upper: WagMarginalAdmission,
  lower: WagMarginalAdmission,
): { readonly accepted: true; readonly metrics: WagPairMetrics } | { readonly accepted: false } {
  if (!upper.candidate || !lower.candidate || upper.candidateStatus !== "complete" || lower.candidateStatus !== "complete") return { accepted: false };
  const upperPerformer = prepared.input.assignments.find((assignment) => assignment.trackPlanId === upper.track.trackPlanId)?.performerId;
  const lowerPerformer = prepared.input.assignments.find((assignment) => assignment.trackPlanId === lower.track.trackPlanId)?.performerId;
  if (!upperPerformer || upperPerformer === lowerPerformer) return { accepted: false };
  let overlapDuration = ZERO;
  let threeDistinctPitchDuration = ZERO;
  let threeDistinctPitchDecisionCount = 0;
  const spreads: number[] = [];
  let overlapMeetsPulse = false;
  for (const upperDecision of upper.track.decisions) {
    if (!upperDecision.selectedPitch || !upperDecision.leadPitch) continue;
    const lowerDecision = lower.track.decisions.find((decision) => equalRange(decision.range, upperDecision.range));
    if (!lowerDecision?.selectedPitch || !lowerDecision.leadPitch) continue;
    const upperMidi = pitchMidiNumber(upperDecision.selectedPitch);
    const leadMidi = pitchMidiNumber(upperDecision.leadPitch);
    const lowerMidi = pitchMidiNumber(lowerDecision.selectedPitch);
    if (!(upperMidi > leadMidi && leadMidi > lowerMidi)) return { accepted: false };
    const duration = rangeDuration(upperDecision.range, prepared.measureDurations);
    overlapDuration = addFractions(overlapDuration, duration);
    if (compareFractions(duration, primaryPulseAt(prepared, upperDecision.range.start)) >= 0) overlapMeetsPulse = true;
    if (new Set([upperMidi, leadMidi, lowerMidi]).size === 3) {
      threeDistinctPitchDecisionCount += 1;
      threeDistinctPitchDuration = addFractions(threeDistinctPitchDuration, duration);
    }
    spreads.push(upperMidi - lowerMidi);
  }
  if (!overlapMeetsPulse && compareFractions(overlapDuration, primaryPulseAt(prepared, prepared.phrases[0].range.start)) < 0) return { accepted: false };
  if (threeDistinctPitchDecisionCount < 2) return { accepted: false };
  return {
    accepted: true,
    metrics: {
      overlapDuration,
      threeDistinctPitchDuration,
      threeDistinctPitchDecisionCount,
      dropoutParity: true,
      upperLowerSpreadSemitones: spreads,
    },
  };
}

function lockRequiresHarmony(prepared: PreparedWagLifecycle): boolean {
  return prepared.locks.activity.some((lock) => lock.activity.state !== "rest")
    || prepared.locks.anchor.length > 0
    || prepared.locks.solver.length > 0
    || prepared.locks.intent.some((lock) => lock.kind === "placement-role" || (lock.kind === "texture" && lock.textureId !== "UNISON"));
}

function ordering(
  presetId: WagLifecycleInput["effectiveConfig"]["presetId"],
  rolesByTrackId: Readonly<Record<string, VocalPlacementRole>>,
  left: ArrangementCandidate,
  right: ArrangementCandidate,
): number {
  const status = (left.candidateStatus === "complete" ? 0 : 1) - (right.candidateStatus === "complete" ? 0 : 1);
  if (status !== 0) return status;
  const leftTracks = Object.keys(left.generatedEventsByTrack).sort();
  const rightTracks = Object.keys(right.generatedEventsByTrack).sort();
  const preference = (tracks: readonly string[]) => tracks.length === 2 && presetId !== "simple" ? 0 : tracks.length === 1 ? 1 : 2;
  const preferred = preference(leftTracks) - preference(rightTracks);
  if (preferred !== 0) return preferred;
  if (leftTracks.length !== rightTracks.length) return leftTracks.length - rightTracks.length;
  const leftRoles = leftTracks.map((track) => ROLE_ORDINAL[rolesByTrackId[track] ?? "upper"]);
  const rightRoles = rightTracks.map((track) => ROLE_ORDINAL[rolesByTrackId[track] ?? "upper"]);
  for (let index = 0; index < Math.max(leftRoles.length, rightRoles.length); index += 1) {
    if ((leftRoles[index] ?? -1) !== (rightRoles[index] ?? -1)) return (leftRoles[index] ?? -1) - (rightRoles[index] ?? -1);
  }
  return left.contentDigest.localeCompare(right.contentDigest);
}

export async function assembleWagGeneration(
  input: WagLifecycleInput,
  intentPlan: ArrangementIntentPlan,
  activityPlan: ArrangementActivityPlan,
  anchorPlan: ArrangementAnchorPlan,
  solved: WagLocalSolverOutput,
): Promise<WagGenerationAssembly> {
  const preparedResult = await prepareWagLifecycle(input);
  if (preparedResult.status !== "complete") throw new RangeError("WAG_PREPARATION_BLOCKED");
  const prepared = preparedResult.value;
  const ordinals = candidateOrdinals(prepared, anchorPlan);
  const generationInputDigest = await digestGenerationInput({
    anchorPlanDigest: anchorPlan.anchorPlanDigest,
    effectiveConfigDigest: input.effectiveConfig.digest,
    presetProfileVersion: input.effectiveConfig.presetProfileVersion,
    presetProfileDigest: input.effectiveConfig.presetProfileDigest,
    locks: prepared.locks.solver,
    solverVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.solverVersion,
    assemblerVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.assemblerVersion,
    validatorVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.validatorVersion,
    metricsVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.metricsVersion,
    candidateProjectionVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.candidateProjectionVersion,
    solverConfigDigest: prepared.authority.wagOwnedConfigDigests.solverConfigDigest,
    assemblerConfigDigest: prepared.authority.wagOwnedConfigDigests.assemblerConfigDigest,
    validatorConfigDigest: prepared.authority.wagOwnedConfigDigests.validatorConfigDigest,
    metricConfigDigest: prepared.authority.wagOwnedConfigDigests.metricConfigDigest,
    diagnosticRegistryVersion: prepared.authority.diagnostics.registryVersion,
    diagnosticRegistryDigest: prepared.authority.diagnostics.registryDigest,
  }, prepared.ordinals);
  const rejections: WagCandidateRejection[] = [];
  const marginals: WagMarginalAdmission[] = [];
  for (const track of solved.tracks.filter((candidate) => candidate.selectedByIntent)) {
    const role = prepared.phrases.map((phrase) => placementRoleFor(intentPlan, phrase.id, track.trackPlanId)).find((candidate) => candidate !== undefined);
    if (!role) continue;
    const metrics = marginalMetrics(prepared, track, role);
    if (!track.perceptible) {
      rejections.push({ scope: "marginal", reason: "OPTIONAL_MARGINAL_NOT_PERCEPTIBLE", trackPlanIds: [track.trackPlanId] });
      continue;
    }
    const candidateStatus = track.fullRequiredCoverage ? "complete" : "partial";
    const diagnostics = candidateStatus === "partial"
      ? await createDiagnostics([{
        code: "WAG_V1_PARTIAL_REQUIRED_COVERAGE",
        severity: "error",
        messageKo: "WAG_V1_PARTIAL_REQUIRED_COVERAGE",
        location: { trackPlanIds: [track.trackPlanId] },
        details: { missingRangeCount: track.decisions.filter((decision) => decision.activity.state === "rest" && decision.placementRole).length },
      }], prepared.authority.diagnostics)
      : [];
    const candidate = await buildArrangementCandidate({
      presetId: input.effectiveConfig.presetId,
      candidateStatus,
      anchorPlanDigest: anchorPlan.anchorPlanDigest,
      effectiveConfigDigest: input.effectiveConfig.digest,
      presetProfileDigest: input.effectiveConfig.presetProfileDigest,
      effectiveChordTimelineDigest: input.effectiveChordTimeline.digest,
      sourceLeadAtomizationDigest: input.sourceLeadAtomization.digest,
      tracks: [{ trackPlanId: track.trackPlanId, events: track.eventPayloads }],
      realizedAnchors: track.realizedAnchors,
      ordinals,
      metrics: fullSongMetrics(prepared, [track], diagnostics),
      diagnostics,
      canonicalPathKey: candidatePathKey([track], ordinals),
    });
    marginals.push({ track, placementRole: role, candidateStatus, lasiPass: true, metrics, candidate });
  }
  if (marginals.length === 0 && prepared.assignedTracks.length > 0 && input.effectiveConfig.maxHarmonyTracks > 0) {
    const eligible = input.sourceLeadAtomization.atoms.filter((atom) => {
      if (!atom.pitch) return false;
      const span = input.effectiveChordTimeline.spans.find((candidate) =>
        comparePositions(candidate.range.start, atom.range.start) <= 0
        && comparePositions(atom.range.end, candidate.range.end) <= 0);
      return span?.parseResult.status === "ok";
    });
    if (eligible.length === 1
      && compareFractions(rangeDuration(eligible[0].range, prepared.measureDurations), primaryPulseAt(prepared, eligible[0].range.start)) < 0) {
      rejections.push(...prepared.assignedTracks.map((assigned): WagCandidateRejection => ({
        scope: "marginal",
        reason: "OPTIONAL_MARGINAL_NOT_PERCEPTIBLE",
        trackPlanIds: [assigned.trackPlan.id],
      })));
    }
  }
  marginals.sort(h1Compare);
  const expectationRequired = intentPlan.phraseIntents.some((phrase) => phrase.harmonyExpectation === "H1-required");
  const leadOnlyDiagnostics = expectationRequired
    ? await createDiagnostics([{
      code: "WAG_V1_PARTIAL_REQUIRED_COVERAGE",
      severity: "error",
      messageKo: "WAG_V1_PARTIAL_REQUIRED_COVERAGE",
      details: { missingPhraseCount: intentPlan.phraseIntents.filter((phrase) => phrase.harmonyExpectation === "H1-required").length },
    }], prepared.authority.diagnostics)
    : [];
  const leadOnly = await buildArrangementCandidate({
    presetId: input.effectiveConfig.presetId,
    candidateStatus: expectationRequired ? "partial" : "complete",
    anchorPlanDigest: anchorPlan.anchorPlanDigest,
    effectiveConfigDigest: input.effectiveConfig.digest,
    presetProfileDigest: input.effectiveConfig.presetProfileDigest,
    effectiveChordTimelineDigest: input.effectiveChordTimeline.digest,
    sourceLeadAtomizationDigest: input.sourceLeadAtomization.digest,
    tracks: [],
    realizedAnchors: [],
    ordinals,
    metrics: fullSongMetrics(prepared, [], leadOnlyDiagnostics),
    diagnostics: leadOnlyDiagnostics,
    canonicalPathKey: "wag1-local-v1|tx=0",
  });
  const candidates: ArrangementCandidate[] = [leadOnly, ...marginals.flatMap((marginal) => marginal.candidate ? [marginal.candidate] : [])];
  const upper = marginals.find((marginal) => marginal.placementRole === "upper" && marginal.candidateStatus === "complete");
  const lower = marginals.find((marginal) => marginal.placementRole === "lower" && marginal.candidateStatus === "complete");
  let pairMetrics: WagPairMetrics | undefined;
  if (input.effectiveConfig.presetId !== "simple" && upper && lower) {
    const screen = pairScreen(prepared, upper, lower);
    if (screen.accepted) {
      const pairTracks = [upper.track, lower.track].sort((left, right) => left.trackOrdinal - right.trackOrdinal);
      const pair = await buildArrangementCandidate({
        presetId: input.effectiveConfig.presetId,
        candidateStatus: "complete",
        anchorPlanDigest: anchorPlan.anchorPlanDigest,
        effectiveConfigDigest: input.effectiveConfig.digest,
        presetProfileDigest: input.effectiveConfig.presetProfileDigest,
        effectiveChordTimelineDigest: input.effectiveChordTimeline.digest,
        sourceLeadAtomizationDigest: input.sourceLeadAtomization.digest,
        tracks: pairTracks.map((track) => ({ trackPlanId: track.trackPlanId, events: track.eventPayloads })),
        realizedAnchors: pairTracks.flatMap((track) => track.realizedAnchors),
        ordinals,
        metrics: fullSongMetrics(prepared, pairTracks, []),
        diagnostics: [],
        canonicalPathKey: candidatePathKey(pairTracks, ordinals),
      });
      if (!immutableTrackProjectionEqual(upper.track, pairTracks.find((track) => track.trackPlanId === upper.track.trackPlanId)!)
        || !immutableTrackProjectionEqual(lower.track, pairTracks.find((track) => track.trackPlanId === lower.track.trackPlanId)!)) {
        throw new RangeError("WAG_V1_DROPOUT_PROJECTION_MISMATCH");
      }
      candidates.push(pair);
      pairMetrics = screen.metrics;
    } else {
      rejections.push({ scope: "pair", reason: "OPTIONAL_PAIR_LASI_REJECTED", trackPlanIds: [upper.track.trackPlanId, lower.track.trackPlanId] });
      rejections.push({ scope: "pair", reason: "OPTIONAL_PAIR_DEGRADED_TO_SINGLE", trackPlanIds: [marginals[0].track.trackPlanId] });
    }
  }
  const rolesByTrackId = Object.fromEntries(marginals.map((marginal) => [marginal.track.trackPlanId, marginal.placementRole]));
  candidates.sort((left, right) => ordering(input.effectiveConfig.presetId, rolesByTrackId, left, right));
  const completeCandidates = candidates.filter((candidate) => candidate.candidateStatus === "complete");
  let status: ArrangementGenerationResult["status"] = completeCandidates.length > 0 ? "complete" : "partial";
  let resultCandidates: readonly ArrangementCandidate[] = candidates;
  let resultDiagnostics: readonly Diagnostic[] = [];
  if (completeCandidates.length === 0 && lockRequiresHarmony(prepared)) {
    status = "blocked";
    resultCandidates = [];
    resultDiagnostics = await createDiagnostics([{
      code: "GRAMMAR_BLOCKED",
      severity: "blocking",
      messageKo: "GRAMMAR_BLOCKED",
      details: { reason: "REQUIRED_LOCKED_HARMONY_UNAVAILABLE" },
    }], prepared.authority.diagnostics);
  }
  if (!validateGenerationResultState(status, resultCandidates, resultDiagnostics.some((entry) => prepared.authority.diagnostics.definitions[entry.code].blocksGeneration))) {
    throw new RangeError("GENERATION_RESULT_STATE_INVALID");
  }
  const result: ArrangementGenerationResult = {
    presetId: input.effectiveConfig.presetId,
    status,
    candidates: resultCandidates,
    diagnostics: resultDiagnostics,
    digests: {
      musicalSourceDigest: input.source.revisionDigest,
      effectiveChordTimelineDigest: input.effectiveChordTimeline.digest,
      sourceLeadAtomizationDigest: input.sourceLeadAtomization.digest,
      presetProfileDigest: input.effectiveConfig.presetProfileDigest,
      effectiveConfigDigest: input.effectiveConfig.digest,
      intentInputDigest: intentPlan.intentInputDigest,
      activityInputDigest: activityPlan.activityInputDigest,
      anchorInputDigest: anchorPlan.anchorInputDigest,
      generationInputDigest,
      intentPlanDigest: intentPlan.intentPlanDigest,
      activityPlanDigest: activityPlan.activityPlanDigest,
      anchorPlanDigest: anchorPlan.anchorPlanDigest,
    },
    configDigests: {
      grammarConfigDigest: prepared.authority.wagOwnedConfigDigests.grammarConfigDigest,
      plannerConfigDigest: prepared.authority.wagOwnedConfigDigests.plannerConfigDigest,
      activityPlannerConfigDigest: prepared.authority.wagOwnedConfigDigests.activityPlannerConfigDigest,
      anchorPlannerConfigDigest: prepared.authority.wagOwnedConfigDigests.anchorPlannerConfigDigest,
      solverConfigDigest: prepared.authority.wagOwnedConfigDigests.solverConfigDigest,
      assemblerConfigDigest: prepared.authority.wagOwnedConfigDigests.assemblerConfigDigest,
      validatorConfigDigest: prepared.authority.wagOwnedConfigDigests.validatorConfigDigest,
      metricConfigDigest: prepared.authority.wagOwnedConfigDigests.metricConfigDigest,
      diagnosticRegistryDigest: prepared.authority.diagnostics.registryDigest,
    },
    versions: { ...APPLICATION_ALGORITHM_VERSION_REGISTRY },
  };
  return {
    result,
    ...(resultCandidates[0] ? { defaultCandidateId: resultCandidates[0].id } : {}),
    marginals,
    ...(pairMetrics ? { pairMetrics } : {}),
    rejections,
  };
}
