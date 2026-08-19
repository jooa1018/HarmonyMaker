import { APPLICATION_ALGORITHM_VERSION_REGISTRY } from "../app/algorithm-version-registry";
import { parseChord } from "../domain/chord/parser";
import {
  resolveEffectiveArrangementConfig,
  type ArrangementPresetId,
} from "../domain/config";
import { digestMusicalSourceComponents } from "../domain/digest/source";
import { semanticDigest } from "../domain/digest/canonical";
import { computeSourceProvenanceDigest } from "../domain/source/provenance";
import { fraction, type Fraction } from "../domain/fraction";
import {
  digestPerformanceSequence,
  digestSourceChordProjection,
  resolveEffectiveChordTimeline,
} from "../domain/harmony/chord-timeline";
import {
  harmonyTrackId,
  leadEventId,
  lyricTokenId,
  performerId,
  phraseRegionId,
  sectionDefinitionId,
  sectionOccurrenceId,
  sourceChordEventId,
  sourceMeasureId,
} from "../domain/ids";
import type { ActivityLock, AnchorLock, PitchLock, VariantStageLocks } from "../domain/locks";
import { COMMON_TIME, type TimeSignature } from "../domain/meter";
import { expandRepeats } from "../domain/performance/repeat";
import {
  SOURCE_LEAD_TRACK,
  type PerformerProfile,
  type PerformerTrackAssignment,
  type VocalTrackPlan,
} from "../domain/performer";
import type { PitchRange, SpelledPitch } from "../domain/pitch";
import { atomizeSourceLead } from "../domain/source/atomization";
import type {
  LeadEvent,
  LyricToken,
  SectionType,
  SectionVariant,
  SongSourceDocument,
  SourceChordEvent,
  SourceMeasure,
} from "../domain/source/model";
import { musicalRange } from "../domain/time";
import { loadFrozenWagAuthority } from "./authority";
import type { WagLifecycleInput } from "./lifecycle";

export const REQUIRED_SEGMENT_B_FIXTURE_IDS = [
  "hm-original-major-stepwise-v0",
  "hm-original-minor-phrase-v0",
  "hm-original-slash-chord-v0",
  "hm-original-sus-omission-v0",
  "hm-original-add9-v0",
  "hm-original-lead-nct-passing-v0",
  "hm-original-held-common-tone-v0",
  "hm-original-held-no-common-upper-v0",
  "hm-original-held-no-common-lower-v0",
  "hm-original-upper-range-v0",
  "hm-original-lower-range-v0",
  "hm-original-hard-range-edge-v0",
  "hm-original-lead-only-negative-v0",
  "hm-original-accidental-root-spelling-v0",
  "hm-original-unrepresentable-spelling-v0",
  "hm-original-activity-hard-leap-dead-end-v0",
  "hm-original-lock-induced-no-candidate-v0",
  "hm-diagnostic-registry-merge-v0",
  "hm-segment-b-one-singer-upper-wins-v0",
  "hm-segment-b-one-singer-lower-wins-v0",
  "hm-segment-b-two-singer-bijections-v0",
  "hm-segment-b-all-nc-v0",
  "hm-segment-b-held-chord-boundary-v0",
  "hm-segment-b-held-phrase-section-boundary-v0",
  "hm-segment-b-activity-lock-impossible-v0",
  "hm-segment-b-activity-anchor-parity-v0",
  "hm-segment-b-anchor-lock-divergence-v0",
  "hm-segment-b-pitch-lock-valid-v0",
  "hm-segment-b-pitch-lock-invalid-v0",
  "hm-segment-b-non-perceptible-marginal-v0",
  "hm-segment-b-h1-required-lead-only-v0",
  "hm-segment-b-complete-h1-partial-peer-v0",
  "hm-segment-b-pair-accepted-v0",
  "hm-segment-b-pair-degraded-v0",
  "hm-segment-b-full-only-repair-corruption-v0",
  "hm-segment-b-upper-dropout-v0",
  "hm-segment-b-lower-dropout-v0",
  "hm-segment-b-lead-only-expectation-none-v0",
  "hm-segment-b-result-truth-table-v0",
  "hm-segment-b-candidate-order-v0",
  "hm-segment-b-accompaniment-nc-v0",
  "hm-segment-b-accompaniment-parity-v0",
  "hm-segment-b-validator-corruption-matrix-v0",
] as const;

