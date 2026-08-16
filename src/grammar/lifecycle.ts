import { APPLICATION_ALGORITHM_VERSION_REGISTRY } from "../app/algorithm-version-registry";
import { resolveEffectiveArrangementConfig, type EffectiveArrangementConfig, type UserArrangementCaps } from "../domain/config";
import { createDiagnostics, type Diagnostic, type DiagnosticCode } from "../domain/diagnostics";
import {
  digestAnchorInput,
  digestActivityInput,
  digestIntentInput,
  type CanonicalAssignmentProjection,
  type CanonicalPerformerProjection,
  type CanonicalTrackProjection,
} from "../domain/digest/stages";
import { digestActivityPlan, digestAnchorPlan, digestIntentPlan, type PlanOrdinalRegistry } from "../domain/digest/plans";
import { compareCanonicalValues, type SemanticDigest } from "../domain/digest/canonical";
import { digestMusicalSource } from "../domain/digest/source";
import {
  addFractions,
  compareFractions,
  fraction,
  subtractFractions,
  type Fraction,
} from "../domain/fraction";
import {
  digestPerformanceSequence,
  digestSourceChordProjection,
  resolveEffectiveChordTimeline,
  type EffectiveChordTimeline,
  type PerformanceChordSpan,
} from "../domain/harmony/chord-timeline";
import {
  phraseActivityPlanId,
  phraseAnchorPlanId,
  phraseIntentId,
  anchorDirectiveId,
  sectionIntentId,
  trackRoleSegmentId,
  voiceActivitySpanId,
  voiceAttackEventId,
} from "../domain/ids";
import { validateLockScope, type ActivityLock, type AnchorLock, type PlacementRoleLock, type TextureLock, type VariantStageLocks } from "../domain/locks";
import type {
  ArrangementActivityPlan,
  ArrangementAnchorPlan,
  ArrangementIntentPlan,
  AssignedHarmonyTrackContext,
  LocalRestDecisionEvidence,
  PhraseActivityPlan,
  PhraseAnchorPlan,
  PhraseArrangementIntent,
  SectionArrangementIntent,
  StageExecutionResult,
  VoiceActivityDirective,
  VoiceActivitySpan,
  VoiceAttackEvent,
} from "../domain/plans";
import {
  validateAssignments,
  validatePerformer,
  validateTrackPlans,
  type GeneratedHarmonyTrackPlan,
  type PerformerProfile,
  type PerformerTrackAssignment,
  type TrackRoleSegment,
  type VocalPlacementRole,
  type VocalTrackPlan,
} from "../domain/performer";
import { containsPitch, pitchMidiNumber, type SpelledPitch } from "../domain/pitch";
import { basisPoints, durationRate, extendedCountRate } from "../domain/rates";
import { atomizeSourceLead, type SourceLeadAtomization, type TimelineAtom } from "../domain/source/atomization";
import type {
  PhraseRegion,
  SectionDefinition,
  SectionOccurrence,
  SongSourceDocument,
  SourceMeasure,
} from "../domain/source/model";
import {
  comparePositions,
  compareRanges,
  musicalRange,
  type MusicalPosition,
  type MusicalRange,
} from "../domain/time";
import { loadFrozenWagAuthority, type LoadedFrozenWagAuthority } from "./authority";
import {
  selectLocalHarmonyDecision,
  type LocalDecisionTrigger,
  type LocalHarmonyDecisionContext,
  type LocalSelectionResult,
} from "./local-selection";

const EMPTY_LOCKS: VariantStageLocks = Object.freeze({ intent: [], activity: [], anchor: [], solver: [] });
export interface WagLifecycleInput {
  readonly source: SongSourceDocument;
  readonly effectiveChordTimeline: EffectiveChordTimeline;
  readonly sourceLeadAtomization: SourceLeadAtomization;
  readonly effectiveConfig: EffectiveArrangementConfig;
  readonly userCaps: UserArrangementCaps;
  readonly performers: readonly PerformerProfile[];
  readonly trackPlans: readonly VocalTrackPlan[];
  readonly assignments: readonly PerformerTrackAssignment[];
  readonly locks?: VariantStageLocks;
}

export interface PreparedAssignedTrack {
  readonly trackPlan: GeneratedHarmonyTrackPlan;
  readonly performer: PerformerProfile;
  readonly context: AssignedHarmonyTrackContext;
}

export interface WagLocalDecision {
  readonly phrase: PhraseRegion;
  readonly sectionOccurrence: SectionOccurrence;
  readonly atom: TimelineAtom;
  readonly range: MusicalRange;
  readonly chordSpan?: PerformanceChordSpan;
  readonly trigger: LocalDecisionTrigger;
  readonly lyricOnset: boolean;
  readonly lyricTokenIds: readonly string[];
}

export interface PreparedWagLifecycle {
  readonly input: WagLifecycleInput;
  readonly authority: LoadedFrozenWagAuthority;
  readonly locks: VariantStageLocks;
  readonly ordinals: PlanOrdinalRegistry;
  readonly assignedTracks: readonly PreparedAssignedTrack[];
  readonly sections: readonly SectionOccurrence[];
  readonly phrases: readonly PhraseRegion[];
  readonly measureDurations: readonly Fraction[];
  readonly sourceMeasureById: Readonly<Record<string, SourceMeasure>>;
  readonly performerByTrackId: Readonly<Record<string, PerformerProfile>>;
  readonly trackById: Readonly<Record<string, VocalTrackPlan>>;
  readonly sectionByPhraseId: Readonly<Record<string, SectionOccurrence>>;
}

interface PreviewSummary {
  readonly mapping: readonly PreparedAssignedTrackRole[];
  readonly tuple: readonly number[];
  readonly blockingDecisionCount: number;
  readonly localRestDurationBp: number;
  readonly hardOnlyRangeDurationBp: number;
  readonly preferredMissDurationBp: number;
  readonly preferredLeapExcessSemitoneSum: number;
  readonly totalMotionSemitones: number;
  readonly roleChangeCount: number;
}

interface PreparedAssignedTrackRole extends PreparedAssignedTrack {
  readonly placementRole: VocalPlacementRole;
}

interface MutableSpan {
  trackPlanId: string;
  range: MusicalRange;
  activity: VoiceActivityDirective;
}

function positionEqual(left: MusicalPosition, right: MusicalPosition): boolean {
  return comparePositions(left, right) === 0;
}

function rangeContains(outer: MusicalRange, inner: MusicalRange): boolean {
  return comparePositions(outer.start, inner.start) <= 0 && comparePositions(inner.end, outer.end) <= 0;
}

function rangesOverlap(left: MusicalRange, right: MusicalRange): boolean {
  return comparePositions(left.start, right.end) < 0 && comparePositions(right.start, left.end) < 0;
}

export function absolutePosition(position: MusicalPosition, measureDurations: readonly Fraction[]): Fraction {
  let value = fraction(0);
  for (let index = 0; index < position.performanceMeasureIndex; index += 1) {
    const duration = measureDurations[index];
    if (!duration) throw new RangeError("position exceeds the performance sequence");
    value = addFractions(value, duration);
  }
  return addFractions(value, position.offset);
}

export function rangeDuration(range: MusicalRange, measureDurations: readonly Fraction[]): Fraction {
  return subtractFractions(
    absolutePosition(range.end, measureDurations),
    absolutePosition(range.start, measureDurations),
  );
}

export function primaryPulseAt(
  prepared: PreparedWagLifecycle,
  position: MusicalPosition,
): Fraction {
  const occurrence = prepared.input.source.performanceSequence.occurrences[position.performanceMeasureIndex];
  if (!occurrence) throw new RangeError("UNSUPPORTED_METER");
  const measure = prepared.sourceMeasureById[occurrence.sourceMeasureId];
  if (!measure) throw new RangeError("UNSUPPORTED_METER");
  const time = measure.time;
  if (time.numerator === 4 && time.denominator === 4
    && time.beatGroups.length === 4 && time.beatGroups.every((group) => group === 1)) {
    return fraction(1);
  }
  if (time.numerator === 6 && time.denominator === 8
    && time.beatGroups.length === 2 && time.beatGroups.every((group) => group === 3)) {
    return fraction(3, 2);
  }
  throw new RangeError("UNSUPPORTED_BEAT_GROUPING");
}

function canonicalSections(source: SongSourceDocument): readonly SectionOccurrence[] {
  return [...source.sectionOccurrences].sort((left, right) =>
    left.startPerformanceMeasureIndex - right.startPerformanceMeasureIndex
    || left.endPerformanceMeasureIndexExclusive - right.endPerformanceMeasureIndexExclusive
    || left.occurrenceIndex - right.occurrenceIndex);
}

function canonicalPhrases(source: SongSourceDocument): readonly PhraseRegion[] {
  return [...source.phraseRegions].sort((left, right) => compareRanges(left.range, right.range));
}

function canonicalAtoms(atomization: SourceLeadAtomization): readonly TimelineAtom[] {
  return [...atomization.atoms].sort((left, right) => compareRanges(left.range, right.range));
}

function canonicalChordSpans(timeline: EffectiveChordTimeline): readonly PerformanceChordSpan[] {
  return [...timeline.spans].sort((left, right) => compareRanges(left.range, right.range));
}

