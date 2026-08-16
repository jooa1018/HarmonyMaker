import { APPLICATION_ALGORITHM_VERSION_REGISTRY } from "../app/algorithm-version-registry";
import type { ChordToneSpec } from "../domain/chord/model";
import { compareCanonicalValues, semanticDigest } from "../domain/digest/canonical";
import { createDiagnostics, type Diagnostic, type DiagnosticCode } from "../domain/diagnostics";
import { validateGenerationResultState } from "../domain/generation/candidate";
import type {
  ArrangementCandidate,
  ArrangementGenerationResult,
  GeneratedVoiceEvent,
  RealizedHarmonyAnchor,
} from "../domain/generation/model";
import { addFractions, compareFractions, fraction, subtractFractions, type Fraction } from "../domain/fraction";
import type { ArrangementActivityPlan, ArrangementAnchorPlan, ArrangementIntentPlan, HarmonyAnchorDirective } from "../domain/plans";
import { containsPitch, pitchMidiNumber, type Alter, type SpelledPitch, type SpelledPitchClass, type Step } from "../domain/pitch";
import { comparePositions, compareRanges, type MusicalPosition, type MusicalRange } from "../domain/time";
import { loadFrozenWagAuthority } from "./authority";
import type { WagLifecycleInput } from "./lifecycle";

export interface WagCandidateValidationReport {
  readonly candidateId: string;
  readonly valid: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

export interface WagAssemblyValidationReport {
  readonly valid: boolean;
  readonly candidates: readonly WagCandidateValidationReport[];
  readonly diagnostics: readonly Diagnostic[];
}

interface ValidatorContext {
  readonly input: WagLifecycleInput;
  readonly intentPlan: ArrangementIntentPlan;
  readonly activityPlan: ArrangementActivityPlan;
  readonly anchorPlan: ArrangementAnchorPlan;
  readonly trackOrdinalById: Readonly<Record<string, number>>;
  readonly lyricOrdinalById: Readonly<Record<string, number>>;
  readonly directiveOrdinalById: Readonly<Record<string, number>>;
  readonly directiveById: Readonly<Record<string, HarmonyAnchorDirective>>;
  readonly performerByTrackId: Readonly<Record<string, WagLifecycleInput["performers"][number]>>;
  readonly measureDurations: readonly Fraction[];
}

const STEPS: readonly Step[] = ["C", "D", "E", "F", "G", "A", "B"];
const NATURAL_SEMITONES: Readonly<Record<Step, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR_SCALE_OFFSET = [0, 2, 4, 5, 7, 9, 11] as const;

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

/** Independent Source-tone spelling realization. This intentionally does not use the generator selector. */
function realizeTone(root: SpelledPitchClass, tone: ChordToneSpec): SpelledPitchClass | undefined {
  const degreeIndex = (tone.degree - 1) % 7;
  const targetStep = STEPS[(STEPS.indexOf(root.step) + degreeIndex) % 7];
  const targetPc = mod12(NATURAL_SEMITONES[root.step] + root.alter + MAJOR_SCALE_OFFSET[degreeIndex] + tone.alteration);
  const alteration = ([-2, -1, 0, 1, 2] as const).find((candidate) =>
    mod12(NATURAL_SEMITONES[targetStep] + candidate) === targetPc);
  return alteration === undefined ? undefined : { step: targetStep, alter: alteration as Alter };
}

function toneEqual(left: ChordToneSpec, right: ChordToneSpec): boolean {
  return left.degree === right.degree && left.alteration === right.alteration
    && left.role === right.role && left.origin === right.origin;
}

function pitchEqual(left: SpelledPitch, right: SpelledPitch): boolean {
  return left.step === right.step && left.alter === right.alter && left.octave === right.octave;
}

function pitchClassEqual(pitch: SpelledPitch, pitchClass: SpelledPitchClass): boolean {
  return pitch.step === pitchClass.step && pitch.alter === pitchClass.alter;
}

function positionEqual(left: MusicalPosition, right: MusicalPosition): boolean {
  return comparePositions(left, right) === 0;
}

function rangeContains(outer: MusicalRange, inner: MusicalRange): boolean {
  return comparePositions(outer.start, inner.start) <= 0 && comparePositions(inner.end, outer.end) <= 0;
}

function positionKey(position: MusicalPosition): string {
  return `${position.performanceMeasureIndex}:${position.offset.n}/${position.offset.d}`;
}

function rangeDuration(range: MusicalRange, measureDurations: readonly Fraction[]): Fraction {
  const absolute = (position: MusicalPosition): Fraction => {
    let result = fraction(0);
    for (let index = 0; index < position.performanceMeasureIndex; index += 1) {
      const duration = measureDurations[index];
      if (!duration) throw new RangeError("INPUT_INVALID_FRACTION");
      result = addFractions(result, duration);
    }
    return addFractions(result, position.offset);
  };
  return subtractFractions(absolute(range.end), absolute(range.start));
}

function primaryPulse(input: WagLifecycleInput, position: MusicalPosition): Fraction {
  const occurrence = input.source.performanceSequence.occurrences[position.performanceMeasureIndex];
  if (!occurrence) throw new RangeError("UNSUPPORTED_METER");
  const groups = occurrence.time.beatGroups;
  if (occurrence.time.numerator === 4 && occurrence.time.denominator === 4
    && groups.length === 4 && groups.every((group) => group === 1)) return fraction(1);
  if (occurrence.time.numerator === 6 && occurrence.time.denominator === 8
    && groups.length === 2 && groups[0] === 3 && groups[1] === 3) return fraction(3, 2);
  throw new RangeError("UNSUPPORTED_METER");
}

function rawDiagnostic(
  code: DiagnosticCode,
  candidateId: string,
  details: Readonly<Record<string, string | number | boolean>>,
  range?: MusicalRange,
): Omit<Diagnostic, "id"> {
  return {
    code,
    severity: code === "WAG_V1_PARTIAL_REQUIRED_COVERAGE" ? "error" : "blocking",
    messageKo: code,
    location: { ...(range ? { range } : {}) },
    details: { candidateId, ...details },
  };
}

function diagnosticWithoutId(diagnostic: Diagnostic): Omit<Diagnostic, "id"> {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    messageKo: diagnostic.messageKo,
    ...(diagnostic.location ? { location: diagnostic.location } : {}),
    ...(diagnostic.details ? { details: diagnostic.details } : {}),
  };
}