export type SegmentBFixtureId = (typeof REQUIRED_SEGMENT_B_FIXTURE_IDS)[number];

export interface SegmentBFixtureExpectation {
  readonly fixtureId: SegmentBFixtureId;
  readonly expectedStatus: "complete" | "partial" | "blocked";
  readonly expectedOutcome: string;
  readonly expectedReason?: string;
  readonly expectedDiagnostic?: string;
}

export const SEGMENT_B_FIXTURE_EXPECTATIONS: Readonly<Record<SegmentBFixtureId, SegmentBFixtureExpectation>> =
  Object.freeze({
    "hm-original-major-stepwise-v0": { fixtureId: "hm-original-major-stepwise-v0", expectedStatus: "complete", expectedOutcome: "source-aware-third-sixth-deterministic" },
    "hm-original-minor-phrase-v0": { fixtureId: "hm-original-minor-phrase-v0", expectedStatus: "complete", expectedOutcome: "direct-lower-minor-source-respect" },
    "hm-original-slash-chord-v0": { fixtureId: "hm-original-slash-chord-v0", expectedStatus: "complete", expectedOutcome: "slash-bass-does-not-expand-vocal-tones" },
    "hm-original-sus-omission-v0": { fixtureId: "hm-original-sus-omission-v0", expectedStatus: "complete", expectedOutcome: "suspension-and-omission-preserved" },
    "hm-original-add9-v0": { fixtureId: "hm-original-add9-v0", expectedStatus: "complete", expectedOutcome: "explicit-add9-candidate-preserved" },
    "hm-original-lead-nct-passing-v0": { fixtureId: "hm-original-lead-nct-passing-v0", expectedStatus: "complete", expectedOutcome: "legal-continuation-precedes-generic-relation" },
    "hm-original-held-common-tone-v0": { fixtureId: "hm-original-held-common-tone-v0", expectedStatus: "complete", expectedOutcome: "held-syllable-common-tone" },
    "hm-original-held-no-common-upper-v0": { fixtureId: "hm-original-held-no-common-upper-v0", expectedStatus: "complete", expectedOutcome: "upper-chord-boundary-transition-without-new-lyric" },
    "hm-original-held-no-common-lower-v0": { fixtureId: "hm-original-held-no-common-lower-v0", expectedStatus: "complete", expectedOutcome: "lower-chord-boundary-transition-without-new-lyric" },
    "hm-original-upper-range-v0": { fixtureId: "hm-original-upper-range-v0", expectedStatus: "complete", expectedOutcome: "upper-uses-assigned-performer-ranges" },
    "hm-original-lower-range-v0": { fixtureId: "hm-original-lower-range-v0", expectedStatus: "complete", expectedOutcome: "lower-generated-directly" },
    "hm-original-hard-range-edge-v0": { fixtureId: "hm-original-hard-range-edge-v0", expectedStatus: "partial", expectedOutcome: "hard-prune-with-honest-required-coverage", expectedReason: "LOCAL_REST_HARD_IMPOSSIBILITY" },
    "hm-original-lead-only-negative-v0": { fixtureId: "hm-original-lead-only-negative-v0", expectedStatus: "partial", expectedOutcome: "lead-only-not-fake-harmony", expectedDiagnostic: "WAG_V1_PARTIAL_REQUIRED_COVERAGE" },
    "hm-original-accidental-root-spelling-v0": { fixtureId: "hm-original-accidental-root-spelling-v0", expectedStatus: "complete", expectedOutcome: "exact-accidental-root-relative-spelling" },
    "hm-original-unrepresentable-spelling-v0": { fixtureId: "hm-original-unrepresentable-spelling-v0", expectedStatus: "complete", expectedOutcome: "unrepresentable-source-tone-excluded", expectedReason: "SOURCE_CHORD_TONE_SPELLING_UNREPRESENTABLE" },
    "hm-original-activity-hard-leap-dead-end-v0": { fixtureId: "hm-original-activity-hard-leap-dead-end-v0", expectedStatus: "partial", expectedOutcome: "sequential-activity-rest-and-reentry", expectedReason: "LOCAL_REST_HARD_IMPOSSIBILITY" },
    "hm-original-lock-induced-no-candidate-v0": { fixtureId: "hm-original-lock-induced-no-candidate-v0", expectedStatus: "blocked", expectedOutcome: "owning-stage-lock-divergence-block", expectedReason: "LOCK_INDUCED_NO_LEGAL_CANDIDATE", expectedDiagnostic: "STAGE_LOCK_SCOPE_INVALID" },
    "hm-diagnostic-registry-merge-v0": { fixtureId: "hm-diagnostic-registry-merge-v0", expectedStatus: "complete", expectedOutcome: "exact-99-code-registry-and-result-booleans" },
    "hm-segment-b-one-singer-upper-wins-v0": { fixtureId: "hm-segment-b-one-singer-upper-wins-v0", expectedStatus: "complete", expectedOutcome: "intent-persists-upper" },
    "hm-segment-b-one-singer-lower-wins-v0": { fixtureId: "hm-segment-b-one-singer-lower-wins-v0", expectedStatus: "complete", expectedOutcome: "intent-persists-lower" },
    "hm-segment-b-two-singer-bijections-v0": { fixtureId: "hm-segment-b-two-singer-bijections-v0", expectedStatus: "complete", expectedOutcome: "exact-two-role-bijections" },
    "hm-segment-b-all-nc-v0": { fixtureId: "hm-segment-b-all-nc-v0", expectedStatus: "complete", expectedOutcome: "lead-only-complete-and-harmony-silent" },
    "hm-segment-b-held-chord-boundary-v0": { fixtureId: "hm-segment-b-held-chord-boundary-v0", expectedStatus: "complete", expectedOutcome: "held-syllable-boundary-transition" },
    "hm-segment-b-held-phrase-section-boundary-v0": { fixtureId: "hm-segment-b-held-phrase-section-boundary-v0", expectedStatus: "complete", expectedOutcome: "phrase-boundary-resets-continuity" },
    "hm-segment-b-activity-lock-impossible-v0": { fixtureId: "hm-segment-b-activity-lock-impossible-v0", expectedStatus: "blocked", expectedOutcome: "activity-owning-stage-block", expectedReason: "LOCK_INDUCED_NO_LEGAL_CANDIDATE", expectedDiagnostic: "STAGE_LOCK_SCOPE_INVALID" },
    "hm-segment-b-activity-anchor-parity-v0": { fixtureId: "hm-segment-b-activity-anchor-parity-v0", expectedStatus: "blocked", expectedOutcome: "corrupted-activity-anchor-parity-rejected", expectedDiagnostic: "WAG_V1_ACTIVITY_ANCHOR_FEASIBILITY_PARITY_MISMATCH" },
    "hm-segment-b-anchor-lock-divergence-v0": { fixtureId: "hm-segment-b-anchor-lock-divergence-v0", expectedStatus: "complete", expectedOutcome: "valid-anchor-lock-divergence-replayed" },
    "hm-segment-b-pitch-lock-valid-v0": { fixtureId: "hm-segment-b-pitch-lock-valid-v0", expectedStatus: "complete", expectedOutcome: "exact-valid-pitch-lock" },
    "hm-segment-b-pitch-lock-invalid-v0": { fixtureId: "hm-segment-b-pitch-lock-invalid-v0", expectedStatus: "blocked", expectedOutcome: "invalid-pitch-lock-blocked", expectedReason: "LOCK_INDUCED_NO_LEGAL_CANDIDATE", expectedDiagnostic: "STAGE_LOCK_SCOPE_INVALID" },
    "hm-segment-b-non-perceptible-marginal-v0": { fixtureId: "hm-segment-b-non-perceptible-marginal-v0", expectedStatus: "complete", expectedOutcome: "short-automatic-marginal-rejected-lead-only-complete", expectedReason: "OPTIONAL_MARGINAL_NOT_PERCEPTIBLE" },
    "hm-segment-b-h1-required-lead-only-v0": { fixtureId: "hm-segment-b-h1-required-lead-only-v0", expectedStatus: "partial", expectedOutcome: "h1-required-lead-only-partial", expectedDiagnostic: "WAG_V1_PARTIAL_REQUIRED_COVERAGE" },
    "hm-segment-b-complete-h1-partial-peer-v0": { fixtureId: "hm-segment-b-complete-h1-partial-peer-v0", expectedStatus: "complete", expectedOutcome: "complete-h1-not-poisoned-by-partial-peer" },
    "hm-segment-b-pair-accepted-v0": { fixtureId: "hm-segment-b-pair-accepted-v0", expectedStatus: "complete", expectedOutcome: "immutable-upper-lower-pair-retained" },
    "hm-segment-b-pair-degraded-v0": { fixtureId: "hm-segment-b-pair-degraded-v0", expectedStatus: "complete", expectedOutcome: "optional-pair-degrades-to-complete-h1", expectedReason: "OPTIONAL_PAIR_DEGRADED_TO_SINGLE" },
    "hm-segment-b-full-only-repair-corruption-v0": { fixtureId: "hm-segment-b-full-only-repair-corruption-v0", expectedStatus: "blocked", expectedOutcome: "full-stack-only-repair-rejected", expectedDiagnostic: "WAG_V1_DROPOUT_PROJECTION_MISMATCH" },
    "hm-segment-b-upper-dropout-v0": { fixtureId: "hm-segment-b-upper-dropout-v0", expectedStatus: "complete", expectedOutcome: "upper-dropout-equals-stored-marginal" },
    "hm-segment-b-lower-dropout-v0": { fixtureId: "hm-segment-b-lower-dropout-v0", expectedStatus: "complete", expectedOutcome: "lower-dropout-equals-stored-marginal" },
    "hm-segment-b-lead-only-expectation-none-v0": { fixtureId: "hm-segment-b-lead-only-expectation-none-v0", expectedStatus: "complete", expectedOutcome: "expectation-none-lead-only-complete" },
    "hm-segment-b-result-truth-table-v0": { fixtureId: "hm-segment-b-result-truth-table-v0", expectedStatus: "complete", expectedOutcome: "complete-partial-blocked-registry-truth-table" },
    "hm-segment-b-candidate-order-v0": { fixtureId: "hm-segment-b-candidate-order-v0", expectedStatus: "complete", expectedOutcome: "deterministic-default-and-sibling-order" },
    "hm-segment-b-accompaniment-nc-v0": { fixtureId: "hm-segment-b-accompaniment-nc-v0", expectedStatus: "complete", expectedOutcome: "nc-accompaniment-silence" },
    "hm-segment-b-accompaniment-parity-v0": { fixtureId: "hm-segment-b-accompaniment-parity-v0", expectedStatus: "complete", expectedOutcome: "accompaniment-timeline-and-config-parity" },
    "hm-segment-b-validator-corruption-matrix-v0": { fixtureId: "hm-segment-b-validator-corruption-matrix-v0", expectedStatus: "blocked", expectedOutcome: "independent-validator-rejects-corruption-matrix", expectedDiagnostic: "CANDIDATE_PROJECTION_INVALID" },
  });

