import { createDiagnostics, type Diagnostic } from "../domain/diagnostics";
import {
  addFractions,
  fraction,
} from "../domain/fraction";
import type {
  ArrangementCandidate,
  FullSongMetrics,
  GeneratedVoiceEvent,
  TextureDensityMetrics,
} from "../domain/generation/model";
import type {
  ArrangementAnchorPlan,
  ArrangementIntentPlan,
} from "../domain/plans";
import { pitchMidiNumber } from "../domain/pitch";
import {
  countRate,
  durationRate,
  extendedCountRate,
} from "../domain/rates";
import {
  comparePositions,
  compareRanges,
  type MusicalRange,
} from "../domain/time";
import { loadFrozenWagAuthority } from "../grammar/authority";
import {
  rangeDuration,
  type WagLifecycleInput,
} from "../grammar/lifecycle";

const ZERO = fraction(0);
const STEP_ORDINAL = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 } as const;

function equalRange(left: MusicalRange, right: MusicalRange): boolean {
  return compareRanges(left, right) === 0;
}

function containsRange(outer: MusicalRange, inner: MusicalRange): boolean {
  return comparePositions(outer.start, inner.start) <= 0
    && comparePositions(inner.end, outer.end) <= 0;
}

function atomFor(input: WagLifecycleInput, range: MusicalRange) {
  return input.sourceLeadAtomization.atoms.find((atom) => containsRange(atom.range, range));
}

function phraseFor(input: WagLifecycleInput, range: MusicalRange) {
  return input.source.phraseRegions.find((phrase) => containsRange(phrase.range, range));
}

function densityBySection(
  input: WagLifecycleInput,
  candidate: ArrangementCandidate,
): Readonly<Record<string, TextureDensityMetrics>> {
  const tracks = Object.entries(candidate.generatedEventsByTrack);
  const result: Record<string, TextureDensityMetrics> = {};
  const measureDurations = input.source.performanceSequence.occurrences.map((measure) => measure.duration);
  for (const section of input.source.sectionOccurrences) {
    const atoms = input.sourceLeadAtomization.atoms.filter((atom) =>
      atom.range.start.performanceMeasureIndex >= section.startPerformanceMeasureIndex
      && atom.range.start.performanceMeasureIndex < section.endPerformanceMeasureIndexExclusive
      && atom.pitch !== null);
    const ranges = (tracks.length === 0
      ? atoms.map((atom) => atom.range)
      : tracks.flatMap(([, events]) => events
        .filter((event) => event.range.start.performanceMeasureIndex >= section.startPerformanceMeasureIndex
          && event.range.start.performanceMeasureIndex < section.endPerformanceMeasureIndexExclusive
          && atomFor(input, event.range)?.pitch !== null)
        .map((event) => event.range)))
      .sort(compareRanges)
      .filter((range, index, values) => index === 0 || !equalRange(range, values[index - 1]));
    const denominator = ranges.reduce(
      (sum, range) => addFractions(sum, rangeDuration(range, measureDurations)),
      ZERO,
    );
    let participation = ZERO;
    let divergence = ZERO;
    let exactlyTwo = ZERO;
    let exactlyThree = ZERO;
    let maxSimultaneous = 0;
    const spreads: number[] = [];
    for (const range of ranges) {
      const atom = atomFor(input, range);
      if (!atom?.pitch) continue;
      const notes = tracks.flatMap(([, events]) => events.filter((event): event is Extract<GeneratedVoiceEvent, { readonly kind: "note" }> =>
        event.kind === "note" && equalRange(event.range, range)));
      const duration = rangeDuration(range, measureDurations);
      if (notes.length > 0) participation = addFractions(participation, duration);
      if (notes.some((note) => pitchMidiNumber(note.pitch) !== pitchMidiNumber(atom.pitch!))) {
        divergence = addFractions(divergence, duration);
      }
      const midis = [pitchMidiNumber(atom.pitch), ...notes.map((note) => pitchMidiNumber(note.pitch))];
      const distinct = new Set(midis).size;
      if (distinct === 2) exactlyTwo = addFractions(exactlyTwo, duration);
      if (distinct === 3) exactlyThree = addFractions(exactlyThree, duration);
      maxSimultaneous = Math.max(maxSimultaneous, notes.length);
      if (notes.length > 0) spreads.push(Math.max(...midis) - Math.min(...midis));
    }
    const leadAttackCount = new Set(atoms.map((atom) => atom.sourceEventId)).size;
    const harmonyAttackCount = tracks.reduce((count, [, events]) => count + events.filter((event) =>
      event.kind === "note" && !event.tieStop
      && event.range.start.performanceMeasureIndex >= section.startPerformanceMeasureIndex
      && event.range.start.performanceMeasureIndex < section.endPerformanceMeasureIndexExclusive).length, 0);
    const orderedSpreads = spreads.sort((left, right) => left - right);
    result[section.id] = {
      participationCoverage: durationRate(participation, denominator),
      harmonyAttackRatio: extendedCountRate(harmonyAttackCount, leadAttackCount),
      harmonyOverLeadRestCoverage: durationRate(ZERO, ZERO),
      maxSimultaneousHarmonyTracks: Math.min(2, maxSimultaneous) as 0 | 1 | 2,
      harmonicDivergenceCoverage: durationRate(divergence, denominator),
      exactlyTwoPitchCoverage: durationRate(exactlyTwo, denominator),
      exactlyThreePitchCoverage: durationRate(exactlyThree, denominator),
      medianRegisterSpreadSemitones: orderedSpreads.length === 0
        ? 0
        : orderedSpreads[Math.floor((orderedSpreads.length - 1) / 2)],
    };
  }
  return result;
}