function chordAt(context: ValidatorContext, range: MusicalRange) {
  return context.input.effectiveChordTimeline.spans.find((span) => rangeContains(span.range, range));
}

function atomAt(context: ValidatorContext, range: MusicalRange) {
  return context.input.sourceLeadAtomization.atoms.find((atom) => rangeContains(atom.range, range));
}

function phraseAt(context: ValidatorContext, range: MusicalRange) {
  return context.input.source.phraseRegions.find((phrase) => rangeContains(phrase.range, range));
}

function activityAt(context: ValidatorContext, phraseId: string, trackPlanId: string, range: MusicalRange) {
  return context.activityPlan.phraseActivityPlans.find((phrase) => phrase.phraseId === phraseId)
    ?.activitySpans.find((span) => span.trackPlanId === trackPlanId && rangeContains(span.range, range))?.activity;
}

function roleAt(context: ValidatorContext, phraseId: string, trackPlanId: string) {
  return context.intentPlan.phraseIntents.find((phrase) => phrase.phraseId === phraseId)
    ?.trackRoles.find((role) => role.trackPlanId === trackPlanId)?.placementRole;
}

function expectedLyricIds(context: ValidatorContext, event: GeneratedVoiceEvent): readonly string[] {
  const atom = atomAt(context, event.range);
  return atom && positionEqual(atom.range.start, event.range.start) ? atom.lyricTokenIds : [];
}

function eventProjection(event: GeneratedVoiceEvent, context: ValidatorContext): object {
  if (event.kind === "rest") return { kind: "rest", range: event.range };
  const lyricOrdinals = event.lyricTokenIds.map((id) => {
    const ordinal = context.lyricOrdinalById[id];
    if (!Number.isSafeInteger(ordinal)) throw new RangeError("STALE_REFERENCE");
    return ordinal;
  }).sort((left, right) => left - right);
  const directiveOrdinal = event.originDirectiveId === undefined ? null : context.directiveOrdinalById[event.originDirectiveId];
  if (directiveOrdinal !== null && !Number.isSafeInteger(directiveOrdinal)) throw new RangeError("STALE_REFERENCE");
  return {
    kind: "note",
    range: event.range,
    pitch: event.pitch,
    tieStart: event.tieStart,
    tieStop: event.tieStop,
    lyricTokenOrdinals: lyricOrdinals,
    source: event.source,
    originAnchorDirectiveOrdinal: directiveOrdinal,
  };
}

