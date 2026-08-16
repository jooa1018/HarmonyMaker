import { APPLICATION_ALGORITHM_VERSION_REGISTRY } from "../app/algorithm-version-registry";
import { parseChord } from "../domain/chord/parser";
import {
  resolveEffectiveArrangementConfig,
  type ArrangementPresetId,
} from "../domain/config";
import { digestMusicalSourceComponents } from "../domain/digest/source";
import { semanticDigest } from "../domain/digest/canonical";
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
import type { VariantStageLocks } from "../domain/locks";
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
  Object.freeze(Object.fromEntries(REQUIRED_SEGMENT_B_FIXTURE_IDS.map((fixtureId) => [fixtureId, {
    fixtureId,
    expectedStatus: fixtureId.includes("invalid") || fixtureId.includes("impossible") || fixtureId.includes("lock-induced")
      ? "blocked"
      : fixtureId.includes("h1-required-lead-only") || fixtureId.includes("hard-range-edge")
        ? "partial"
        : "complete",
    expectedOutcome: fixtureId,
    ...(fixtureId.includes("non-perceptible") ? { expectedReason: "OPTIONAL_MARGINAL_NOT_PERCEPTIBLE" } : {}),
    ...(fixtureId.includes("lock") && fixtureId.includes("impossible")
      ? { expectedDiagnostic: "STAGE_LOCK_SCOPE_INVALID" }
      : {}),
  }])) as Record<SegmentBFixtureId, SegmentBFixtureExpectation>);

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
  const source: SongSourceDocument = {
    schemaVersion: 9,
    documentId: `fixture:${fixtureId}`,
    revisionOrdinal: 0,
    revisionDigest,
    revisionHistory: [],
    revisionHistoryDigest: await semanticDigest({ projectionSchema: "hm-fixture-revision-history-v1", fixtureId }),
    title: fixtureId,
    ...sourceComponents,
    rights: { basis: "self-authored", allowedUses: ["generation", "evaluation", "share"] },
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
  const lowerOnly = fixtureId.includes("lower-wins") || fixtureId.includes("lower-range") || fixtureId.includes("minor-phrase");
  const leadOnly = fixtureId.includes("lead-only-expectation-none");
  const allNc = fixtureId.includes("all-nc") || fixtureId.includes("accompaniment-nc");
  const input = await createWagFixtureInput({
    fixtureId,
    maxHarmonyTracks: leadOnly ? 0 : undefined,
    chords: allNc ? [{ onset: fraction(0), symbol: "N.C." }] : undefined,
    generatedRanges: lowerOnly
      ? [{ low: pitch("C", 2), high: pitch("B", 3) }]
      : fixtureId.includes("one-singer-upper") || fixtureId.includes("upper-range")
        ? [{ low: pitch("D", 4), high: pitch("C", 6) }]
        : undefined,
  });
  return { input, expected: SEGMENT_B_FIXTURE_EXPECTATIONS[fixtureId] };
}