function maxLeapByTrack(candidate: ArrangementCandidate): Readonly<Record<string, number>> {
  return Object.fromEntries(Object.entries(candidate.generatedEventsByTrack).map(([trackPlanId, original]) => {
    const events = [...original].sort((left, right) => compareRanges(left.range, right.range));
    let previous: Extract<GeneratedVoiceEvent, { readonly kind: "note" }>["pitch"] | undefined;
    let maximum = 0;
    for (const event of events) {
      if (event.kind === "rest") {
        previous = undefined;
        continue;
      }
      if (previous) maximum = Math.max(maximum, Math.abs(pitchMidiNumber(event.pitch) - pitchMidiNumber(previous)));
      previous = event.pitch;
    }
    return [trackPlanId, maximum];
  }));
}

async function expectedDiagnostics(
  input: WagLifecycleInput,
  intentPlan: ArrangementIntentPlan,
  candidate: ArrangementCandidate,
): Promise<readonly Diagnostic[]> {
  if (candidate.candidateStatus === "complete") return [];
  const tracks = Object.entries(candidate.generatedEventsByTrack);
  const details: Readonly<Record<string, string | number | boolean>> = tracks.length === 0
    ? { missingPhraseCount: intentPlan.phraseIntents.filter((phrase) => phrase.harmonyExpectation === "H1-required").length }
    : {
        missingRangeCount: tracks.reduce((count, [trackPlanId, events]) => count + events.filter((event) => {
          if (event.kind !== "rest") return false;
          const phrase = phraseFor(input, event.range);
          return phrase !== undefined && intentPlan.phraseIntents.some((intent) =>
            intent.phraseId === phrase.id
            && intent.trackRoles.some((role) => role.trackPlanId === trackPlanId));
        }).length, 0),
      };
  const authority = await loadFrozenWagAuthority();
  return createDiagnostics([{
    code: "WAG_V1_PARTIAL_REQUIRED_COVERAGE",
    severity: "error",
    messageKo: "WAG_V1_PARTIAL_REQUIRED_COVERAGE",
    ...(tracks.length === 1 ? { location: { trackPlanIds: [tracks[0][0]] } } : {}),
    details,
  }], authority.diagnostics);
}