function createOrdinals(input: WagLifecycleInput): PlanOrdinalRegistry {
  const sections = canonicalSections(input.source);
  const phrases = canonicalPhrases(input.source);
  const atoms = canonicalAtoms(input.sourceLeadAtomization);
  const spans = canonicalChordSpans(input.effectiveChordTimeline);
  return {
    sectionOccurrenceOrdinalById: Object.fromEntries(sections.map((section, index) => [section.id, index])),
    phraseOrdinalById: Object.fromEntries(phrases.map((phrase, index) => [phrase.id, index])),
    trackOrdinalById: Object.fromEntries(input.trackPlans.map((track) => [track.id, track.canonicalOrdinal])),
    leadAtomOrdinalById: Object.fromEntries(atoms.map((atom, index) => [atom.id, index])),
    chordSpanOrdinalById: Object.fromEntries(spans.map((span, index) => [span.id, index])),
  };
}

function assignedGeneratedTracks(input: WagLifecycleInput): readonly PreparedAssignedTrack[] {
  const performerById = new Map(input.performers.map((performer) => [performer.id, performer]));
  const assignmentByTrack = new Map(input.assignments.map((assignment) => [assignment.trackPlanId, assignment]));
  return input.trackPlans
    .filter((track): track is GeneratedHarmonyTrackPlan => track.kind === "generated-harmony" && track.enabled)
    .sort((left, right) => left.canonicalOrdinal - right.canonicalOrdinal)
    .map((track): PreparedAssignedTrack => {
      const assignment = assignmentByTrack.get(track.id);
      const performer = assignment ? performerById.get(assignment.performerId) : undefined;
      if (!performer) throw new RangeError(`TRACK_ASSIGNMENT_INVALID:${track.id}`);
      return {
        trackPlan: track,
        performer,
        context: {
          trackPlanId: track.id,
          trackOrdinal: track.canonicalOrdinal,
          performerOrdinal: track.canonicalOrdinal,
          hardRange: performer.hardRange,
          comfortableRange: performer.comfortableRange,
          ...(performer.preferredTessitura ? { preferredTessitura: performer.preferredTessitura } : {}),
        },
      };
    });
}

function structuralDiagnostics(input: WagLifecycleInput): Array<Omit<Diagnostic, "id">> {
  const diagnostics: Omit<Diagnostic, "id">[] = [];
  if (!input.source.rights.allowedUses.includes("generation")) {
    diagnostics.push({ code: "RIGHTS_GENERATION_NOT_CONFIRMED", severity: "blocking", messageKo: "RIGHTS_GENERATION_NOT_CONFIRMED" });
  }
  if (!validateTrackPlans(input.trackPlans)) {
    diagnostics.push({ code: "TRACK_ORDINAL_INVALID", severity: "blocking", messageKo: "TRACK_ORDINAL_INVALID" });
  }
  if (input.performers.some((performer) => !validatePerformer(performer))) {
    diagnostics.push({ code: "PERFORMER_RANGE_INVALID", severity: "blocking", messageKo: "PERFORMER_RANGE_INVALID" });
  }
  if (validateAssignments(input.trackPlans, input.performers, input.assignments).length > 0) {
    diagnostics.push({ code: "TRACK_ASSIGNMENT_INVALID", severity: "blocking", messageKo: "TRACK_ASSIGNMENT_INVALID" });
  }
  if (input.source.revisionDigest !== input.sourceLeadAtomization.musicalSourceDigest
    || input.effectiveChordTimeline.digest !== input.sourceLeadAtomization.effectiveChordTimelineDigest) {
    diagnostics.push({ code: "SOURCE_LEAD_ATOMIZATION_STALE", severity: "blocking", messageKo: "SOURCE_LEAD_ATOMIZATION_STALE" });
  }
  return diagnostics;
}

function lockScopeDiagnostics(
  input: WagLifecycleInput,
  phrases: readonly PhraseRegion[],
  assignedTracks: readonly PreparedAssignedTrack[],
): Array<Omit<Diagnostic, "id">> {
  const diagnostics: Array<Omit<Diagnostic, "id">> = [];
  const locks = input.locks ?? EMPTY_LOCKS;
  const allLocks = [...locks.intent, ...locks.activity, ...locks.anchor, ...locks.solver];
  const assignedTrackIds = new Set(assignedTracks.map((assigned) => assigned.trackPlan.id));
  const seenIds = new Set<string>();
  for (const lock of allLocks) {
    const phrase = phrases.find((candidate) => candidate.id === lock.phraseId);
    const trackPlanId = "trackPlanId" in lock ? lock.trackPlanId : undefined;
    let valid = validateLockScope(lock, input.effectiveConfig.presetId)
      && phrase !== undefined
      && !seenIds.has(lock.id)
      && (trackPlanId === undefined || assignedTrackIds.has(trackPlanId));
    seenIds.add(lock.id);
    if (valid && phrase && lock.kind === "activity") valid = rangeContains(phrase.range, lock.range);
    if (valid && phrase && (lock.kind === "anchor-chord-tone" || lock.kind === "anchor-lead-derived"
      || lock.kind === "anchor-planned-nct" || lock.kind === "pitch")) {
      valid = comparePositions(phrase.range.start, lock.position) <= 0 && comparePositions(lock.position, phrase.range.end) < 0;
    }
    if (valid && lock.kind === "anchor-chord-tone") {
      const span = input.effectiveChordTimeline.spans.find((candidate) => candidate.id === lock.chordSpanId);
      valid = span?.parseResult.status === "ok" && positionWithin(span.range, lock.position)
        && span.parseResult.chord.tones.some((tone) => toneEqual(tone, lock.selectedTone));
    }
    if (!valid) diagnostics.push(diagnosticInput("STAGE_LOCK_SCOPE_INVALID", lock.phraseId, {
      stage: lock.kind === "texture" || lock.kind === "placement-role" ? "intent"
        : lock.kind === "activity" ? "activity" : lock.kind.startsWith("anchor-") ? "anchor" : "solver",
      lockId: lock.id,
      reason: "LOCK_SCOPE_INVALID",
    }));
  }
  return diagnostics;
}

function positionWithin(range: MusicalRange, position: MusicalPosition): boolean {
  return comparePositions(range.start, position) <= 0 && comparePositions(position, range.end) < 0;
}

export async function prepareWagLifecycle(input: WagLifecycleInput): Promise<
  { readonly status: "complete"; readonly value: PreparedWagLifecycle }
  | { readonly status: "blocked"; readonly diagnostics: readonly Diagnostic[] }
> {
  const authority = await loadFrozenWagAuthority();
  const rawDiagnostics = structuralDiagnostics(input);
  if (input.effectiveConfig.presetProfileVersion !== authority.presetProfiles.presetProfileVersion
    || input.effectiveConfig.presetProfileDigest !== authority.presetProfiles.presetProfileDigest
    || input.effectiveConfig.digest.length !== 64) {
    rawDiagnostics.push({ code: "PRESET_PROFILE_VERSION_MISMATCH", severity: "blocking", messageKo: "PRESET_PROFILE_VERSION_MISMATCH" });
  }
  if (rawDiagnostics.length === 0) {
    try {
      const assignedEnabledHarmonyTrackCount = input.trackPlans.filter((track) => track.kind === "generated-harmony" && track.enabled).length;
      const [musicalSourceDigest, sourceChordProjectionDigest, performanceSequenceDigest, effectiveConfig] = await Promise.all([
        digestMusicalSource(input.source),
        digestSourceChordProjection(input.source.sourceMeasures),
        digestPerformanceSequence(input.source.performanceSequence, input.source.sourceMeasures),
        resolveEffectiveArrangementConfig({
          registry: authority.presetProfiles,
          expectedPresetProfileVersion: authority.presetProfiles.presetProfileVersion,
          mode: input.effectiveConfig.mode,
          presetId: input.effectiveConfig.presetId,
          userCaps: input.userCaps,
          assignedEnabledHarmonyTrackCount,
        }),
      ]);
      if (musicalSourceDigest !== input.source.revisionDigest) {
        rawDiagnostics.push({ code: "SOURCE_REVISION_MISMATCH", severity: "blocking", messageKo: "SOURCE_REVISION_MISMATCH" });
      }
      if (compareCanonicalValues(effectiveConfig, input.effectiveConfig) !== 0) {
        rawDiagnostics.push({ code: "ALGORITHM_CONFIG_MISMATCH", severity: "blocking", messageKo: "ALGORITHM_CONFIG_MISMATCH", details: { stage: "preparation", reason: "EFFECTIVE_CONFIG_MISMATCH" } });
      }
      const timelineState = await resolveEffectiveChordTimeline({
        sourceMeasures: input.source.sourceMeasures,
        performanceSequence: input.source.performanceSequence,
        sourceChordProjectionDigest,
        performanceSequenceDigest,
        policy: input.effectiveChordTimeline.resolutionPolicy,
        resolverVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.chordTimelineResolverVersion,
        expectedResolverVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.chordTimelineResolverVersion,
      });
      if (timelineState.status !== "resolved" || timelineState.timeline.digest !== input.effectiveChordTimeline.digest) {
        rawDiagnostics.push({ code: "EFFECTIVE_CHORD_TIMELINE_STALE", severity: "blocking", messageKo: "EFFECTIVE_CHORD_TIMELINE_STALE" });
      } else {
        const atomization = await atomizeSourceLead({
          sourceMeasures: input.source.sourceMeasures,
          performanceSequence: input.source.performanceSequence,
          sectionOccurrences: input.source.sectionOccurrences,
          phraseRegions: input.source.phraseRegions,
          chordTimeline: timelineState.timeline,
          musicalSourceDigest,
          atomizerVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.sourceLeadAtomizerVersion,
        });
        if (atomization.digest !== input.sourceLeadAtomization.digest) {
          rawDiagnostics.push({ code: "SOURCE_LEAD_ATOMIZATION_STALE", severity: "blocking", messageKo: "SOURCE_LEAD_ATOMIZATION_STALE" });
        }
      }
    } catch {
      rawDiagnostics.push({ code: "ALGORITHM_CONFIG_MISMATCH", severity: "blocking", messageKo: "ALGORITHM_CONFIG_MISMATCH", details: { stage: "preparation", reason: "AUTHORITY_RECOMPUTATION_FAILED" } });
    }
  }
  if (rawDiagnostics.length > 0) {
    return { status: "blocked", diagnostics: await createDiagnostics(rawDiagnostics, authority.diagnostics) };
  }
  let assignedTracks: readonly PreparedAssignedTrack[];
  try {
    assignedTracks = assignedGeneratedTracks(input);
  } catch {
    return {
      status: "blocked",
      diagnostics: await createDiagnostics([
        { code: "TRACK_ASSIGNMENT_INVALID", severity: "blocking", messageKo: "TRACK_ASSIGNMENT_INVALID" },
      ], authority.diagnostics),
    };
  }
  const sections = canonicalSections(input.source);
  const phrases = canonicalPhrases(input.source);
  const lockDiagnostics = lockScopeDiagnostics(input, phrases, assignedTracks);
  if (lockDiagnostics.length > 0) return { status: "blocked", diagnostics: await createDiagnostics(lockDiagnostics, authority.diagnostics) };
  const sectionByPhraseId: Record<string, SectionOccurrence> = {};
  for (const phrase of phrases) {
    const section = sections.find((candidate) => candidate.id === phrase.sectionOccurrenceId);
    if (!section) {
      return {
        status: "blocked",
        diagnostics: await createDiagnostics([
          { code: "PHRASE_COVERAGE_INVALID", severity: "blocking", messageKo: "PHRASE_COVERAGE_INVALID", location: { phraseId: phrase.id } },
        ], authority.diagnostics),
      };
    }
    sectionByPhraseId[phrase.id] = section;
  }
  const sourceMeasureById = Object.fromEntries(input.source.sourceMeasures.map((measure) => [measure.id, measure]));
  const performerByTrackId = Object.fromEntries(assignedTracks.map((track) => [track.trackPlan.id, track.performer]));
  return {
    status: "complete",
    value: {
      input,
      authority,
      locks: input.locks ?? EMPTY_LOCKS,
      ordinals: createOrdinals(input),
      assignedTracks,
      sections,
      phrases,
      measureDurations: input.source.performanceSequence.occurrences.map((occurrence) => occurrence.duration),
      sourceMeasureById,
      performerByTrackId,
      trackById: Object.fromEntries(input.trackPlans.map((track) => [track.id, track])),
      sectionByPhraseId,
    },
  };
}