export const pitch = (
  step: SpelledPitch["step"],
  octave: number,
  alter: SpelledPitch["alter"] = 0,
): SpelledPitch => ({ step, alter, octave });

export interface FixtureLeadNote {
  readonly onset: Fraction;
  readonly duration: Fraction;
  readonly pitch: SpelledPitch;
  readonly lyric?: string;
  readonly tieStart?: boolean;
  readonly tieStop?: boolean;
}

export interface FixtureChord {
  readonly onset: Fraction;
  readonly symbol: string;
}

export interface WagFixtureOptions {
  readonly fixtureId?: string;
  readonly presetId?: ArrangementPresetId;
  readonly maxHarmonyTracks?: 0 | 1 | 2;
  readonly leadNotes?: readonly FixtureLeadNote[];
  readonly chords?: readonly FixtureChord[];
  readonly generatedRanges?: readonly PitchRange[];
  readonly meter?: TimeSignature;
  readonly sectionType?: SectionType;
  readonly sectionVariant?: SectionVariant;
  readonly locks?: VariantStageLocks;
}

function chordEvent(measureIndex: number, ordinal: number, chord: FixtureChord): SourceChordEvent {
  const parsed = parseChord(chord.symbol);
  if (parsed.status === "failed" || parsed.status === "carry") {
    throw new RangeError(`fixture chord is not resolved: ${chord.symbol}`);
  }
  return {
    id: sourceChordEventId(measureIndex, ordinal),
    sourceMeasureId: sourceMeasureId(measureIndex),
    onset: chord.onset,
    sourceText: chord.symbol,
    parseResult: parsed,
    source: "manual",
    confirmation: "confirmed",
  };
}

