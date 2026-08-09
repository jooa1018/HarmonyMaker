import { chordSemanticProjection } from "../chord/parser";
import { canonicalJson, compareCanonicalValues } from "../digest/canonical";
import { resolveProductionLyricEmphasis } from "./lyrics";
import type {
  LeadEvent, LyricToken, SectionDefinition, SectionOccurrence,
  SongSourceDocument, SourceChordEvent, SourceMeasure, SourceTextEvent,
} from "./model";

interface Projected<T> {
  readonly value: T;
  readonly projection: object;
}

function sortUnique<T>(
  values: readonly T[],
  project: (value: T) => object,
  label: string,
): readonly Projected<T>[] {
  const projected = values
    .map((value) => ({ value, projection: project(value) }))
    .sort((left, right) => compareCanonicalValues(left.projection, right.projection));
  for (let index = 1; index < projected.length; index += 1) {
    if (compareCanonicalValues(projected[index - 1].projection, projected[index].projection) === 0) {
      throw new RangeError(`duplicate semantic ${label}`);
    }
  }
  return projected;
}

function leadOrderingProjection(event: LeadEvent): object {
  return event.kind === "rest"
    ? { kind: "rest", onset: event.onset, duration: event.duration }
    : {
        kind: "note",
        onset: event.onset,
        duration: event.duration,
        pitch: event.pitch,
        tieStart: event.tieStart,
        tieStop: event.tieStop,
      };
}

function chordOrderingProjection(event: SourceChordEvent): object {
  const parseResult = event.parseResult.status === "ok"
    ? { status: "ok", chord: chordSemanticProjection(event.parseResult.chord) }
    : event.parseResult.status === "failed"
      ? { status: "failed", errorCode: event.parseResult.errorCode, token: event.parseResult.token ?? null }
      : { status: event.parseResult.status };
  return {
    onset: event.onset,
    parseResult,
    source: event.source,
    confirmation: event.confirmation,
  };
}

function lyricOrderingProjection(
  token: LyricToken,
  leadOrdinalById: Readonly<Record<string, number>>,
): object {
  return {
    verse: token.verse,
    leadEventOrdinal: leadOrdinalById[token.leadEventId],
    syllabic: token.syllabic,
    extend: token.extend,
    productionEmphasis: resolveProductionLyricEmphasis(token),
  };
}

function textOrderingProjection(event: SourceTextEvent): object {
  return {
    onset: event.onset,
    kind: event.kind,
    text: event.kind === "section-label" ? event.text.normalize("NFC") : null,
  };
}

function normalizeMeasure(measure: SourceMeasure): SourceMeasure {
  const leads = sortUnique(measure.leadEvents, leadOrderingProjection, "lead event");
  const leadOrdinalById = Object.fromEntries(leads.map((entry, index) => [entry.value.id, index]));
  const lyrics = sortUnique(
    measure.lyricTokens,
    (token) => lyricOrderingProjection(token, leadOrdinalById),
    "lyric token",
  );
  const lyricOrdinalById = Object.fromEntries(lyrics.map((entry, index) => [entry.value.id, index]));
  const leadEvents = leads.map(({ value }) => value.kind === "rest"
    ? value
    : {
        ...value,
        lyricTokenIds: [...value.lyricTokenIds].sort(
          (left, right) => (lyricOrdinalById[left] ?? -1) - (lyricOrdinalById[right] ?? -1),
        ),
      });
  return {
    ...measure,
    leadEvents,
    chordEvents: sortUnique(
      measure.chordEvents,
      chordOrderingProjection,
      "chord event",
    ).map((entry) => entry.value),
    lyricTokens: lyrics.map((entry) => entry.value),
    textEvents: sortUnique(
      measure.textEvents,
      textOrderingProjection,
      "text event",
    ).map((entry) => entry.value),
  };
}

function definitionProjection(
  definition: SectionDefinition,
  measureOrdinalById: Readonly<Record<string, number>>,
): object {
  return {
    type: definition.type,
    sourceMeasureOrdinals: definition.sourceMeasureIds.map((id) => measureOrdinalById[id]),
    confirmation: definition.confirmation,
  };
}

function occurrenceProjection(
  occurrence: SectionOccurrence,
  definitionOrdinalById: Readonly<Record<string, number>>,
): object {
  return {
    definitionOrdinal: definitionOrdinalById[occurrence.sectionDefinitionId],
    occurrenceIndex: occurrence.occurrenceIndex,
    variant: occurrence.variant,
    lyricVerseIndex: occurrence.lyricVerseIndex,
    startPerformanceMeasureIndex: occurrence.startPerformanceMeasureIndex,
    endPerformanceMeasureIndexExclusive: occurrence.endPerformanceMeasureIndexExclusive,
  };
}

export function normalizeSongSourceDocument(source: SongSourceDocument): SongSourceDocument {
  const sourceMeasures = source.sourceMeasures.map(normalizeMeasure);
  const measureOrdinalById = Object.fromEntries(
    sourceMeasures.map((measure, index) => [measure.id, index]),
  );
  const sectionDefinitions = sortUnique(
    source.sectionDefinitions,
    (definition) => definitionProjection(definition, measureOrdinalById),
    "section definition",
  );
  const definitionOrdinalById = Object.fromEntries(
    sectionDefinitions.map((entry, index) => [entry.value.id, index]),
  );
  const sectionOccurrences = sortUnique(
    source.sectionOccurrences,
    (occurrence) => occurrenceProjection(occurrence, definitionOrdinalById),
    "section occurrence",
  );
  const occurrenceOrdinalById = Object.fromEntries(
    sectionOccurrences.map((entry, index) => [entry.value.id, index]),
  );
  const phraseRegions = sortUnique(
    source.phraseRegions,
    (phrase) => ({
      sectionOccurrenceOrdinal: occurrenceOrdinalById[phrase.sectionOccurrenceId],
      range: phrase.range,
    }),
    "phrase region",
  );
  return {
    ...source,
    sourceMeasures,
    performanceSequence: {
      ...source.performanceSequence,
      occurrences: [...source.performanceSequence.occurrences]
        .sort((left, right) => left.performanceIndex - right.performanceIndex),
    },
    sectionDefinitions: sectionDefinitions.map((entry) => entry.value),
    sectionOccurrences: sectionOccurrences.map((entry) => entry.value),
    phraseRegions: phraseRegions.map((entry) => entry.value),
    rights: {
      ...source.rights,
      allowedUses: [...source.rights.allowedUses].sort(),
    },
  };
}

export function hasCanonicalSongSourceOrder(source: SongSourceDocument): boolean {
  try {
    const normalized = normalizeSongSourceDocument(source);
    const ids = (document: SongSourceDocument) => ({
      measures: document.sourceMeasures.map((measure) => ({
        id: measure.id,
        lead: measure.leadEvents.map((event) => ({ id: event.id, lyricTokenIds: event.kind === "note" ? event.lyricTokenIds : [] })),
        chord: measure.chordEvents.map((event) => event.id),
        lyric: measure.lyricTokens.map((token) => token.id),
        text: measure.textEvents.map((event) => event.id),
      })),
      performance: document.performanceSequence.occurrences.map((item) => item.occurrenceId),
      definitions: document.sectionDefinitions.map((item) => item.id),
      occurrences: document.sectionOccurrences.map((item) => item.id),
      phrases: document.phraseRegions.map((item) => item.id),
      allowedUses: document.rights.allowedUses,
    });
    return canonicalJson(ids(source)) === canonicalJson(ids(normalized));
  } catch {
    return false;
  }
}