function sectionRange(section: SectionOccurrence): MusicalRange {
  return musicalRange(
    { performanceMeasureIndex: section.startPerformanceMeasureIndex, offset: fraction(0) },
    { performanceMeasureIndex: section.endPerformanceMeasureIndexExclusive, offset: fraction(0) },
  );
}

function chordSpanForRange(timeline: EffectiveChordTimeline, range: MusicalRange): PerformanceChordSpan | undefined {
  return timeline.spans.find((span) => rangeContains(span.range, range));
}

function uniquePositions(values: readonly MusicalPosition[]): readonly MusicalPosition[] {
  const ordered = [...values].sort(comparePositions);
  return ordered.filter((position, index) => index === 0 || !positionEqual(position, ordered[index - 1]));
}

function triggerFor(
  prepared: PreparedWagLifecycle,
  phrase: PhraseRegion,
  section: SectionOccurrence,
  atom: TimelineAtom,
  range: MusicalRange,
  span: PerformanceChordSpan | undefined,
): LocalDecisionTrigger {
  if (positionEqual(range.start, atom.range.start) && !atom.tiedFromPrevious) return "LEAD_ATTACK";
  if (span && positionEqual(range.start, span.range.start)) return "CANONICAL_CHORD_BOUNDARY";
  if (positionEqual(range.start, phrase.range.start)) return "CANONICAL_PHRASE_BOUNDARY";
  if (range.start.performanceMeasureIndex === section.startPerformanceMeasureIndex && range.start.offset.n === 0) return "CANONICAL_SECTION_BOUNDARY";
  return "STAGE_LOCK_BOUNDARY";
}

export function localDecisionsForPhrase(
  prepared: PreparedWagLifecycle,
  phrase: PhraseRegion,
  extraBoundaries: readonly MusicalPosition[] = [],
): readonly WagLocalDecision[] {
  const section = prepared.sectionByPhraseId[phrase.id];
  const decisions: WagLocalDecision[] = [];
  for (const atom of prepared.input.sourceLeadAtomization.atoms) {
    if (!rangesOverlap(atom.range, phrase.range)) continue;
    if (!rangeContains(phrase.range, atom.range)) throw new RangeError("PHRASE_COVERAGE_INVALID");
    const boundaries = uniquePositions([
      atom.range.start,
      atom.range.end,
      ...extraBoundaries.filter((position) => comparePositions(atom.range.start, position) < 0 && comparePositions(position, atom.range.end) < 0),
    ]);
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const range = musicalRange(boundaries[index], boundaries[index + 1]);
      const chordSpan = chordSpanForRange(prepared.input.effectiveChordTimeline, range);
      decisions.push({
        phrase,
        sectionOccurrence: section,
        atom,
        range,
        chordSpan,
        trigger: triggerFor(prepared, phrase, section, atom, range, chordSpan),
        lyricOnset: positionEqual(range.start, atom.range.start) && atom.lyricTokenIds.length > 0,
        lyricTokenIds: positionEqual(range.start, atom.range.start) ? atom.lyricTokenIds : [],
      });
    }
  }
  return decisions.sort((left, right) => compareRanges(left.range, right.range));
}

export function localContext(
  prepared: PreparedWagLifecycle,
  decision: WagLocalDecision,
  trackPlanId: string,
  placementRole: VocalPlacementRole,
  previousSoundingPitch: SpelledPitch | undefined,
  continuityState: "continuous" | "reentry" | "initial",
): LocalHarmonyDecisionContext {
  if (!decision.atom.pitch || !decision.chordSpan) throw new RangeError("local decision is not sounding/chord-eligible");
  return {
    phraseId: decision.phrase.id,
    trackPlanId,
    placementRole,
    sourceLeadAtomizationDigest: prepared.input.sourceLeadAtomization.digest,
    leadAtomId: decision.atom.id,
    exactRange: decision.range,
    chordSpanId: decision.chordSpan.id,
    leadPitch: decision.atom.pitch,
    trigger: decision.trigger,
    lyricOnset: decision.lyricOnset,
    ...(previousSoundingPitch ? { previousSoundingPitch } : {}),
    continuityState,
  };
}

function isChordEligible(decision: WagLocalDecision): decision is WagLocalDecision & {
  chordSpan: PerformanceChordSpan & { readonly parseResult: Extract<PerformanceChordSpan["parseResult"], { readonly status: "ok" }> };
} {
  return decision.atom.pitch !== null && decision.chordSpan?.parseResult.status === "ok";
}

function roleHypotheses(
  prepared: PreparedWagLifecycle,
  phrase: PhraseRegion,
): readonly (readonly PreparedAssignedTrackRole[])[] {
  const available = prepared.assignedTracks;
  const count = prepared.input.effectiveConfig.maxHarmonyTracks;
  if (count === 0 || available.length === 0) return [];
  const hypotheses: PreparedAssignedTrackRole[][] = [];
  if (count === 1) {
    for (const track of available) {
      hypotheses.push([{ ...track, placementRole: "upper" }], [{ ...track, placementRole: "lower" }]);
    }
  } else {
    for (let left = 0; left < available.length; left += 1) {
      for (let right = left + 1; right < available.length; right += 1) {
        hypotheses.push(
          [{ ...available[left], placementRole: "upper" }, { ...available[right], placementRole: "lower" }],
          [{ ...available[left], placementRole: "lower" }, { ...available[right], placementRole: "upper" }],
        );
      }
    }
  }
  const placementLocks = prepared.locks.intent.filter((lock): lock is PlacementRoleLock => lock.kind === "placement-role" && lock.phraseId === phrase.id);
  return hypotheses.filter((mapping) => placementLocks.every((lock) =>
    mapping.some((entry) => entry.trackPlan.id === lock.trackPlanId && entry.placementRole === lock.placementRole)));
}

function addDuration(left: Fraction, right: Fraction): Fraction {
  return addFractions(left, right);
}

function bp(numerator: Fraction, denominator: Fraction): number {
  return durationRate(numerator, denominator).valueBp ?? 0;
}