function leadMaterial(
  measureIndex: number,
  notes: readonly FixtureLeadNote[],
): { readonly events: readonly LeadEvent[]; readonly lyrics: readonly LyricToken[] } {
  const lyrics: LyricToken[] = [];
  const events = notes.map((note, ordinal): LeadEvent => {
    const eventId = leadEventId(measureIndex, ordinal);
    const tokenId = lyricTokenId(measureIndex, ordinal, 1, 0);
    if (note.lyric !== undefined) {
      lyrics.push({
        id: tokenId,
        text: note.lyric,
        syllabic: "single",
        leadEventId: eventId,
        verse: 1,
        extend: Boolean(note.tieStart),
        emphasis: "none",
      });
    }
    return {
      kind: "note",
      id: eventId,
      sourceMeasureId: sourceMeasureId(measureIndex),
      onset: note.onset,
      duration: note.duration,
      pitch: note.pitch,
      tieStart: note.tieStart ?? false,
      tieStop: note.tieStop ?? false,
      lyricTokenIds: note.lyric === undefined ? [] : [tokenId],
    };
  });
  return { events, lyrics };
}

export async function createWagFixtureInput(options: WagFixtureOptions = {}): Promise<WagLifecycleInput> {
  const fixtureId = options.fixtureId ?? "hm-original-major-stepwise-v0";
  const meter = options.meter ?? COMMON_TIME;
  const duration = meter.numerator === 6 && meter.denominator === 8 ? fraction(3) : fraction(4);
  const notes = options.leadNotes ?? [
    { onset: fraction(0), duration: fraction(1), pitch: pitch("C", 4), lyric: "la" },
    { onset: fraction(1), duration: fraction(1), pitch: pitch("D", 4), lyric: "la" },
    { onset: fraction(2), duration: fraction(1), pitch: pitch("E", 4), lyric: "la" },
    { onset: fraction(3), duration: fraction(1), pitch: pitch("G", 4), lyric: "la" },
  ];
  const chords = options.chords ?? [{ onset: fraction(0), symbol: "C" }];
  const lead = leadMaterial(0, notes);
  const measure: SourceMeasure = {
    id: sourceMeasureId(0),
    number: 1,
    implicit: false,
    time: meter,
    duration,
    leadEvents: lead.events,
    chordEvents: chords.map((chord, ordinal) => chordEvent(0, ordinal, chord)),
    lyricTokens: lead.lyrics,
    textEvents: [],
    repeat: { startRepeat: false },
  };
  const expansion = expandRepeats([measure], APPLICATION_ALGORITHM_VERSION_REGISTRY.performanceExpanderVersion);
  if (expansion.status !== "complete") throw new RangeError(expansion.code);
  const sectionDefinition = {
    id: sectionDefinitionId(0, 1, options.sectionType ?? "chorus", 0),
    type: options.sectionType ?? "chorus",
    label: fixtureId,
    sourceMeasureIds: [measure.id],
    confirmation: "confirmed" as const,
  };
  const sectionOccurrence = {
    id: sectionOccurrenceId(0, 1, 0),
    sectionDefinitionId: sectionDefinition.id,
    occurrenceIndex: 0,
    variant: options.sectionVariant ?? "base",
    lyricVerseIndex: 1,
    startPerformanceMeasureIndex: 0,
    endPerformanceMeasureIndexExclusive: 1,
  };
  const phraseRange = musicalRange(
    { performanceMeasureIndex: 0, offset: fraction(0) },
    { performanceMeasureIndex: 1, offset: fraction(0) },
  );
  const phrase = {
    id: phraseRegionId(0, phraseRange.start, phraseRange.end),
    sectionOccurrenceId: sectionOccurrence.id,
    range: phraseRange,
    boundarySource: "manual" as const,
  };
  const sourceComponents = {
    defaultKey: { tonic: { step: "C" as const, alter: 0 as const }, mode: "major" as const },
    defaultTempo: { beatUnit: 4 as const, dotted: false, bpm: 96 },
    sourceMeasures: [measure],
    performanceSequence: expansion.sequence,
    sectionDefinitions: [sectionDefinition],
    sectionOccurrences: [sectionOccurrence],
    phraseRegions: [phrase],
  };
  const revisionDigest = await digestMusicalSourceComponents(sourceComponents);
  const rights = { basis: "self-authored" as const, allowedUses: ["evaluation", "generation", "share"] as const };
  const source: SongSourceDocument = {
    schemaVersion: 9,
    documentId: `fixture:${fixtureId}`,
    revisionOrdinal: 0,
    revisionDigest,
    revisionHistory: [],
    revisionHistoryDigest: await semanticDigest({ projectionSchema: "hm-fixture-revision-history-v1", fixtureId }),
    sourceProvenanceDigest: await computeSourceProvenanceDigest({ rights }),
    title: fixtureId,
    ...sourceComponents,
    rights,
  };
  const [sourceChordProjectionDigest, performanceSequenceDigest] = await Promise.all([
    digestSourceChordProjection(source.sourceMeasures),
    digestPerformanceSequence(source.performanceSequence, source.sourceMeasures),
  ]);
  const timelineState = await resolveEffectiveChordTimeline({
    sourceMeasures: source.sourceMeasures,
    performanceSequence: source.performanceSequence,
    sourceChordProjectionDigest,
    performanceSequenceDigest,
    policy: { gapPolicy: "block-gap" },
    resolverVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.chordTimelineResolverVersion,
    expectedResolverVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.chordTimelineResolverVersion,
  });
  if (timelineState.status !== "resolved") throw new RangeError("fixture chord timeline did not resolve");
  const atomization = await atomizeSourceLead({
    sourceMeasures: source.sourceMeasures,
    performanceSequence: source.performanceSequence,
    sectionOccurrences: source.sectionOccurrences,
    phraseRegions: source.phraseRegions,
    chordTimeline: timelineState.timeline,
    musicalSourceDigest: revisionDigest,
    atomizerVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.sourceLeadAtomizerVersion,
  });
  const generatedRanges = options.generatedRanges ?? [
    { low: pitch("D", 4), high: pitch("C", 6) },
    { low: pitch("C", 2), high: pitch("B", 3) },
  ];
  const performers: PerformerProfile[] = [
    { id: performerId(0), displayName: "Lead", hardRange: { low: pitch("C", 3), high: pitch("C", 6) }, comfortableRange: { low: pitch("C", 3), high: pitch("C", 6) } },
    ...generatedRanges.map((range, index) => ({
      id: performerId(index + 1),
      displayName: `Harmony ${index + 1}`,
      hardRange: range,
      comfortableRange: range,
      preferredTessitura: range,
    })),
  ];
  const trackPlans: VocalTrackPlan[] = [
    SOURCE_LEAD_TRACK,
    ...generatedRanges.map((_, index): VocalTrackPlan => ({
      kind: "generated-harmony",
      id: harmonyTrackId((index + 1) as 1 | 2),
      displayLabel: `Harmony ${index + 1}`,
      canonicalOrdinal: (index + 1) as 1 | 2,
      enabled: true,
    })),
  ];
  const assignments: PerformerTrackAssignment[] = trackPlans.map((track, index) => ({
    trackPlanId: track.id,
    performerId: performers[index].id,
  }));
  const authority = await loadFrozenWagAuthority();
  const presetId = options.presetId ?? (generatedRanges.length > 1 ? "standard" : "simple");
  const userCaps = { maxHarmonyTracks: options.maxHarmonyTracks ?? Math.min(2, generatedRanges.length) as 0 | 1 | 2, allowOctaveDouble: false } as const;
  const effectiveConfig = await resolveEffectiveArrangementConfig({
    registry: authority.presetProfiles,
    expectedPresetProfileVersion: authority.presetProfiles.presetProfileVersion,
    mode: { profileId: "worship-band-v1", harmonicContext: "band-supported" },
    presetId,
    userCaps,
    assignedEnabledHarmonyTrackCount: generatedRanges.length,
  });
  return {
    source,
    effectiveChordTimeline: timelineState.timeline,
    sourceLeadAtomization: atomization,
    effectiveConfig,
    userCaps,
    performers,
    trackPlans,
    assignments,
    ...(options.locks ? { locks: options.locks } : {}),
  };
}