function anchorProjection(anchor: RealizedHarmonyAnchor, context: ValidatorContext): object {
  const directiveOrdinal = context.directiveOrdinalById[anchor.directiveId];
  const trackOrdinal = context.trackOrdinalById[anchor.trackPlanId];
  if (!Number.isSafeInteger(directiveOrdinal) || !Number.isSafeInteger(trackOrdinal)) throw new RangeError("STALE_REFERENCE");
  return { anchorDirectiveOrdinal: directiveOrdinal, trackOrdinal, position: anchor.position, pitch: anchor.pitch };
}

async function recomputeContentDigest(candidate: ArrangementCandidate, context: ValidatorContext): Promise<string> {
  const generatedTracks = Object.entries(candidate.generatedEventsByTrack).map(([trackPlanId, events]) => {
    const trackOrdinal = context.trackOrdinalById[trackPlanId];
    if (!Number.isSafeInteger(trackOrdinal)) throw new RangeError("TRACK_PLAN_MISSING");
    return { trackOrdinal, events: [...events].sort((left, right) => compareRanges(left.range, right.range)
      || compareCanonicalValues(eventProjection(left, context), eventProjection(right, context))).map((event) => eventProjection(event, context)) };
  }).sort((left, right) => left.trackOrdinal - right.trackOrdinal);
  const realizedAnchors = candidate.realizedAnchors.map((anchor) => anchorProjection(anchor, context)).sort(compareCanonicalValues);
  return semanticDigest({
    projectionSchema: "hm-arrangement-candidate-content-v1",
    presetId: candidate.presetId,
    candidateStatus: candidate.candidateStatus,
    anchorPlanDigest: candidate.anchorPlanDigest,
    effectiveConfigDigest: candidate.effectiveConfigDigest,
    presetProfileDigest: candidate.presetProfileDigest,
    effectiveChordTimelineDigest: candidate.effectiveChordTimelineDigest,
    sourceLeadAtomizationDigest: candidate.sourceLeadAtomizationDigest,
    generatedTracks,
    realizedAnchors,
  });
}

function expectedBoundaries(context: ValidatorContext): ReadonlySet<string> {
  const positions = [
    ...context.input.sourceLeadAtomization.atoms.flatMap((atom) => [atom.range.start, atom.range.end]),
    ...context.input.effectiveChordTimeline.spans.flatMap((span) => [span.range.start, span.range.end]),
    ...context.input.source.phraseRegions.flatMap((phrase) => [phrase.range.start, phrase.range.end]),
    ...context.input.source.sectionOccurrences.flatMap((section) => [
      { performanceMeasureIndex: section.startPerformanceMeasureIndex, offset: fraction(0) },
      { performanceMeasureIndex: section.endPerformanceMeasureIndexExclusive, offset: fraction(0) },
    ]),
    ...(context.input.locks?.activity ?? []).flatMap((lock) => [lock.range.start, lock.range.end]),
    ...(context.input.locks?.anchor ?? []).map((lock) => lock.position),
    ...(context.input.locks?.solver ?? []).map((lock) => lock.position),
  ];
  return new Set(positions.map(positionKey));
}