function evaluateRoleMapping(
  prepared: PreparedWagLifecycle,
  phrase: PhraseRegion,
  mapping: readonly PreparedAssignedTrackRole[],
  previousRoleByTrack: Readonly<Record<string, VocalPlacementRole | undefined>>,
): PreviewSummary {
  const decisions = localDecisionsForPhrase(prepared, phrase);
  let totalDuration = fraction(0);
  let localRestDuration = fraction(0);
  let hardOnlyDuration = fraction(0);
  let preferredMissDuration = fraction(0);
  let blockingDecisionCount = 0;
  let preferredLeapExcessSemitoneSum = 0;
  let totalMotionSemitones = 0;
  for (const assigned of mapping) {
    let previous: SpelledPitch | undefined;
    let continuity: "continuous" | "reentry" | "initial" = "initial";
    for (const decision of decisions) {
      if (!isChordEligible(decision)) {
        previous = undefined;
        continuity = "reentry";
        continue;
      }
      const duration = rangeDuration(decision.range, prepared.measureDurations);
      totalDuration = addDuration(totalDuration, duration);
      const selection = selectLocalHarmonyDecision(
        localContext(prepared, decision, assigned.trackPlan.id, assigned.placementRole, previous, continuity),
        decision.chordSpan.parseResult.chord,
        assigned.performer,
        prepared.input.effectiveConfig,
      );
      if (selection.status === "blocked") {
        blockingDecisionCount += 1;
        previous = undefined;
        continuity = "reentry";
      } else if (selection.status === "rest") {
        localRestDuration = addDuration(localRestDuration, duration);
        previous = undefined;
        continuity = "reentry";
      } else {
        const selected = selection.selected.pitch;
        if (!containsPitch(assigned.performer.comfortableRange, selected)) hardOnlyDuration = addDuration(hardOnlyDuration, duration);
        if (assigned.performer.preferredTessitura && !containsPitch(assigned.performer.preferredTessitura, selected)) {
          preferredMissDuration = addDuration(preferredMissDuration, duration);
        }
        if (previous && continuity === "continuous") {
          const motion = Math.abs(pitchMidiNumber(selected) - pitchMidiNumber(previous));
          totalMotionSemitones += motion;
          preferredLeapExcessSemitoneSum += Math.max(0, motion - prepared.input.effectiveConfig.preferredMaxLeapSemitones);
        }
        previous = selected;
        continuity = "continuous";
      }
    }
  }
  const roleChangeCount = mapping.reduce((count, assigned) =>
    count + (previousRoleByTrack[assigned.trackPlan.id] !== undefined
      && previousRoleByTrack[assigned.trackPlan.id] !== assigned.placementRole ? 1 : 0), 0);
  const canonicalTrackRoleTuple = mapping
    .slice()
    .sort((left, right) => left.trackPlan.canonicalOrdinal - right.trackPlan.canonicalOrdinal)
    .flatMap((entry) => [entry.trackPlan.canonicalOrdinal, entry.placementRole === "upper" ? 0 : 1]);
  const tuple = [
    blockingDecisionCount,
    bp(localRestDuration, totalDuration),
    bp(hardOnlyDuration, totalDuration),
    bp(preferredMissDuration, totalDuration),
    preferredLeapExcessSemitoneSum,
    totalMotionSemitones,
    roleChangeCount,
    ...canonicalTrackRoleTuple,
  ];
  return {
    mapping,
    tuple,
    blockingDecisionCount,
    localRestDurationBp: tuple[1],
    hardOnlyRangeDurationBp: tuple[2],
    preferredMissDurationBp: tuple[3],
    preferredLeapExcessSemitoneSum,
    totalMotionSemitones,
    roleChangeCount,
  };
}