export async function materializeSegmentBFixture(fixtureId: SegmentBFixtureId): Promise<{
  readonly input: WagLifecycleInput;
  readonly expected: SegmentBFixtureExpectation;
}> {
  const options: WagFixtureOptions = (() => {
    const upper = [{ low: pitch("D", 4), high: pitch("C", 6) }];
    const lower = [{ low: pitch("C", 2), high: pitch("B", 3) }];
    const pair = [upper[0], lower[0]];
    const held = [{ onset: fraction(0), duration: fraction(4), pitch: pitch("C", 4), lyric: "hold", tieStart: true }];
    switch (fixtureId) {
      case "hm-original-minor-phrase-v0": return { fixtureId, chords: [{ onset: fraction(0), symbol: "Cm" }], generatedRanges: lower, maxHarmonyTracks: 1 };
      case "hm-original-slash-chord-v0": return { fixtureId, chords: [{ onset: fraction(0), symbol: "C/E" }], generatedRanges: upper, maxHarmonyTracks: 1 };
      case "hm-original-sus-omission-v0": return { fixtureId, chords: [{ onset: fraction(0), symbol: "C7sus4no5" }], generatedRanges: upper, maxHarmonyTracks: 1 };
      case "hm-original-add9-v0": return { fixtureId, chords: [{ onset: fraction(0), symbol: "Cadd9" }], generatedRanges: upper, maxHarmonyTracks: 1 };
      case "hm-original-lead-nct-passing-v0": return { fixtureId, leadNotes: [
        { onset: fraction(0), duration: fraction(1), pitch: pitch("C", 4), lyric: "la" },
        { onset: fraction(1), duration: fraction(1), pitch: pitch("D", 4), lyric: "la" },
        { onset: fraction(2), duration: fraction(2), pitch: pitch("E", 4), lyric: "la" },
      ], generatedRanges: upper, maxHarmonyTracks: 1 };
      case "hm-original-held-common-tone-v0": return { fixtureId, leadNotes: held, chords: [{ onset: fraction(0), symbol: "C" }, { onset: fraction(2), symbol: "Am" }], generatedRanges: upper, maxHarmonyTracks: 1 };
      case "hm-original-held-no-common-upper-v0":
      case "hm-segment-b-held-chord-boundary-v0": return { fixtureId, leadNotes: held, chords: [{ onset: fraction(0), symbol: "C" }, { onset: fraction(2), symbol: "D" }], generatedRanges: upper, maxHarmonyTracks: 1 };
      case "hm-original-held-no-common-lower-v0": return { fixtureId, leadNotes: held, chords: [{ onset: fraction(0), symbol: "C" }, { onset: fraction(2), symbol: "D" }], generatedRanges: lower, maxHarmonyTracks: 1 };
      case "hm-original-upper-range-v0":
      case "hm-segment-b-one-singer-upper-wins-v0": return { fixtureId, generatedRanges: upper, maxHarmonyTracks: 1 };
      case "hm-original-lower-range-v0":
      case "hm-segment-b-one-singer-lower-wins-v0": return { fixtureId, generatedRanges: lower, maxHarmonyTracks: 1 };
      case "hm-original-hard-range-edge-v0":
      case "hm-original-lead-only-negative-v0": return { fixtureId, generatedRanges: [{ low: pitch("E", 4), high: pitch("E", 4) }], maxHarmonyTracks: 1, chords: [{ onset: fraction(0), symbol: "C" }, { onset: fraction(1), symbol: "G" }] };
      case "hm-original-accidental-root-spelling-v0": return { fixtureId, chords: [{ onset: fraction(0), symbol: "Ebm" }], generatedRanges: pair, maxHarmonyTracks: 2 };
      case "hm-original-unrepresentable-spelling-v0": return { fixtureId, chords: [{ onset: fraction(0), symbol: "C##(#9)" }], generatedRanges: pair, maxHarmonyTracks: 2 };
      case "hm-original-activity-hard-leap-dead-end-v0": return { fixtureId, generatedRanges: [{ low: pitch("E", 4), high: pitch("C", 5) }], maxHarmonyTracks: 1, leadNotes: [
        { onset: fraction(0), duration: fraction(1), pitch: pitch("C", 4), lyric: "la" },
        { onset: fraction(1), duration: fraction(1), pitch: pitch("B", 4), lyric: "la" },
        { onset: fraction(2), duration: fraction(2), pitch: pitch("C", 4), lyric: "la" },
      ], chords: [{ onset: fraction(0), symbol: "C" }] };
      case "hm-segment-b-two-singer-bijections-v0":
      case "hm-segment-b-pair-accepted-v0":
      case "hm-segment-b-upper-dropout-v0":
      case "hm-segment-b-lower-dropout-v0":
      case "hm-segment-b-candidate-order-v0":
      case "hm-segment-b-validator-corruption-matrix-v0": return { fixtureId, presetId: "standard", generatedRanges: pair, maxHarmonyTracks: 2 };
      case "hm-segment-b-complete-h1-partial-peer-v0":
      case "hm-segment-b-pair-degraded-v0": return { fixtureId, presetId: "standard", generatedRanges: [upper[0], { low: pitch("D", 3), high: pitch("D", 3) }], maxHarmonyTracks: 2 };
      case "hm-segment-b-all-nc-v0":
      case "hm-segment-b-accompaniment-nc-v0": return { fixtureId, chords: [{ onset: fraction(0), symbol: "N.C." }], generatedRanges: pair, maxHarmonyTracks: 2 };
      case "hm-segment-b-non-perceptible-marginal-v0": return { fixtureId, generatedRanges: upper, maxHarmonyTracks: 1, leadNotes: [
        { onset: fraction(0), duration: fraction(1, 2), pitch: pitch("C", 4), lyric: "la" },
      ] };
      case "hm-segment-b-h1-required-lead-only-v0": return { fixtureId, generatedRanges: [{ low: pitch("E", 4), high: pitch("E", 4) }], maxHarmonyTracks: 1, leadNotes: [
        { onset: fraction(0), duration: fraction(1), pitch: pitch("C", 4), lyric: "la" },
        { onset: fraction(1), duration: fraction(1), pitch: pitch("B", 3), lyric: "la" },
      ], chords: [{ onset: fraction(0), symbol: "C" }, { onset: fraction(1), symbol: "G" }] };
      case "hm-segment-b-lead-only-expectation-none-v0": return { fixtureId, maxHarmonyTracks: 0 };
      default: return { fixtureId };
    }
  })();
  let input = await createWagFixtureInput(options);
  const phraseId = input.source.phraseRegions[0].id;
  const firstAtom = input.sourceLeadAtomization.atoms[0];
  const firstSpan = input.effectiveChordTimeline.spans[0];
  const noLocks: VariantStageLocks = { intent: [], activity: [], anchor: [], solver: [] };
  if (fixtureId === "hm-segment-b-activity-lock-impossible-v0") {
    const lock: ActivityLock = { id: "lk:simple:fixture:activity:0", kind: "activity", presetId: input.effectiveConfig.presetId, phraseId, trackPlanId: "track:h1", range: firstAtom.range, activity: { state: "independent-note", behavior: "independent-harmony" } };
    input = { ...input, performers: input.performers.map((performer, index) => index === 1 ? { ...performer, hardRange: { low: pitch("C", 4), high: pitch("C", 4) }, comfortableRange: { low: pitch("C", 4), high: pitch("C", 4) }, preferredTessitura: { low: pitch("C", 4), high: pitch("C", 4) } } : performer), locks: { ...noLocks, activity: [lock] } };
  }
  if (["hm-original-lock-induced-no-candidate-v0", "hm-segment-b-anchor-lock-divergence-v0"].includes(fixtureId) && firstSpan.parseResult.status === "ok") {
    const selectedTone = firstSpan.parseResult.chord.tones.find((tone) => tone.degree === (fixtureId.includes("divergence") ? 5 : 3)) ?? firstSpan.parseResult.chord.tones[0];
    const anchorLock: AnchorLock = { id: `lk:${input.effectiveConfig.presetId}:fixture:anchor:0`, kind: "anchor-chord-tone", presetId: input.effectiveConfig.presetId, phraseId, trackPlanId: "track:h1", position: firstAtom.range.start, chordSpanId: firstSpan.id, selectedTone };
    const solver = fixtureId.includes("lock-induced") ? [{ id: `lk:${input.effectiveConfig.presetId}:fixture:pitch:0`, kind: "pitch", presetId: input.effectiveConfig.presetId, phraseId, trackPlanId: "track:h1", position: firstAtom.range.start, pitch: pitch("G", 4) } satisfies PitchLock] : [];
    input = { ...input, locks: { ...noLocks, anchor: [anchorLock], solver } };
  }
  if (["hm-segment-b-pitch-lock-valid-v0", "hm-segment-b-pitch-lock-invalid-v0"].includes(fixtureId)) {
    const lock: PitchLock = { id: `lk:${input.effectiveConfig.presetId}:fixture:pitch:0`, kind: "pitch", presetId: input.effectiveConfig.presetId, phraseId, trackPlanId: "track:h1", position: firstAtom.range.start, pitch: fixtureId.includes("invalid") ? pitch("C", 8) : pitch("E", 4) };
    input = { ...input, locks: { ...noLocks, solver: [lock] } };
  }
  return { input, expected: SEGMENT_B_FIXTURE_EXPECTATIONS[fixtureId] };
}