function checkTrack(
  candidate: ArrangementCandidate,
  trackPlanId: string,
  events: readonly GeneratedVoiceEvent[],
  context: ValidatorContext,
): readonly Omit<Diagnostic, "id">[] {
  const diagnostics: Omit<Diagnostic, "id">[] = [];
  const performer = context.performerByTrackId[trackPlanId];
  if (!performer) return [rawDiagnostic("TRACK_ASSIGNMENT_INVALID", candidate.id, { trackPlanId })];
  const ordered = [...events].sort((left, right) => compareRanges(left.range, right.range));
  const boundaries = expectedBoundaries(context);
  for (let index = 0; index < ordered.length; index += 1) {
    const event = ordered[index];
    const previous = ordered[index - 1];
    if (!boundaries.has(positionKey(event.range.start)) || !boundaries.has(positionKey(event.range.end))) {
      diagnostics.push(rawDiagnostic("CANDIDATE_PROJECTION_INVALID", candidate.id, { reason: "TIMING_DIVERGENCE", trackPlanId }, event.range));
    }
    if (!phraseAt(context, event.range) || !atomAt(context, event.range)) {
      diagnostics.push(rawDiagnostic("CANDIDATE_PROJECTION_INVALID", candidate.id, { reason: "EVENT_OUTSIDE_CANONICAL_PARTITION", trackPlanId }, event.range));
    }
    if (previous && comparePositions(event.range.start, previous.range.end) !== 0) {
      diagnostics.push(rawDiagnostic(comparePositions(event.range.start, previous.range.end) < 0 ? "INPUT_EVENT_OVERLAP" : "CANDIDATE_PROJECTION_INVALID", candidate.id, { reason: "TRACK_TIMING_NOT_CONTIGUOUS", trackPlanId }, event.range));
    }
    const phrase = phraseAt(context, event.range);
    const activity = phrase ? activityAt(context, phrase.id, trackPlanId, event.range) : undefined;
    if (!activity || (event.kind === "note") !== (activity.state === "independent-note")) {
      diagnostics.push(rawDiagnostic("ACTIVITY_SPAN_INVALID", candidate.id, { trackPlanId }, event.range));
    }
    if (event.kind === "rest") {
      if (previous?.kind === "note" && previous.tieStart) diagnostics.push(rawDiagnostic("INPUT_INVALID_TIE", candidate.id, { reason: "TIE_INTO_REST", trackPlanId }, event.range));
      continue;
    }
    if (event.source !== "anchor") diagnostics.push(rawDiagnostic("GENERATED_ILLEGAL_NCT", candidate.id, { reason: "NON_ANCHOR_AUTOMATIC_SOURCE", trackPlanId }, event.range));
    if (!containsPitch(performer.hardRange, event.pitch)) diagnostics.push(rawDiagnostic("GENERATED_OUT_OF_RANGE", candidate.id, { trackPlanId }, event.range));
    const atom = atomAt(context, event.range);
    const role = phrase ? roleAt(context, phrase.id, trackPlanId) : undefined;
    if (!atom?.pitch || !role || (role === "upper" ? pitchMidiNumber(event.pitch) <= pitchMidiNumber(atom.pitch) : pitchMidiNumber(event.pitch) >= pitchMidiNumber(atom.pitch))) {
      diagnostics.push(rawDiagnostic("GENERATED_VOICE_CROSSING", candidate.id, { trackPlanId }, event.range));
    }
    const span = chordAt(context, event.range);
    if (!span || span.parseResult.status !== "ok") {
      diagnostics.push(rawDiagnostic("GENERATED_NO_CHORD_POLICY_VIOLATION", candidate.id, { trackPlanId }, event.range));
    }
    const directive = event.originDirectiveId ? context.directiveById[event.originDirectiveId] : undefined;
    if (!directive || directive.kind !== "chord-tone" || directive.trackPlanId !== trackPlanId
      || !positionEqual(directive.position, event.range.start) || directive.chordSpanId !== span?.id) {
      diagnostics.push(rawDiagnostic("WAG_V1_ANCHOR_SOLVER_SELECTION_PARITY_MISMATCH", candidate.id, { trackPlanId }, event.range));
    } else if (span?.parseResult.status === "ok") {
      const sourceTone = span.parseResult.chord.tones.find((tone) => toneEqual(tone, directive.selectedTone));
      const pitchClass = sourceTone ? realizeTone(span.parseResult.chord.root, sourceTone) : undefined;
      if (!sourceTone || !pitchClass || !pitchClassEqual(event.pitch, pitchClass)) {
        diagnostics.push(rawDiagnostic("GENERATED_CHORD_ROLE_CONFLICT", candidate.id, { reason: "SOURCE_TONE_ILLEGAL", trackPlanId }, event.range));
      }
    }
    const expectedLyrics = expectedLyricIds(context, event);
    if (JSON.stringify(event.lyricTokenIds) !== JSON.stringify(expectedLyrics)) {
      diagnostics.push(rawDiagnostic("LYRIC_POLICY_VIOLATION", candidate.id, { trackPlanId }, event.range));
    }
    if (previous?.kind === "note") {
      const same = pitchEqual(previous.pitch, event.pitch);
      if (event.tieStop !== (previous.tieStart && same) || (event.tieStop && event.lyricTokenIds.length > 0)) {
        diagnostics.push(rawDiagnostic("INPUT_INVALID_TIE", candidate.id, { trackPlanId }, event.range));
      }
      if (phraseAt(context, previous.range)?.id === phrase?.id) {
        const leap = Math.abs(pitchMidiNumber(event.pitch) - pitchMidiNumber(previous.pitch));
        if (leap > context.input.effectiveConfig.hardMaxLeapSemitones) {
          diagnostics.push(rawDiagnostic("GRAMMAR_BLOCKED", candidate.id, { reason: "CONTINUOUS_HARD_LEAP", trackPlanId, leap }, event.range));
        }
      }
    } else if (event.tieStop) diagnostics.push(rawDiagnostic("INPUT_INVALID_TIE", candidate.id, { trackPlanId }, event.range));
    const matchingAnchor = candidate.realizedAnchors.find((anchor) => anchor.directiveId === event.originDirectiveId
      && anchor.trackPlanId === trackPlanId && positionEqual(anchor.position, event.range.start) && pitchEqual(anchor.pitch, event.pitch));
    if (!matchingAnchor) diagnostics.push(rawDiagnostic("WAG_V1_ANCHOR_SOLVER_SELECTION_PARITY_MISMATCH", candidate.id, { reason: "REALIZED_ANCHOR_MISSING", trackPlanId }, event.range));
  }
  for (const phrase of context.input.source.phraseRegions) {
    const phraseEvents = ordered.filter((event) => rangeContains(phrase.range, event.range));
    if (phraseEvents.length === 0 || !positionEqual(phraseEvents[0].range.start, phrase.range.start)
      || !positionEqual(phraseEvents[phraseEvents.length - 1].range.end, phrase.range.end)) {
      diagnostics.push(rawDiagnostic("CANDIDATE_PROJECTION_INVALID", candidate.id, { reason: "PHRASE_TIMING_DIVERGENCE", trackPlanId }, phrase.range));
    }
  }
  const sounding = ordered.filter((event) => event.kind === "note");
  const perceptible = sounding.length >= 2 || sounding.some((event) =>
    compareFractions(rangeDuration(event.range, context.measureDurations), primaryPulse(context.input, event.range.start)) >= 0);
  if (!perceptible) diagnostics.push(rawDiagnostic("GRAMMAR_BLOCKED", candidate.id, { reason: "MARGINAL_NOT_PERCEPTIBLE", trackPlanId }));
  for (const lock of context.input.locks?.solver ?? []) {
    if (lock.trackPlanId !== trackPlanId) continue;
    const event = sounding.find((candidateEvent) => positionEqual(candidateEvent.range.start, lock.position));
    if (!event || !pitchEqual(event.pitch, lock.pitch)) diagnostics.push(rawDiagnostic("STAGE_LOCK_SCOPE_INVALID", candidate.id, { reason: "PITCH_LOCK_MISMATCH", lockId: lock.id, trackPlanId }));
  }
  return diagnostics;
}