function compareTuple(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function phraseHasPerceptibleEligibleGrid(prepared: PreparedWagLifecycle, phrase: PhraseRegion): boolean {
  const decisions = localDecisionsForPhrase(prepared, phrase).filter(isChordEligible);
  if (decisions.length >= 2) return true;
  return decisions.some((decision) =>
    compareFractions(rangeDuration(decision.range, prepared.measureDurations), primaryPulseAt(prepared, decision.range.start)) >= 0);
}

function cadencePolicy(
  prepared: PreparedWagLifecycle,
  phrase: PhraseRegion,
  section: SectionOccurrence,
): PhraseArrangementIntent["cadencePolicy"] {
  const sectionEnd = { performanceMeasureIndex: section.endPerformanceMeasureIndexExclusive, offset: fraction(0) };
  const relation = comparePositions(phrase.range.end, sectionEnd);
  if (relation < 0) return "open";
  if (relation > 0) throw new RangeError("PHRASE_COVERAGE_INVALID");
  const definition = prepared.input.source.sectionDefinitions.find((candidate) => candidate.id === section.sectionDefinitionId);
  if (!definition) throw new RangeError("SECTION_COVERAGE_INVALID");
  if (definition.type === "ending" || section.variant === "final") return "closed";
  const sectionIndex = prepared.sections.findIndex((candidate) => candidate.id === section.id);
  const following = prepared.sections[sectionIndex + 1];
  return following?.sectionDefinitionId === section.sectionDefinitionId ? "looping" : "open";
}

function intensityBase(maxHarmonyTracks: 0 | 1 | 2) {
  if (maxHarmonyTracks === 0) return { participation: 0, divergence: 0, exactlyTwo: 0, exactlyThree: 0, active: 1 } as const;
  if (maxHarmonyTracks === 1) return { participation: 10000, divergence: 10000, exactlyTwo: 10000, exactlyThree: 0, active: 2 } as const;
  return { participation: 10000, divergence: 10000, exactlyTwo: 0, exactlyThree: 10000, active: 3 } as const;
}

function sectionSpreadRange(prepared: PreparedWagLifecycle, section: SectionOccurrence): readonly [number, number] {
  if (prepared.input.effectiveConfig.maxHarmonyTracks === 0) return [0, 0];
  const phrases = prepared.phrases.filter((phrase) => phrase.sectionOccurrenceId === section.id);
  const mappings = phrases.length === 0 ? [] : roleHypotheses(prepared, phrases[0]);
  const values: number[] = [];
  for (const phrase of phrases) {
    for (const decision of localDecisionsForPhrase(prepared, phrase)) {
      if (!isChordEligible(decision)) continue;
      const leadMidi = pitchMidiNumber(decision.atom.pitch as SpelledPitch);
      for (const mapping of mappings) {
        const pitchesByTrack = mapping.map((assigned) => selectLocalHarmonyDecision(
          localContext(prepared, decision, assigned.trackPlan.id, assigned.placementRole, undefined, "initial"),
          decision.chordSpan.parseResult.chord,
          assigned.performer,
          prepared.input.effectiveConfig,
        ).candidates.map((candidate) => pitchMidiNumber(candidate.pitch)));
        if (pitchesByTrack.some((pitches) => pitches.length === 0)) continue;
        const visit = (trackIndex: number, selected: readonly number[]): void => {
          if (trackIndex === pitchesByTrack.length) {
            const sounding = [leadMidi, ...selected];
            values.push(Math.max(...sounding) - Math.min(...sounding));
            return;
          }
          for (const pitch of pitchesByTrack[trackIndex]) visit(trackIndex + 1, [...selected, pitch]);
        };
        visit(0, []);
      }
    }
  }
  return values.length === 0 ? [0, 0] : [Math.min(...values), Math.max(...values)];
}

function canonicalInputProjections(prepared: PreparedWagLifecycle): {
  performers: readonly CanonicalPerformerProjection[];
  tracks: readonly CanonicalTrackProjection[];
  assignments: readonly CanonicalAssignmentProjection[];
} {
  const trackOrdinalById = prepared.ordinals.trackOrdinalById;
  const performerById = new Map(prepared.input.performers.map((performer) => [performer.id, performer]));
  const assignmentByTrack = new Map(prepared.input.assignments.map((assignment) => [assignment.trackPlanId, assignment]));
  const tracks = prepared.input.trackPlans
    .slice()
    .sort((left, right) => left.canonicalOrdinal - right.canonicalOrdinal)
    .map((track): CanonicalTrackProjection => ({ trackOrdinal: track.canonicalOrdinal, kind: track.kind, enabled: track.enabled }));
  const assignments = tracks.flatMap((track): readonly CanonicalAssignmentProjection[] => {
    const plan = prepared.input.trackPlans.find((candidate) => candidate.canonicalOrdinal === track.trackOrdinal);
    const assignment = plan ? assignmentByTrack.get(plan.id) : undefined;
    return assignment ? [{ trackOrdinal: track.trackOrdinal, performerOrdinal: track.trackOrdinal }] : [];
  });
  const performers = assignments.map((assignment): CanonicalPerformerProjection => {
    const trackId = Object.keys(trackOrdinalById).find((id) => trackOrdinalById[id] === assignment.trackOrdinal);
    const performerId = trackId ? assignmentByTrack.get(trackId)?.performerId : undefined;
    const performer = performerId ? performerById.get(performerId) : undefined;
    if (!performer) throw new RangeError("TRACK_ASSIGNMENT_INVALID");
    return {
      performerOrdinal: assignment.performerOrdinal,
      hardRange: performer.hardRange,
      comfortableRange: performer.comfortableRange,
      preferredTessitura: performer.preferredTessitura ?? null,
    };
  });
  return { performers, tracks, assignments };
}

function diagnosticInput(code: DiagnosticCode, phraseId?: string, details?: Readonly<Record<string, string | number | boolean>>): Omit<Diagnostic, "id"> {
  return { code, severity: "blocking", messageKo: code, ...(phraseId ? { location: { phraseId } } : {}), ...(details ? { details } : {}) };
}

async function expectedIntentInputDigest(prepared: PreparedWagLifecycle): Promise<SemanticDigest> {
  const input = prepared.input;
  return digestIntentInput({
    musicalSourceDigest: input.source.revisionDigest,
    effectiveChordTimelineDigest: input.effectiveChordTimeline.digest,
    sourceLeadAtomizationDigest: input.sourceLeadAtomization.digest,
    atomizerVersion: input.sourceLeadAtomization.atomizerVersion,
    ...canonicalInputProjections(prepared),
    mode: input.effectiveConfig.mode,
    userCaps: input.userCaps,
    presetId: input.effectiveConfig.presetId,
    effectiveConfigDigest: input.effectiveConfig.digest,
    presetProfileVersion: input.effectiveConfig.presetProfileVersion,
    presetProfileDigest: input.effectiveConfig.presetProfileDigest,
    locks: prepared.locks.intent,
    plannerVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.plannerVersion,
    grammarVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.grammarVersion,
    plannerConfigDigest: prepared.authority.wagOwnedConfigDigests.plannerConfigDigest,
    grammarConfigDigest: prepared.authority.wagOwnedConfigDigests.grammarConfigDigest,
    diagnosticRegistryVersion: prepared.authority.diagnostics.registryVersion,
    diagnosticRegistryDigest: prepared.authority.diagnostics.registryDigest,
  }, prepared.ordinals);
}

async function expectedActivityInputDigest(prepared: PreparedWagLifecycle, intentPlanDigest: SemanticDigest): Promise<SemanticDigest> {
  const input = prepared.input;
  return digestActivityInput({
    intentPlanDigest,
    sourceLeadAtomizationDigest: input.sourceLeadAtomization.digest,
    atomizerVersion: input.sourceLeadAtomization.atomizerVersion,
    effectiveConfigDigest: input.effectiveConfig.digest,
    presetProfileVersion: input.effectiveConfig.presetProfileVersion,
    presetProfileDigest: input.effectiveConfig.presetProfileDigest,
    locks: prepared.locks.activity,
    activityPlannerVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.activityPlannerVersion,
    activityPlannerConfigDigest: prepared.authority.wagOwnedConfigDigests.activityPlannerConfigDigest,
    diagnosticRegistryVersion: prepared.authority.diagnostics.registryVersion,
    diagnosticRegistryDigest: prepared.authority.diagnostics.registryDigest,
  }, prepared.ordinals);
}

async function expectedAnchorInputDigest(prepared: PreparedWagLifecycle, activityPlanDigest: SemanticDigest): Promise<SemanticDigest> {
  const input = prepared.input;
  return digestAnchorInput({
    activityPlanDigest,
    sourceLeadAtomizationDigest: input.sourceLeadAtomization.digest,
    atomizerVersion: input.sourceLeadAtomization.atomizerVersion,
    effectiveConfigDigest: input.effectiveConfig.digest,
    presetProfileVersion: input.effectiveConfig.presetProfileVersion,
    presetProfileDigest: input.effectiveConfig.presetProfileDigest,
    locks: prepared.locks.anchor,
    anchorPlannerVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.anchorPlannerVersion,
    anchorPlannerConfigDigest: prepared.authority.wagOwnedConfigDigests.anchorPlannerConfigDigest,
    diagnosticRegistryVersion: prepared.authority.diagnostics.registryVersion,
    diagnosticRegistryDigest: prepared.authority.diagnostics.registryDigest,
  }, prepared.ordinals);
}

export async function wagIntentAuthorityMatches(
  prepared: PreparedWagLifecycle,
  intentPlan: ArrangementIntentPlan,
): Promise<boolean> {
  try {
    return intentPlan.stage === "intent"
      && intentPlan.grammarId === "worship-arrangement-grammar-v1"
      && intentPlan.intentPlanDigest === await digestIntentPlan(intentPlan, prepared.ordinals)
      && intentPlan.intentInputDigest === await expectedIntentInputDigest(prepared)
      && intentPlan.presetId === prepared.input.effectiveConfig.presetId
      && intentPlan.effectiveChordTimelineDigest === prepared.input.effectiveChordTimeline.digest
      && intentPlan.sourceLeadAtomizationDigest === prepared.input.sourceLeadAtomization.digest
      && intentPlan.effectiveConfigDigest === prepared.input.effectiveConfig.digest
      && intentPlan.presetProfileVersion === prepared.input.effectiveConfig.presetProfileVersion
      && intentPlan.presetProfileDigest === prepared.input.effectiveConfig.presetProfileDigest
      && intentPlan.grammarVersion === APPLICATION_ALGORITHM_VERSION_REGISTRY.grammarVersion
      && intentPlan.plannerVersion === APPLICATION_ALGORITHM_VERSION_REGISTRY.plannerVersion
      && intentPlan.grammarConfigDigest === prepared.authority.wagOwnedConfigDigests.grammarConfigDigest
      && intentPlan.plannerConfigDigest === prepared.authority.wagOwnedConfigDigests.plannerConfigDigest
      && intentPlan.diagnosticRegistryVersion === prepared.authority.diagnostics.registryVersion
      && intentPlan.diagnosticRegistryDigest === prepared.authority.diagnostics.registryDigest
      && (!intentPlan.grammarTrace
        || intentPlan.grammarTrace.grammarVersion === APPLICATION_ALGORITHM_VERSION_REGISTRY.grammarVersion);
  } catch {
    return false;
  }
}

export async function wagActivityAuthorityMatches(
  prepared: PreparedWagLifecycle,
  intentPlan: ArrangementIntentPlan,
  activityPlan: ArrangementActivityPlan,
): Promise<boolean> {
  try {
    return await wagIntentAuthorityMatches(prepared, intentPlan)
      && activityPlan.stage === "activity-realized"
      && activityPlan.activityPlanDigest === await digestActivityPlan(activityPlan, prepared.ordinals)
      && activityPlan.intentPlanDigest === intentPlan.intentPlanDigest
      && activityPlan.activityInputDigest === await expectedActivityInputDigest(prepared, intentPlan.intentPlanDigest)
      && activityPlan.presetId === prepared.input.effectiveConfig.presetId
      && activityPlan.sourceLeadAtomizationDigest === prepared.input.sourceLeadAtomization.digest
      && activityPlan.effectiveConfigDigest === prepared.input.effectiveConfig.digest
      && activityPlan.presetProfileDigest === prepared.input.effectiveConfig.presetProfileDigest
      && activityPlan.activityPlannerVersion === APPLICATION_ALGORITHM_VERSION_REGISTRY.activityPlannerVersion
      && activityPlan.activityPlannerConfigDigest === prepared.authority.wagOwnedConfigDigests.activityPlannerConfigDigest
      && activityPlan.diagnosticRegistryVersion === prepared.authority.diagnostics.registryVersion
      && activityPlan.diagnosticRegistryDigest === prepared.authority.diagnostics.registryDigest;
  } catch {
    return false;
  }
}

export async function wagAnchorAuthorityMatches(
  prepared: PreparedWagLifecycle,
  intentPlan: ArrangementIntentPlan,
  activityPlan: ArrangementActivityPlan,
  anchorPlan: ArrangementAnchorPlan,
): Promise<boolean> {
  try {
    return await wagActivityAuthorityMatches(prepared, intentPlan, activityPlan)
      && anchorPlan.stage === "anchor-realized"
      && anchorPlan.anchorPlanDigest === await digestAnchorPlan(anchorPlan, prepared.ordinals)
      && anchorPlan.activityPlanDigest === activityPlan.activityPlanDigest
      && anchorPlan.anchorInputDigest === await expectedAnchorInputDigest(prepared, activityPlan.activityPlanDigest)
      && anchorPlan.presetId === prepared.input.effectiveConfig.presetId
      && anchorPlan.sourceLeadAtomizationDigest === prepared.input.sourceLeadAtomization.digest
      && anchorPlan.effectiveConfigDigest === prepared.input.effectiveConfig.digest
      && anchorPlan.presetProfileDigest === prepared.input.effectiveConfig.presetProfileDigest
      && anchorPlan.anchorPlannerVersion === APPLICATION_ALGORITHM_VERSION_REGISTRY.anchorPlannerVersion
      && anchorPlan.anchorPlannerConfigDigest === prepared.authority.wagOwnedConfigDigests.anchorPlannerConfigDigest
      && anchorPlan.diagnosticRegistryVersion === prepared.authority.diagnostics.registryVersion
      && anchorPlan.diagnosticRegistryDigest === prepared.authority.diagnostics.registryDigest;
  } catch {
    return false;
  }
}

export async function planWagIntent(input: WagLifecycleInput): Promise<StageExecutionResult<ArrangementIntentPlan>> {
  const preparedResult = await prepareWagLifecycle(input);
  if (preparedResult.status === "blocked") return preparedResult;
  const prepared = preparedResult.value;
  const intentInputDigest = await expectedIntentInputDigest(prepared);

  const sectionIntents: SectionArrangementIntent[] = prepared.sections.map((section, sectionOrdinal) => {
    const target = intensityBase(input.effectiveConfig.maxHarmonyTracks);
    return {
      id: sectionIntentId(input.effectiveConfig.presetId, sectionOrdinal),
      sectionOccurrenceId: section.id,
      presetId: input.effectiveConfig.presetId,
      intensityTarget: {
        participationCoverageBp: basisPoints(target.participation),
        harmonicDivergenceCoverageBp: basisPoints(target.divergence),
        exactlyTwoPitchCoverageBp: basisPoints(target.exactlyTwo),
        exactlyThreePitchCoverageBp: basisPoints(target.exactlyThree),
        maxHarmonyAttackRatioBp: input.effectiveConfig.maxHarmonyAttackRatioBp,
        registerSpreadRange: sectionSpreadRange(prepared, section),
        maxActiveVoiceCount: target.active,
      },
      grammarRuleIds: ["WAG_V1_0_1_SECTION_INTENSITY"],
    };
  });

  const phraseIntents: PhraseArrangementIntent[] = [];
  const traceByPhrase: Record<string, readonly import("../domain/plans").GrammarCandidateTrace[]> = {};
  const previousRoleByTrack: Record<string, VocalPlacementRole | undefined> = {};
  const roleChangeCountBySection: Record<string, number> = {};
  const rawDiagnostics: Omit<Diagnostic, "id">[] = [];
  for (let phraseOrdinal = 0; phraseOrdinal < prepared.phrases.length; phraseOrdinal += 1) {
    const phrase = prepared.phrases[phraseOrdinal];
    const section = prepared.sectionByPhraseId[phrase.id];
    const sectionIntent = sectionIntents[prepared.ordinals.sectionOccurrenceOrdinalById[section.id]];
    const textureLocks = prepared.locks.intent.filter((lock): lock is TextureLock => lock.kind === "texture" && lock.phraseId === phrase.id);
    if (textureLocks.length > 1 && new Set(textureLocks.map((lock) => lock.textureId)).size > 1) {
      rawDiagnostics.push(diagnosticInput("NO_ELIGIBLE_TEXTURE", phrase.id));
      continue;
    }
    const lockedTexture = textureLocks[0]?.textureId;
    if (lockedTexture && lockedTexture !== "UNISON" && lockedTexture !== "TWO_PART_PARALLEL") {
      rawDiagnostics.push(diagnosticInput("STAGE_LOCK_SCOPE_INVALID", phrase.id, { stage: "intent", reason: "UNSUPPORTED_WAG_V1_TEXTURE_LOCK" }));
      continue;
    }
    const baseExpectation = input.effectiveConfig.maxHarmonyTracks > 0
      && prepared.assignedTracks.length > 0
      && phraseHasPerceptibleEligibleGrid(prepared, phrase)
      ? "H1-required" as const
      : "none" as const;
    const harmonyExpectation = lockedTexture === "UNISON" ? "none" as const : baseExpectation;
    const previews = harmonyExpectation === "none"
      ? []
      : roleHypotheses(prepared, phrase).map((mapping) => evaluateRoleMapping(prepared, phrase, mapping, previousRoleByTrack));
    previews.sort((left, right) => compareTuple(left.tuple, right.tuple));
    const currentChanges = roleChangeCountBySection[section.id] ?? 0;
    const winner = previews.find((preview) => preview.blockingDecisionCount === 0
      && currentChanges + preview.roleChangeCount <= input.effectiveConfig.maxRoleChangesPerSection);
    if (harmonyExpectation === "H1-required" && !winner) {
      rawDiagnostics.push(diagnosticInput("TRACK_ROLE_CONFLICT", phrase.id));
      continue;
    }
    const mapping = winner?.mapping ?? [];
    const trackRoles: TrackRoleSegment[] = mapping
      .slice()
      .sort((left, right) => left.trackPlan.canonicalOrdinal - right.trackPlan.canonicalOrdinal)
      .map((entry) => ({
        id: trackRoleSegmentId(input.effectiveConfig.presetId, phraseOrdinal, entry.trackPlan.canonicalOrdinal),
        phraseId: phrase.id,
        trackPlanId: entry.trackPlan.id,
        placementRole: entry.placementRole,
      }));
    for (const role of trackRoles) previousRoleByTrack[role.trackPlanId] = role.placementRole;
    roleChangeCountBySection[section.id] = currentChanges + (winner?.roleChangeCount ?? 0);
    phraseIntents.push({
      id: phraseIntentId(input.effectiveConfig.presetId, phraseOrdinal),
      phraseId: phrase.id,
      presetId: input.effectiveConfig.presetId,
      sectionIntentId: sectionIntent.id,
      textureId: harmonyExpectation === "none" ? "UNISON" : "TWO_PART_PARALLEL",
      harmonyExpectation,
      trackRoles,
      lyricPolicy: "same-lyrics",
      cadencePolicy: cadencePolicy(prepared, phrase, section),
      grammarRuleIds: ["WAG_V1_0_1_ROLE_PREVIEW"],
    });
    traceByPhrase[phrase.id] = previews.map((preview, previewOrdinal) => ({
      id: `gct:${input.effectiveConfig.presetId}:${phraseOrdinal}:${previewOrdinal}`,
      phraseId: phrase.id,
      presetId: input.effectiveConfig.presetId,
      textureId: "TWO_PART_PARALLEL",
      eligible: preview === winner,
      score: 0 as import("../domain/rates").CostUnit,
      reasonCodes: preview === winner ? [] : ["ROLE_PREVIEW_NOT_SELECTED"],
    }));
  }
  if (rawDiagnostics.length > 0) {
    return { status: "blocked", diagnostics: await createDiagnostics(rawDiagnostics, prepared.authority.diagnostics) };
  }
  const withoutDigest: ArrangementIntentPlan = {
    stage: "intent",
    presetId: input.effectiveConfig.presetId,
    intentInputDigest,
    effectiveChordTimelineDigest: input.effectiveChordTimeline.digest,
    sourceLeadAtomizationDigest: input.sourceLeadAtomization.digest,
    effectiveConfigDigest: input.effectiveConfig.digest,
    presetProfileVersion: input.effectiveConfig.presetProfileVersion,
    presetProfileDigest: input.effectiveConfig.presetProfileDigest,
    grammarId: "worship-arrangement-grammar-v1",
    grammarVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.grammarVersion,
    plannerVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.plannerVersion,
    grammarConfigDigest: prepared.authority.wagOwnedConfigDigests.grammarConfigDigest,
    plannerConfigDigest: prepared.authority.wagOwnedConfigDigests.plannerConfigDigest,
    diagnosticRegistryVersion: prepared.authority.diagnostics.registryVersion,
    diagnosticRegistryDigest: prepared.authority.diagnostics.registryDigest,
    sectionIntents,
    phraseIntents,
    grammarTrace: { grammarVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.grammarVersion, candidatesByPhraseId: traceByPhrase },
    intentPlanDigest: "" as SemanticDigest,
  };
  const intentPlanDigest = await digestIntentPlan(withoutDigest, prepared.ordinals);
  return { status: "complete", value: { ...withoutDigest, intentPlanDigest }, diagnostics: [] };
}

function activityLockFor(
  locks: readonly ActivityLock[],
  phraseId: string,
  trackPlanId: string,
  range: MusicalRange,
): ActivityLock | undefined {
  const matches = locks.filter((lock) => lock.phraseId === phraseId
    && lock.trackPlanId === trackPlanId && rangeContains(lock.range, range));
  if (matches.length > 1 && new Set(matches.map((lock) => JSON.stringify(lock.activity))).size > 1) {
    throw new RangeError("STAGE_LOCK_SCOPE_INVALID");
  }
  return matches[0];
}

function sameActivity(left: VoiceActivityDirective, right: VoiceActivityDirective): boolean {
  return left.state === right.state && (left.state === "rest" || JSON.stringify(left) === JSON.stringify(right));
}

function coalesceSpans(spans: readonly MutableSpan[]): readonly MutableSpan[] {
  const ordered = spans.slice().sort((left, right) =>
    (left.trackPlanId < right.trackPlanId ? -1 : left.trackPlanId > right.trackPlanId ? 1 : 0)
    || compareRanges(left.range, right.range));
  const result: MutableSpan[] = [];
  for (const span of ordered) {
    const previous = result.at(-1);
    if (previous && previous.trackPlanId === span.trackPlanId
      && positionEqual(previous.range.end, span.range.start)
      && sameActivity(previous.activity, span.activity)) {
      previous.range = musicalRange(previous.range.start, span.range.end);
    } else result.push({ ...span });
  }
  return result;
}

function activityMetrics(
  prepared: PreparedWagLifecycle,
  phrase: PhraseRegion,
  spans: readonly VoiceActivitySpan[],
  attacks: readonly VoiceAttackEvent[],
): PhraseActivityPlan["realizedMetrics"] {
  const decisions = localDecisionsForPhrase(prepared, phrase, spans.flatMap((span) => [span.range.start, span.range.end]));
  let leadDuration = fraction(0);
  let leadRestDuration = fraction(0);
  let participationDuration = fraction(0);
  let harmonyOverRestDuration = fraction(0);
  let leadAttacks = 0;
  let maxSimultaneous = 0;
  for (const decision of decisions) {
    const duration = rangeDuration(decision.range, prepared.measureDurations);
    const active = spans.filter((span) => rangeContains(span.range, decision.range) && span.activity.state !== "rest").length;
    maxSimultaneous = Math.max(maxSimultaneous, active);
    if (decision.atom.pitch) {
      leadDuration = addDuration(leadDuration, duration);
      if (active > 0) participationDuration = addDuration(participationDuration, duration);
      if (positionEqual(decision.range.start, decision.atom.range.start) && !decision.atom.tiedFromPrevious) leadAttacks += 1;
    } else {
      leadRestDuration = addDuration(leadRestDuration, duration);
      if (active > 0) harmonyOverRestDuration = addDuration(harmonyOverRestDuration, duration);
    }
  }
  const harmonyAttacks = attacks.filter((event) => event.kind !== "release").length;
  return {
    participationCoverage: durationRate(participationDuration, leadDuration),
    harmonyAttackRatio: extendedCountRate(harmonyAttacks, leadAttacks),
    harmonyOverLeadRestCoverage: durationRate(harmonyOverRestDuration, leadRestDuration),
    maxSimultaneousHarmonyTracks: Math.min(2, maxSimultaneous) as 0 | 1 | 2,
  };
}

export async function planWagActivity(
  input: WagLifecycleInput,
  intentPlan: ArrangementIntentPlan,
): Promise<StageExecutionResult<ArrangementActivityPlan>> {
  const preparedResult = await prepareWagLifecycle(input);
  if (preparedResult.status === "blocked") return preparedResult;
  const prepared = preparedResult.value;
  if (!await wagIntentAuthorityMatches(prepared, intentPlan)) {
    return { status: "blocked", diagnostics: await createDiagnostics([
      diagnosticInput("ALGORITHM_CONFIG_MISMATCH", undefined, { stage: "activity", reason: "INTENT_PLAN_DIGEST_MISMATCH" }),
    ], prepared.authority.diagnostics) };
  }
  const activityInputDigest = await expectedActivityInputDigest(prepared, intentPlan.intentPlanDigest);
  const phraseActivityPlans: PhraseActivityPlan[] = [];
  const rawDiagnostics: Omit<Diagnostic, "id">[] = [];
  const consumedActivityLockIds = new Set<string>();
  for (const phrase of prepared.phrases) {
    const phraseOrdinal = prepared.ordinals.phraseOrdinalById[phrase.id];
    const intent = intentPlan.phraseIntents.find((candidate) => candidate.phraseId === phrase.id);
    if (!intent) {
      rawDiagnostics.push(diagnosticInput("STALE_REFERENCE", phrase.id));
      continue;
    }
    const boundaries = prepared.locks.activity
      .filter((lock) => lock.phraseId === phrase.id)
      .flatMap((lock) => [lock.range.start, lock.range.end]);
    const decisions = localDecisionsForPhrase(prepared, phrase, boundaries);
    const roleByTrack = Object.fromEntries(intent.trackRoles.map((role) => [role.trackPlanId, role.placementRole]));
    const mutableSpans: MutableSpan[] = [];
    const attackEvents: VoiceAttackEvent[] = [];
    const decisionEvidence: LocalRestDecisionEvidence[] = [];
    for (const assigned of prepared.assignedTracks) {
      const role = roleByTrack[assigned.trackPlan.id] as VocalPlacementRole | undefined;
      let previous: SpelledPitch | undefined;
      let continuity: "continuous" | "reentry" | "initial" = "initial";
      let previousState: VoiceActivityDirective["state"] = "rest";
      for (const decision of decisions) {
        const lock = activityLockFor(prepared.locks.activity, phrase.id, assigned.trackPlan.id, decision.range);
        if (lock) consumedActivityLockIds.add(lock.id);
        let activity: VoiceActivityDirective = { state: "rest" };
        let selection: LocalSelectionResult | undefined;
        if (lock && lock.activity.state !== "rest" && lock.activity.state !== "independent-note") {
          rawDiagnostics.push(diagnosticInput("STAGE_LOCK_SCOPE_INVALID", phrase.id, { stage: "activity", lockId: lock.id, reason: "UNSUPPORTED_WAG_V1_ACTIVITY" }));
          continue;
        }
        if (!role && lock?.activity.state === "independent-note") {
          rawDiagnostics.push(diagnosticInput("STAGE_LOCK_SCOPE_INVALID", phrase.id, { stage: "activity", lockId: lock.id, reason: "INACTIVE_TRACK_SOUNDING" }));
          continue;
        }
        if (role && isChordEligible(decision) && lock?.activity.state !== "rest") {
          selection = selectLocalHarmonyDecision(
            localContext(prepared, decision, assigned.trackPlan.id, role, previous, continuity),
            decision.chordSpan.parseResult.chord,
            assigned.performer,
            input.effectiveConfig,
            { restFallback: lock?.activity.state === "independent-note" ? "forbidden" : "permitted" },
          );
          if (selection.status === "note") activity = { state: "independent-note", behavior: "independent-harmony" };
          else if (selection.status === "blocked") {
            rawDiagnostics.push(diagnosticInput("STAGE_LOCK_SCOPE_INVALID", phrase.id, {
              stage: "activity", lockId: lock?.id ?? "none", reason: "LOCK_INDUCED_NO_LEGAL_CANDIDATE",
            }));
            continue;
          } else {
            decisionEvidence.push({
              range: decision.range,
              trackPlanId: assigned.trackPlan.id,
              placementRole: role,
              reason: "LOCAL_REST_HARD_IMPOSSIBILITY",
              continuityState: continuity,
              hardLegalCandidateCount: 0,
              sourceToneSpellingExclusionCount: selection.sourceToneExclusions.length,
            });
          }
        }
        mutableSpans.push({ trackPlanId: assigned.trackPlan.id, range: decision.range, activity });
        if (activity.state === "independent-note") {
          const kind: VoiceAttackEvent["kind"] | undefined = previousState === "rest"
            ? (continuity === "initial" ? "attack" : "reentry")
            : decision.lyricOnset ? "attack" : undefined;
          if (kind) attackEvents.push({
            id: voiceAttackEventId(input.effectiveConfig.presetId, phraseOrdinal, assigned.trackPlan.canonicalOrdinal, decision.range.start, kind),
            trackPlanId: assigned.trackPlan.id,
            position: decision.range.start,
            kind,
          });
          previous = selection?.status === "note" ? selection.selected.pitch : previous;
          continuity = "continuous";
        } else {
          if (previousState === "independent-note") attackEvents.push({
            id: voiceAttackEventId(input.effectiveConfig.presetId, phraseOrdinal, assigned.trackPlan.canonicalOrdinal, decision.range.start, "release"),
            trackPlanId: assigned.trackPlan.id,
            position: decision.range.start,
            kind: "release",
          });
          previous = undefined;
          continuity = continuity === "initial" ? "initial" : "reentry";
        }
        previousState = activity.state;
      }
      if (previousState === "independent-note") attackEvents.push({
        id: voiceAttackEventId(input.effectiveConfig.presetId, phraseOrdinal, assigned.trackPlan.canonicalOrdinal, phrase.range.end, "release"),
        trackPlanId: assigned.trackPlan.id,
        position: phrase.range.end,
        kind: "release",
      });
    }
    const coalesced = coalesceSpans(mutableSpans);
    const activitySpans: VoiceActivitySpan[] = coalesced.map((span) => {
      const track = prepared.trackById[span.trackPlanId];
      if (!track || track.kind !== "generated-harmony") throw new RangeError("TRACK_PLAN_MISSING");
      return {
        id: voiceActivitySpanId(input.effectiveConfig.presetId, phraseOrdinal, track.canonicalOrdinal, span.range.start, span.range.end),
        ...span,
      };
    });
    const orderedAttacks = attackEvents.sort((left, right) => comparePositions(left.position, right.position)
      || (prepared.ordinals.trackOrdinalById[left.trackPlanId] - prepared.ordinals.trackOrdinalById[right.trackPlanId])
      || left.kind.localeCompare(right.kind));
    phraseActivityPlans.push({
      id: phraseActivityPlanId(input.effectiveConfig.presetId, phraseOrdinal),
      phraseId: phrase.id,
      intentId: intent.id,
      activitySpans,
      attackEvents: orderedAttacks,
      realizedMetrics: activityMetrics(prepared, phrase, activitySpans, orderedAttacks),
      decisionEvidence: decisionEvidence.sort((left, right) => compareRanges(left.range, right.range)
        || prepared.ordinals.trackOrdinalById[left.trackPlanId] - prepared.ordinals.trackOrdinalById[right.trackPlanId]),
    });
  }
  for (const lock of prepared.locks.activity) {
    if (!consumedActivityLockIds.has(lock.id)) rawDiagnostics.push(diagnosticInput("STAGE_LOCK_SCOPE_INVALID", lock.phraseId, {
      stage: "activity", lockId: lock.id, reason: "LOCK_TARGET_NOT_MATERIALIZED",
    }));
  }
  if (rawDiagnostics.length > 0) {
    return { status: "blocked", diagnostics: await createDiagnostics(rawDiagnostics, prepared.authority.diagnostics) };
  }
  const withoutDigest: ArrangementActivityPlan = {
    stage: "activity-realized",
    presetId: input.effectiveConfig.presetId,
    intentPlanDigest: intentPlan.intentPlanDigest,
    activityInputDigest,
    activityPlannerVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.activityPlannerVersion,
    activityPlannerConfigDigest: prepared.authority.wagOwnedConfigDigests.activityPlannerConfigDigest,
    diagnosticRegistryVersion: prepared.authority.diagnostics.registryVersion,
    diagnosticRegistryDigest: prepared.authority.diagnostics.registryDigest,
    sourceLeadAtomizationDigest: input.sourceLeadAtomization.digest,
    effectiveConfigDigest: input.effectiveConfig.digest,
    presetProfileDigest: input.effectiveConfig.presetProfileDigest,
    phraseActivityPlans,
    activityPlanDigest: "" as SemanticDigest,
  };
  const activityPlanDigest = await digestActivityPlan(withoutDigest, prepared.ordinals);
  return { status: "complete", value: { ...withoutDigest, activityPlanDigest }, diagnostics: [] };
}

function toneEqual(
  left: import("../domain/chord/model").ChordToneSpec,
  right: import("../domain/chord/model").ChordToneSpec,
): boolean {
  return left.degree === right.degree
    && left.alteration === right.alteration
    && left.role === right.role
    && left.origin === right.origin;
}

function anchorLocksAt(
  locks: readonly AnchorLock[],
  phraseId: string,
  trackPlanId: string,
  position: MusicalPosition,
): readonly AnchorLock[] {
  return locks.filter((lock) => lock.phraseId === phraseId
    && lock.trackPlanId === trackPlanId
    && positionEqual(lock.position, position));
}

export async function planWagAnchor(
  input: WagLifecycleInput,
  intentPlan: ArrangementIntentPlan,
  activityPlan: ArrangementActivityPlan,
): Promise<StageExecutionResult<ArrangementAnchorPlan>> {
  const preparedResult = await prepareWagLifecycle(input);
  if (preparedResult.status === "blocked") return preparedResult;
  const prepared = preparedResult.value;
  if (!await wagActivityAuthorityMatches(prepared, intentPlan, activityPlan)) {
    return { status: "blocked", diagnostics: await createDiagnostics([
      diagnosticInput("ALGORITHM_CONFIG_MISMATCH", undefined, { stage: "anchor", reason: "ACTIVITY_PLAN_DIGEST_MISMATCH" }),
    ], prepared.authority.diagnostics) };
  }
  const anchorInputDigest = await expectedAnchorInputDigest(prepared, activityPlan.activityPlanDigest);
  const phraseAnchorPlans: PhraseAnchorPlan[] = [];
  const rawDiagnostics: Omit<Diagnostic, "id">[] = [];
  const consumedAnchorLockIds = new Set<string>();
  let directiveOrdinal = 0;
  for (const phrase of prepared.phrases) {
    const phraseOrdinal = prepared.ordinals.phraseOrdinalById[phrase.id];
    const phraseActivity = activityPlan.phraseActivityPlans.find((candidate) => candidate.phraseId === phrase.id);
    if (!phraseActivity) {
      rawDiagnostics.push(diagnosticInput("STALE_REFERENCE", phrase.id));
      continue;
    }
    const boundaries = [
      ...phraseActivity.activitySpans.flatMap((span) => [span.range.start, span.range.end]),
      ...prepared.locks.anchor.filter((lock) => lock.phraseId === phrase.id).map((lock) => lock.position),
    ];
    const decisions = localDecisionsForPhrase(prepared, phrase, boundaries);
    const directives: import("../domain/plans").HarmonyAnchorDirective[] = [];
    for (const assigned of prepared.assignedTracks) {
      const role = placementRoleFor(intentPlan, phrase.id, assigned.trackPlan.id);
      let previous: SpelledPitch | undefined;
      let continuity: "continuous" | "reentry" | "initial" = "initial";
      let divergenceLockId: string | undefined;
      for (const decision of decisions) {
        const activity = activityAt(activityPlan, phrase.id, assigned.trackPlan.id, decision.range);
        const locks = anchorLocksAt(prepared.locks.anchor, phrase.id, assigned.trackPlan.id, decision.range.start);
        locks.forEach((lock) => consumedAnchorLockIds.add(lock.id));
        if (locks.length > 1) {
          rawDiagnostics.push(diagnosticInput("STAGE_LOCK_SCOPE_INVALID", phrase.id, { stage: "anchor", reason: "MULTIPLE_ANCHOR_LOCKS", trackPlanId: assigned.trackPlan.id }));
          continue;
        }
        const lock = locks[0];
        if (activity?.state !== "independent-note") {
          if (lock) rawDiagnostics.push(diagnosticInput("STAGE_LOCK_SCOPE_INVALID", phrase.id, { stage: "anchor", lockId: lock.id, reason: "ANCHOR_ON_REST" }));
          previous = undefined;
          continuity = continuity === "initial" ? "initial" : "reentry";
          continue;
        }
        if (!role || !isChordEligible(decision)) {
          rawDiagnostics.push(diagnosticInput("WAG_V1_ACTIVITY_ANCHOR_FEASIBILITY_PARITY_MISMATCH", phrase.id, { trackPlanId: assigned.trackPlan.id }));
          continue;
        }
        if (lock && lock.kind !== "anchor-chord-tone") {
          rawDiagnostics.push(diagnosticInput("STAGE_LOCK_SCOPE_INVALID", phrase.id, { stage: "anchor", lockId: lock.id, reason: "UNSUPPORTED_WAG_V1_ANCHOR" }));
          continue;
        }
        const selection = selectLocalHarmonyDecision(
          localContext(prepared, decision, assigned.trackPlan.id, role, previous, continuity),
          decision.chordSpan.parseResult.chord,
          assigned.performer,
          input.effectiveConfig,
          { restFallback: "forbidden" },
        );
        if (selection.status !== "note") {
          if (lock || divergenceLockId) {
            rawDiagnostics.push(diagnosticInput("STAGE_LOCK_SCOPE_INVALID", phrase.id, {
              stage: "anchor",
              lockId: lock?.id ?? divergenceLockId ?? "none",
              reason: "LOCK_INDUCED_NO_LEGAL_CANDIDATE",
            }));
          } else {
            rawDiagnostics.push(diagnosticInput("WAG_V1_ACTIVITY_ANCHOR_FEASIBILITY_PARITY_MISMATCH", phrase.id, { trackPlanId: assigned.trackPlan.id }));
          }
          continue;
        }
        const selected = lock
          ? selection.candidates.find((candidate) => lock.chordSpanId === decision.chordSpan.id && toneEqual(candidate.tone, lock.selectedTone))
          : selection.selected;
        if (!selected) {
          rawDiagnostics.push(diagnosticInput("STAGE_LOCK_SCOPE_INVALID", phrase.id, { stage: "anchor", lockId: lock?.id ?? "none", reason: "LOCK_INDUCED_NO_LEGAL_CANDIDATE" }));
          continue;
        }
        if (lock && !toneEqual(selected.tone, selection.selected.tone)) divergenceLockId = lock.id;
        directives.push({
          kind: "chord-tone",
          id: anchorDirectiveId(input.effectiveConfig.presetId, phraseOrdinal, assigned.trackPlan.canonicalOrdinal, decision.range.start, directiveOrdinal),
          trackPlanId: assigned.trackPlan.id,
          position: decision.range.start,
          chordSpanId: decision.chordSpan.id,
          selectedTone: selected.tone,
        });
        directiveOrdinal += 1;
        previous = selected.pitch;
        continuity = "continuous";
      }
    }
    phraseAnchorPlans.push({
      id: phraseAnchorPlanId(input.effectiveConfig.presetId, phraseOrdinal),
      phraseId: phrase.id,
      activityPlanId: phraseActivity.id,
      anchorDirectives: directives,
      nctPlans: [],
    });
  }
  for (const lock of prepared.locks.anchor) {
    if (!consumedAnchorLockIds.has(lock.id)) rawDiagnostics.push(diagnosticInput("STAGE_LOCK_SCOPE_INVALID", lock.phraseId, {
      stage: "anchor", lockId: lock.id, reason: "LOCK_TARGET_NOT_MATERIALIZED",
    }));
  }
  if (rawDiagnostics.length > 0) {
    return { status: "blocked", diagnostics: await createDiagnostics(rawDiagnostics, prepared.authority.diagnostics) };
  }
  const withoutDigest: ArrangementAnchorPlan = {
    stage: "anchor-realized",
    presetId: input.effectiveConfig.presetId,
    activityPlanDigest: activityPlan.activityPlanDigest,
    anchorInputDigest,
    anchorPlannerVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.anchorPlannerVersion,
    anchorPlannerConfigDigest: prepared.authority.wagOwnedConfigDigests.anchorPlannerConfigDigest,
    diagnosticRegistryVersion: prepared.authority.diagnostics.registryVersion,
    diagnosticRegistryDigest: prepared.authority.diagnostics.registryDigest,
    sourceLeadAtomizationDigest: input.sourceLeadAtomization.digest,
    effectiveConfigDigest: input.effectiveConfig.digest,
    presetProfileDigest: input.effectiveConfig.presetProfileDigest,
    phraseAnchorPlans,
    anchorPlanDigest: "" as SemanticDigest,
  };
  const anchorPlanDigest = await digestAnchorPlan(withoutDigest, prepared.ordinals);
  return { status: "complete", value: { ...withoutDigest, anchorPlanDigest }, diagnostics: [] };
}

export function placementRoleFor(
  intentPlan: ArrangementIntentPlan,
  phraseId: string,
  trackPlanId: string,
): VocalPlacementRole | undefined {
  return intentPlan.phraseIntents.find((intent) => intent.phraseId === phraseId)
    ?.trackRoles.find((role) => role.trackPlanId === trackPlanId)?.placementRole;
}

export function activityAt(
  activityPlan: ArrangementActivityPlan,
  phraseId: string,
  trackPlanId: string,
  range: MusicalRange,
): VoiceActivityDirective | undefined {
  return activityPlan.phraseActivityPlans.find((phrase) => phrase.phraseId === phraseId)
    ?.activitySpans.find((span) => span.trackPlanId === trackPlanId && rangeContains(span.range, range))?.activity;
}

export function performerForTrack(prepared: PreparedWagLifecycle, trackPlanId: string): PerformerProfile {
  const performer = prepared.performerByTrackId[trackPlanId];
  if (!performer) throw new RangeError(`TRACK_ASSIGNMENT_INVALID:${trackPlanId}`);
  return performer;
}

export function sectionDefinitionFor(
  prepared: PreparedWagLifecycle,
  section: SectionOccurrence,
): SectionDefinition {
  const definition = prepared.input.source.sectionDefinitions.find((candidate) => candidate.id === section.sectionDefinitionId);
  if (!definition) throw new RangeError("SECTION_COVERAGE_INVALID");
  return definition;
}

export function sectionMusicalRange(section: SectionOccurrence): MusicalRange {
  return sectionRange(section);
}
