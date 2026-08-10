import { parseChord } from "../../domain/chord/parser";
import { digestMusicalSourceComponents } from "../../domain/digest/source";
import {
  addFractions,
  compareFractions,
  fraction,
  subtractFractions,
  type Fraction,
} from "../../domain/fraction";
import {
  digestPerformanceSequence,
  digestSourceChordProjection,
  resolveEffectiveChordTimeline,
} from "../../domain/harmony/chord-timeline";
import { COMMON_TIME, COMPOUND_DUPLE } from "../../domain/meter";
import { SOURCE_LEAD_TRACK, type GeneratedHarmonyTrackPlan, type VocalTrackPlan } from "../../domain/performer";
import { expandRepeats } from "../../domain/performance/repeat";
import { atomizeSourceLead } from "../../domain/source/atomization";
import type {
  LeadEvent,
  LyricToken,
  SourceChordEvent,
  SourceMeasure,
} from "../../domain/source/model";
import { musicalRange } from "../../domain/time";
import { RC7_REVIEW_VERSIONS } from "./constants";
import { globalQToPosition, totalDuration } from "./music";
import { RC7_DEFAULT_PERFORMERS } from "./reference-cases";
import type {
  Rc7PerformerEntry,
  Rc7PreparedCase,
  Rc7ReferenceCaseDefinition,
} from "./types";

export interface Rc7PrepareOptions {
  readonly idNamespace?: string;
  readonly runtimeTrackPrefix?: string;
  readonly runtimePerformerPrefix?: string;
  readonly shuffleSeed?: number;
  readonly presetOverride?: Rc7PreparedCase["presetId"];
}

interface SegmentedNote {
  readonly measureIndex: number;
  readonly onset: Fraction;
  readonly duration: Fraction;
  readonly sourceSpecIndex: number;
  readonly segmentIndex: number;
  readonly segmentCount: number;
}

function measureDuration(definition: Rc7ReferenceCaseDefinition): Fraction {
  return definition.meterFamily === "simple-quadruple" ? fraction(4) : fraction(3);
}

function requiredMeasureDurations(definition: Rc7ReferenceCaseDefinition): readonly Fraction[] {
  const duration = measureDuration(definition);
  const requiredEnd = addFractions(definition.phraseStartQ ?? fraction(0), definition.phraseDurationQ);
  const count = Math.max(1, Math.ceil(
    (requiredEnd.n / requiredEnd.d)
      / (duration.n / duration.d),
  ));
  return Array.from({ length: count }, () => duration);
}

function splitNote(
  start: Fraction,
  duration: Fraction,
  sourceSpecIndex: number,
  measureDurations: readonly Fraction[],
): readonly SegmentedNote[] {
  let cursor = start;
  let remaining = duration;
  const segments: Omit<SegmentedNote, "segmentCount">[] = [];
  while (remaining.n > 0) {
    const position = globalQToPosition(cursor, measureDurations);
    if (position.performanceMeasureIndex >= measureDurations.length) {
      throw new RangeError("fixture note extends beyond its performance sequence");
    }
    const available = subtractFractions(
      measureDurations[position.performanceMeasureIndex],
      position.offset,
    );
    const segmentDuration = compareFractions(remaining, available) <= 0 ? remaining : available;
    segments.push({
      measureIndex: position.performanceMeasureIndex,
      onset: position.offset,
      duration: segmentDuration,
      sourceSpecIndex,
      segmentIndex: segments.length,
    });
    cursor = addFractions(cursor, segmentDuration);
    remaining = subtractFractions(remaining, segmentDuration);
  }
  return segments.map((segment) => ({ ...segment, segmentCount: segments.length }));
}