async function contextFor(
  input: WagLifecycleInput,
  intentPlan: ArrangementIntentPlan,
  activityPlan: ArrangementActivityPlan,
  anchorPlan: ArrangementAnchorPlan,
): Promise<ValidatorContext> {
  const trackOrdinalById = Object.fromEntries(input.trackPlans.map((track) => [track.id, track.kind === "source-lead" ? 0 : track.canonicalOrdinal]));
  const lyricIds = input.source.sourceMeasures.flatMap((measure) => measure.lyricTokens.map((token) => token.id));
  const directives = anchorPlan.phraseAnchorPlans.flatMap((phrase) => phrase.anchorDirectives).sort((left, right) =>
    comparePositions(left.position, right.position) || trackOrdinalById[left.trackPlanId] - trackOrdinalById[right.trackPlanId]);
  const performerById = Object.fromEntries(input.performers.map((performer) => [performer.id, performer]));
  const performerByTrackId = Object.fromEntries(input.assignments.map((assignment) => [assignment.trackPlanId, performerById[assignment.performerId]]));
  const measureDurations = input.source.performanceSequence.occurrences.map((occurrence) => occurrence.duration);
  return {
    input,
    intentPlan,
    activityPlan,
    anchorPlan,
    trackOrdinalById,
    lyricOrdinalById: Object.fromEntries(lyricIds.map((id, ordinal) => [id, ordinal])),
    directiveOrdinalById: Object.fromEntries(directives.map((directive, ordinal) => [directive.id, ordinal])),
    directiveById: Object.fromEntries(directives.map((directive) => [directive.id, directive])),
    performerByTrackId,
    measureDurations,
  };
}