function canonicalPathKey(
  input: WagLifecycleInput,
  anchorPlan: ArrangementAnchorPlan,
  candidate: ArrangementCandidate,
): string {
  const tracks = Object.entries(candidate.generatedEventsByTrack);
  if (tracks.length === 0) return "wag1-local-v1|tx=0";
  const trackOrdinalById = Object.fromEntries(input.trackPlans.map((track) => [track.id, track.canonicalOrdinal]));
  const directives = anchorPlan.phraseAnchorPlans.flatMap((phrase) => phrase.anchorDirectives)
    .slice()
    .sort((left, right) => comparePositions(left.position, right.position)
      || trackOrdinalById[left.trackPlanId] - trackOrdinalById[right.trackPlanId]);
  const directiveOrdinalById = Object.fromEntries(directives.map((directive, ordinal) => [directive.id, ordinal]));
  const uniqueRanges = tracks.flatMap(([, events]) => events.map((event) => event.range))
    .sort(compareRanges)
    .filter((range, index, ranges) => index === 0 || !equalRange(range, ranges[index - 1]));
  const entries = tracks.flatMap(([trackPlanId, events]) => events.map((event) => ({
    event,
    trackPlanId,
    trackOrdinal: trackOrdinalById[trackPlanId],
    decisionOrdinal: uniqueRanges.findIndex((range) => equalRange(range, event.range)),
  }))).sort((left, right) => left.decisionOrdinal - right.decisionOrdinal
    || left.trackOrdinal - right.trackOrdinal);
  const priorSounding = new Map<string, boolean>();
  return ["wag1-local-v1", "tx=2", ...entries.map(({ decisionOrdinal, event, trackPlanId, trackOrdinal }) => {
    const sounding = event.kind === "note";
    const hadPrior = priorSounding.has(trackPlanId);
    const wasSounding = priorSounding.get(trackPlanId) ?? false;
    const transition = sounding ? (wasSounding ? 2 : hadPrior ? 3 : 1) : wasSounding ? 4 : 0;
    priorSounding.set(trackPlanId, sounding);
    const directiveOrdinal = event.kind === "note" && event.originDirectiveId !== undefined
      ? directiveOrdinalById[event.originDirectiveId]
      : -1;
    if (!Number.isSafeInteger(trackOrdinal) || !Number.isSafeInteger(directiveOrdinal)) {
      throw new RangeError("CANDIDATE_PROJECTION_INVALID:evidence-reference");
    }
    const pitch = event.kind === "note" ? event.pitch : undefined;
    return `d=${decisionOrdinal},tr=${trackOrdinal},a=${transition},dir=${directiveOrdinal},m=${pitch ? pitchMidiNumber(pitch) : -1},s=${pitch ? STEP_ORDINAL[pitch.step] : -1},x=${pitch?.alter ?? 0},o=${pitch?.octave ?? -1}`;
  })].join("|");
}

export async function deriveCandidateEvidence(input: {
  readonly lifecycleInput: WagLifecycleInput;
  readonly intentPlan: ArrangementIntentPlan;
  readonly anchorPlan: ArrangementAnchorPlan;
  readonly candidate: ArrangementCandidate;
}): Promise<{
  readonly metrics: FullSongMetrics;
  readonly diagnostics: readonly Diagnostic[];
  readonly canonicalPathKey: string;
}> {
  const diagnostics = await expectedDiagnostics(input.lifecycleInput, input.intentPlan, input.candidate);
  const soundingCount = Object.values(input.candidate.generatedEventsByTrack)
    .flat().filter((event) => event.kind === "note").length;
  return {
    metrics: {
      densityBySectionOccurrence: densityBySection(input.lifecycleInput, input.candidate),
      maxLeapSemitonesByTrack: maxLeapByTrack(input.candidate),
      hardDiagnosticCount: diagnostics.filter((entry) => entry.severity === "blocking" || entry.severity === "error").length,
      plannedNctResolution: countRate(0, 0),
      sourceChordRespect: countRate(soundingCount, soundingCount),
    },
    diagnostics,
    canonicalPathKey: canonicalPathKey(input.lifecycleInput, input.anchorPlan, input.candidate),
  };
}