function lyricToken(
  id: string,
  leadEventId: string,
  text: string,
  emphasis: Rc7ReferenceCaseDefinition["notes"][number]["emphasis"],
): LyricToken {
  const base = {
    id,
    text,
    syllabic: "single" as const,
    leadEventId,
    verse: 1,
    extend: false,
  };
  if (emphasis === "confirmed") return { ...base, emphasis: "confirmed", emphasisSource: "manual" };
  if (emphasis === "musicxml-accent-suggested") return { ...base, emphasis: "suggested", emphasisSource: "musicxml-accent" };
  if (emphasis === "metric-suggested") return { ...base, emphasis: "suggested", emphasisSource: "metric-heuristic" };
  return { ...base, emphasis: "none" };
}

function clonePerformers(
  source: readonly Rc7PerformerEntry[],
  prefix: string,
): readonly Rc7PerformerEntry[] {
  return source.map((entry) => ({
    performerOrdinal: entry.performerOrdinal,
    profile: {
      ...entry.profile,
      id: `${prefix}:${entry.performerOrdinal}`,
      displayName: `${prefix} ${entry.performerOrdinal}`,
    },
  }));
}

function shuffle<T>(values: readonly T[], seed: number | undefined): readonly T[] {
  if (seed === undefined) return values;
  const result = [...values];
  let state = (seed >>> 0) || 1;
  const next = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = next() % (index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export async function prepareRc7ReferenceCase(
  definition: Rc7ReferenceCaseDefinition,
  options: Rc7PrepareOptions = {},
): Promise<Rc7PreparedCase> {
  const idNamespace = options.idNamespace ?? definition.caseId.toLowerCase();
  const trackPrefix = options.runtimeTrackPrefix ?? `${idNamespace}:track`;
  const performerPrefix = options.runtimePerformerPrefix ?? `${idNamespace}:performer`;
  const measureDurations = requiredMeasureDurations(definition);
  const phraseStartQ = definition.phraseStartQ ?? fraction(0);
  const phraseEndQ = addFractions(phraseStartQ, definition.phraseDurationQ);
  if (compareFractions(phraseEndQ, totalDuration(measureDurations)) > 0) {
    throw new RangeError("fixture phrase exceeds its measure sequence");
  }

  const noteSegments = definition.notes.flatMap((note, index) => {
    if (note.durationQ.n <= 0 || note.startQ.n < 0) throw new RangeError("fixture note duration/start is invalid");
    return splitNote(addFractions(phraseStartQ, note.startQ), note.durationQ, index, measureDurations);
  });
  const sortedNotes = [...definition.notes].map((note, index) => ({ note, index }))
    .sort((left, right) => compareFractions(left.note.startQ, right.note.startQ));
  for (let index = 1; index < sortedNotes.length; index += 1) {
    const previous = sortedNotes[index - 1].note;
    const current = sortedNotes[index].note;
    if (compareFractions(addFractions(previous.startQ, previous.durationQ), current.startQ) > 0) {
      throw new RangeError("fixture Lead notes overlap");
    }
  }

  const chordByMeasure = new Map<number, SourceChordEvent[]>();
  const chordSpecs = phraseStartQ.n === 0
    ? definition.chords
    : [{ startQ: fraction(0), symbol: "N.C." }, ...definition.chords.map((spec) => ({
      ...spec,
      startQ: addFractions(phraseStartQ, spec.startQ),
    }))];
  chordSpecs.forEach((spec, chordOrdinal) => {
    const position = globalQToPosition(spec.startQ, measureDurations);
    if (position.performanceMeasureIndex >= measureDurations.length) throw new RangeError("fixture chord is out of range");
    const parseResult = parseChord(spec.symbol);
    if (parseResult.status !== "ok" && parseResult.status !== "no-chord") {
      throw new RangeError(`fixture chord failed to parse: ${spec.symbol}`);
    }
    const events = chordByMeasure.get(position.performanceMeasureIndex) ?? [];
    events.push({
      id: `${idNamespace}:chord:${chordOrdinal}`,
      sourceMeasureId: `${idNamespace}:measure:${position.performanceMeasureIndex}`,
      onset: position.offset,
      sourceText: spec.symbol,
      parseResult,
      source: "manual",
      confirmation: "confirmed",
    });
    chordByMeasure.set(position.performanceMeasureIndex, events);
  });

  const sourceMeasures: SourceMeasure[] = measureDurations.map((duration, measureIndex) => {
    const sourceMeasureId = `${idNamespace}:measure:${measureIndex}`;
    const segments = noteSegments.filter((segment) => segment.measureIndex === measureIndex)
      .sort((left, right) => compareFractions(left.onset, right.onset));
    const leadEvents: LeadEvent[] = [];
    const lyricTokens: LyricToken[] = [];
    for (let eventOrdinal = 0; eventOrdinal < segments.length; eventOrdinal += 1) {
      const segment = segments[eventOrdinal];
      const spec = definition.notes[segment.sourceSpecIndex];
      const eventId = `${idNamespace}:lead:${measureIndex}:${eventOrdinal}`;
      if (spec.pitch === null) {
        leadEvents.push({
          kind: "rest",
          id: eventId,
          sourceMeasureId,
          onset: segment.onset,
          duration: segment.duration,
        });
        continue;
      }
      const tokenId = `${idNamespace}:lyric:${measureIndex}:${eventOrdinal}`;
      const hasLyric = segment.segmentIndex === 0 && spec.lyric !== undefined;
      leadEvents.push({
        kind: "note",
        id: eventId,
        sourceMeasureId,
        onset: segment.onset,
        duration: segment.duration,
        pitch: spec.pitch,
        tieStart: segment.segmentIndex < segment.segmentCount - 1,
        tieStop: segment.segmentIndex > 0,
        lyricTokenIds: hasLyric ? [tokenId] : [],
      });
      if (hasLyric) lyricTokens.push(lyricToken(tokenId, eventId, spec.lyric ?? "", spec.emphasis));
    }
    return {
      id: sourceMeasureId,
      number: measureIndex + 1,
      implicit: false,
      time: definition.meterFamily === "simple-quadruple" ? COMMON_TIME : COMPOUND_DUPLE,
      duration,
      key: measureIndex === 0 ? definition.key : undefined,
      leadEvents,
      chordEvents: (chordByMeasure.get(measureIndex) ?? []).sort((left, right) => compareFractions(left.onset, right.onset)),
      lyricTokens,
      textEvents: [],
      repeat: { startRepeat: false },
    };
  });

  const expansion = expandRepeats(sourceMeasures, "repeat-v1");
  if (expansion.status !== "complete") throw new RangeError(expansion.code);
  const performanceSequence = expansion.sequence;
  const sectionDefinition = {
    id: `${idNamespace}:section-definition`,
    type: definition.sectionType,
    label: definition.sectionType,
    sourceMeasureIds: sourceMeasures.map((measure) => measure.id),
    confirmation: "confirmed" as const,
  };
  const sectionOccurrence = {
    id: `${idNamespace}:section-occurrence`,
    sectionDefinitionId: sectionDefinition.id,
    occurrenceIndex: 0,
    variant: definition.sectionVariant,
    lyricVerseIndex: 1,
    startPerformanceMeasureIndex: 0,
    endPerformanceMeasureIndexExclusive: performanceSequence.occurrences.length,
  };
  const phrase = {
    id: `${idNamespace}:phrase`,
    sectionOccurrenceId: sectionOccurrence.id,
    range: musicalRange(
      globalQToPosition(phraseStartQ, measureDurations),
      globalQToPosition(phraseEndQ, measureDurations),
      measureDurations,
    ),
    boundarySource: "manual" as const,
  };
  const musicalSourceDigest = await digestMusicalSourceComponents({
    defaultKey: definition.key,
    defaultTempo: definition.tempo,
    sourceMeasures,
    performanceSequence,
    sectionDefinitions: [sectionDefinition],
    sectionOccurrences: [sectionOccurrence],
    phraseRegions: [phrase],
  });
  const sourceChordProjectionDigest = await digestSourceChordProjection(sourceMeasures);
  const performanceSequenceDigest = await digestPerformanceSequence(performanceSequence, sourceMeasures);
  const chordTimelineState = await resolveEffectiveChordTimeline({
    sourceMeasures,
    performanceSequence,
    sourceChordProjectionDigest,
    performanceSequenceDigest,
    policy: { gapPolicy: "carry-until-next" },
    resolverVersion: "chord-timeline-v1",
    expectedResolverVersion: "chord-timeline-v1",
  });
  if (chordTimelineState.status !== "resolved") {
    throw new RangeError(`fixture chord timeline blocked: ${definition.caseId}`);
  }
  const sourceLeadAtomization = await atomizeSourceLead({
    sourceMeasures,
    performanceSequence,
    sectionOccurrences: [sectionOccurrence],
    phraseRegions: [phrase],
    chordTimeline: chordTimelineState.timeline,
    musicalSourceDigest,
    atomizerVersion: "source-lead-atomizer-v1",
  });

  const performers = clonePerformers(
    definition.performerEntries ?? RC7_DEFAULT_PERFORMERS,
    performerPrefix,
  );
  const generatedTracks: GeneratedHarmonyTrackPlan[] = [1, 2].map((ordinal) => ({
    kind: "generated-harmony",
    id: `${trackPrefix}:${ordinal}`,
    displayLabel: `Harmony ${ordinal}`,
    canonicalOrdinal: ordinal as 1 | 2,
    enabled: ordinal <= definition.maxHarmonyTracks,
  }));
  const tracks: readonly VocalTrackPlan[] = [SOURCE_LEAD_TRACK, ...generatedTracks];
  const assignments = tracks.filter((track) => track.kind === "source-lead" || track.enabled).map((track) => ({
    trackPlanId: track.id,
    performerId: performers.find((entry) => entry.performerOrdinal === track.canonicalOrdinal)?.profile.id
      ?? performers[0].profile.id,
  }));

  return {
    caseId: definition.caseId,
    title: definition.title,
    description: definition.description,
    sourceKind: "synthetic-original",
    sourceIdentity: `synthetic-original:${definition.caseId}`,
    meterFamily: definition.meterFamily,
    defaultKey: definition.key,
    defaultTempo: definition.tempo,
    sourceMeasures,
    performanceSequence,
    sectionDefinition,
    sectionOccurrence,
    phrase,
    lyricTokens: sourceMeasures.flatMap((measure) => measure.lyricTokens),
    musicalSourceDigest,
    effectiveChordTimeline: chordTimelineState.timeline,
    sourceLeadAtomization,
    presetId: options.presetOverride ?? definition.presetId,
    mode: { profileId: "worship-band-v1", harmonicContext: "band-supported" },
    userCaps: { maxHarmonyTracks: definition.maxHarmonyTracks, allowOctaveDouble: true },
    performers: shuffle(performers, options.shuffleSeed),
    tracks: shuffle(tracks, options.shuffleSeed === undefined ? undefined : options.shuffleSeed + 1),
    assignments: shuffle(assignments, options.shuffleSeed === undefined ? undefined : options.shuffleSeed + 2),
    locks: { intent: [], activity: [], anchor: [], solver: [] },
    priorPersistedPhraseIntent: null,
    expectedTexture: definition.expectedTexture,
    fixtureTags: definition.fixtureTags,
  };
}

export function measureDurationsForCase(prepared: Rc7PreparedCase): readonly Fraction[] {
  return prepared.performanceSequence.occurrences.map((occurrence) => occurrence.duration);
}

export function assertReviewOnlyBoundary(prepared: Rc7PreparedCase): void {
  if (prepared.sourceKind !== "synthetic-original" && prepared.sourceKind !== "quick-review-import") {
    throw new RangeError("REVIEW_HARNESS_SOURCE_KIND_INVALID");
  }
  if (prepared.sourceKind === "synthetic-original" && !prepared.sourceIdentity.startsWith("synthetic-original:")) {
    throw new RangeError("REVIEW_HARNESS_SYNTHETIC_PROVENANCE_MISSING");
  }
}

export const REVIEW_SELECTOR_VERSION = RC7_REVIEW_VERSIONS.responseSelectorVersion;