export async function validateWagCandidate(
  input: WagLifecycleInput,
  intentPlan: ArrangementIntentPlan,
  activityPlan: ArrangementActivityPlan,
  anchorPlan: ArrangementAnchorPlan,
  candidate: ArrangementCandidate,
): Promise<WagCandidateValidationReport> {
  const authority = await loadFrozenWagAuthority();
  const context = await contextFor(input, intentPlan, activityPlan, anchorPlan);
  const raw: Omit<Diagnostic, "id">[] = [];
  if (candidate.presetId !== input.effectiveConfig.presetId
    || candidate.anchorPlanDigest !== anchorPlan.anchorPlanDigest
    || candidate.effectiveConfigDigest !== input.effectiveConfig.digest
    || candidate.presetProfileDigest !== input.effectiveConfig.presetProfileDigest
    || candidate.effectiveChordTimelineDigest !== input.effectiveChordTimeline.digest
    || candidate.sourceLeadAtomizationDigest !== input.sourceLeadAtomization.digest) {
    raw.push(rawDiagnostic("ALGORITHM_CONFIG_MISMATCH", candidate.id, { stage: "validation" }));
  }
  let recomputed = "";
  try {
    recomputed = await recomputeContentDigest(candidate, context);
  } catch {
    raw.push(rawDiagnostic("CANDIDATE_PROJECTION_INVALID", candidate.id, { reason: "CONTENT_PROJECTION_FAILED" }));
  }
  if (recomputed && (recomputed !== candidate.contentDigest || candidate.id !== `cand:${candidate.presetId}:${candidate.contentDigest}`)) {
    raw.push(rawDiagnostic("CANDIDATE_PROJECTION_INVALID", candidate.id, { reason: "CONTENT_DIGEST_MISMATCH" }));
  }
  const trackEntries = Object.entries(candidate.generatedEventsByTrack);
  if (trackEntries.length > input.effectiveConfig.maxHarmonyTracks) raw.push(rawDiagnostic("TRACK_ROLE_CONFLICT", candidate.id, { reason: "MAX_HARMONY_TRACKS_EXCEEDED" }));
  for (const [trackPlanId, events] of trackEntries) raw.push(...checkTrack(candidate, trackPlanId, events, context));
  const trackIds = new Set(trackEntries.map(([trackPlanId]) => trackPlanId));
  for (const anchor of candidate.realizedAnchors) {
    if (!trackIds.has(anchor.trackPlanId)) raw.push(rawDiagnostic("WAG_V1_DROPOUT_PROJECTION_MISMATCH", candidate.id, { reason: "PEER_ANCHOR_IN_MARGINAL", trackPlanId: anchor.trackPlanId }));
  }
  const expectationRequired = intentPlan.phraseIntents.some((phrase) => phrase.harmonyExpectation === "H1-required");
  if (trackEntries.length === 0) {
    if (expectationRequired && candidate.candidateStatus !== "partial") raw.push(rawDiagnostic("WAG_V1_PARTIAL_REQUIRED_COVERAGE", candidate.id, { reason: "LEAD_ONLY_CANNOT_SATISFY_H1" }));
    if (!expectationRequired && candidate.candidateStatus !== "complete") raw.push(rawDiagnostic("CANDIDATE_PROJECTION_INVALID", candidate.id, { reason: "LEAD_ONLY_STATUS_MISMATCH" }));
  } else if (expectationRequired && candidate.candidateStatus === "complete") {
    for (const phrase of intentPlan.phraseIntents.filter((entry) => entry.harmonyExpectation === "H1-required")) {
      if (![...trackIds].some((trackPlanId) => phrase.trackRoles.some((role) => role.trackPlanId === trackPlanId))) {
        raw.push(rawDiagnostic("WAG_V1_PARTIAL_REQUIRED_COVERAGE", candidate.id, { reason: "H1_ROLE_MISSING", phraseId: phrase.phraseId }));
      }
    }
  }
  if (trackEntries.length === 2) {
    const performers = trackEntries.map(([trackPlanId]) => input.assignments.find((assignment) => assignment.trackPlanId === trackPlanId)?.performerId);
    if (!performers[0] || performers[0] === performers[1]) raw.push(rawDiagnostic("PERFORMER_DOUBLE_BOOKED", candidate.id, { reason: "PAIR_PERFORMER_COLLISION" }));
    let overlap = fraction(0);
    let distinctCount = 0;
    const [first, second] = trackEntries.map(([, events]) => events.filter((event) => event.kind === "note"));
    for (const upperEvent of first) {
      const lowerEvent = second.find((event) => compareRanges(event.range, upperEvent.range) === 0);
      if (!lowerEvent || lowerEvent.kind !== "note") continue;
      const atom = atomAt(context, upperEvent.range);
      if (!atom?.pitch) continue;
      const midis = [pitchMidiNumber(upperEvent.pitch), pitchMidiNumber(atom.pitch), pitchMidiNumber(lowerEvent.pitch)].sort((left, right) => right - left);
      if (!(midis[0] > midis[1] && midis[1] > midis[2])) raw.push(rawDiagnostic("GENERATED_VOICE_CROSSING", candidate.id, { reason: "PAIR_STRICT_ORDER" }, upperEvent.range));
      overlap = addFractions(overlap, rangeDuration(upperEvent.range, context.measureDurations));
      if (new Set(midis).size === 3) distinctCount += 1;
    }
    if (distinctCount < 2 || compareFractions(overlap, primaryPulse(input, input.source.phraseRegions[0].range.start)) < 0) {
      raw.push(rawDiagnostic("GRAMMAR_BLOCKED", candidate.id, { reason: "PAIR_PERCEPTIBILITY" }));
    }
  }
  const diagnostics = await createDiagnostics(raw, authority.diagnostics);
  return { candidateId: candidate.id, valid: diagnostics.length === 0, diagnostics };
}

function dropoutProjection(candidate: ArrangementCandidate, trackPlanId: string, context: ValidatorContext): object {
  const events = candidate.generatedEventsByTrack[trackPlanId] ?? [];
  const anchors = candidate.realizedAnchors.filter((anchor) => anchor.trackPlanId === trackPlanId);
  return {
    events: events.map((event) => eventProjection(event, context)),
    realizedAnchors: anchors.map((anchor) => anchorProjection(anchor, context)).sort(compareCanonicalValues),
  };
}

export async function validateWagAssembly(
  input: WagLifecycleInput,
  intentPlan: ArrangementIntentPlan,
  activityPlan: ArrangementActivityPlan,
  anchorPlan: ArrangementAnchorPlan,
  result: ArrangementGenerationResult,
): Promise<WagAssemblyValidationReport> {
  const authority = await loadFrozenWagAuthority();
  const context = await contextFor(input, intentPlan, activityPlan, anchorPlan);
  const candidateReports = await Promise.all(result.candidates.map((candidate) =>
    validateWagCandidate(input, intentPlan, activityPlan, anchorPlan, candidate)));
  const raw = candidateReports.flatMap((report) => report.diagnostics.map(diagnosticWithoutId));
  for (const pair of result.candidates.filter((candidate) => Object.keys(candidate.generatedEventsByTrack).length === 2)) {
    for (const trackPlanId of Object.keys(pair.generatedEventsByTrack)) {
      const marginal = result.candidates.find((candidate) => {
        const ids = Object.keys(candidate.generatedEventsByTrack);
        return ids.length === 1 && ids[0] === trackPlanId;
      });
      if (!marginal || compareCanonicalValues(dropoutProjection(pair, trackPlanId, context), dropoutProjection(marginal, trackPlanId, context)) !== 0) {
        raw.push(rawDiagnostic("WAG_V1_DROPOUT_PROJECTION_MISMATCH", pair.id, { trackPlanId }));
      }
    }
  }
  const hasBlocking = result.diagnostics.some((diagnostic) => authority.diagnostics.definitions[diagnostic.code].blocksGeneration);
  if (!validateGenerationResultState(result.status, result.candidates, hasBlocking)) {
    raw.push(rawDiagnostic("GENERATION_RESULT_STATE_INVALID", "result", { status: result.status }));
  }
  if (result.versions.validatorVersion !== APPLICATION_ALGORITHM_VERSION_REGISTRY.validatorVersion
    || result.configDigests.validatorConfigDigest !== authority.wagOwnedConfigDigests.validatorConfigDigest) {
    raw.push(rawDiagnostic("ALGORITHM_CONFIG_MISMATCH", "result", { stage: "validation", reason: "VALIDATOR_AUTHORITY_MISMATCH" }));
  }
  const diagnostics = await createDiagnostics(raw, authority.diagnostics);
  return { valid: diagnostics.length === 0, candidates: candidateReports, diagnostics };
}
