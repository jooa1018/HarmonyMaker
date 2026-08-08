import { chordSemanticProjection } from "../chord/parser";
import type { SourceChordEvent, SongSourceDocument } from "../source/model";
import { resolveProductionLyricEmphasis } from "../source/lyrics";
import { normalizeSongSourceDocument } from "../source/normalize";
import { compareCanonicalValues, semanticDigest, type SemanticDigest } from "./canonical";

function chordProjection(event: SourceChordEvent): object | undefined {
  if (event.confirmation !== "confirmed") return undefined;
  if (event.parseResult.status === "ok") return { onset: event.onset, status: "ok", chord: chordSemanticProjection(event.parseResult.chord) };
  if (event.parseResult.status === "no-chord") return { onset: event.onset, status: "no-chord" };
  if (event.parseResult.status === "carry") return { onset: event.onset, status: "carry" };
  return { onset: event.onset, status: "failed", errorCode: event.parseResult.errorCode };
}

export async function digestMusicalSource(source: SongSourceDocument): Promise<SemanticDigest> {
  source = normalizeSongSourceDocument(source);
  const measureOrdinal = new Map(source.sourceMeasures.map((measure, ordinal) => [measure.id, ordinal]));
  const definitionOrdinal = new Map(source.sectionDefinitions.map((definition, ordinal) => [definition.id, ordinal]));
  const sectionOccurrenceOrdinal = new Map(source.sectionOccurrences.map((occurrence, ordinal) => [occurrence.id, ordinal]));
  const measures = source.sourceMeasures.map((measure) => {
    const leadOrdinal = new Map(measure.leadEvents.map((event, ordinal) => [event.id, ordinal]));
    const lyricOrdinal = new Map(measure.lyricTokens.map((token, ordinal) => [token.id, ordinal]));
    return {
      number: measure.number, implicit: measure.implicit, time: measure.time, duration: measure.duration, key: measure.key ?? null,
      leadEvents: measure.leadEvents.map((event) => event.kind === "rest"
        ? { kind: "rest", onset: event.onset, duration: event.duration }
        : { kind: "note", onset: event.onset, duration: event.duration, pitch: event.pitch, tieStart: event.tieStart, tieStop: event.tieStop, lyricTokenOrdinals: event.lyricTokenIds.map((id) => lyricOrdinal.get(id) ?? -1) }),
      chords: measure.chordEvents.map(chordProjection).filter((item): item is object => item !== undefined),
      lyrics: measure.lyricTokens.map((token) => ({ verse: token.verse, leadEventOrdinal: leadOrdinal.get(token.leadEventId) ?? -1, syllabic: token.syllabic, extend: token.extend, productionEmphasis: resolveProductionLyricEmphasis(token) })),
      textEvents: measure.textEvents.map((event) => ({ onset: event.onset, kind: event.kind, text: event.kind === "section-label" ? event.text.normalize("NFC") : null })),
      repeat: measure.repeat,
    };
  });
  const projection = {
    projectionSchema: "hm-musical-source-v1",
    defaultKey: source.defaultKey,
    defaultTempo: source.defaultTempo,
    measures,
    performanceSequence: source.performanceSequence.occurrences.map((occurrence) => ({ sourceMeasureOrdinal: measureOrdinal.get(occurrence.sourceMeasureId), occurrenceIndexForSource: occurrence.occurrenceIndexForSource, performanceIndex: occurrence.performanceIndex, time: occurrence.time, duration: occurrence.duration })),
    sectionDefinitions: source.sectionDefinitions.map((definition) => ({ type: definition.type, sourceMeasureOrdinals: definition.sourceMeasureIds.map((id) => measureOrdinal.get(id)), confirmation: definition.confirmation })),
    sectionOccurrences: source.sectionOccurrences.map((occurrence) => ({ definitionOrdinal: definitionOrdinal.get(occurrence.sectionDefinitionId), occurrenceIndex: occurrence.occurrenceIndex, variant: occurrence.variant, lyricVerseIndex: occurrence.lyricVerseIndex, startPerformanceMeasureIndex: occurrence.startPerformanceMeasureIndex, endPerformanceMeasureIndexExclusive: occurrence.endPerformanceMeasureIndexExclusive })),
    phraseRegions: source.phraseRegions.map((phrase) => ({ sectionOccurrenceOrdinal: sectionOccurrenceOrdinal.get(phrase.sectionOccurrenceId), range: phrase.range })).sort(compareCanonicalValues),
  };
  return semanticDigest(projection);
}
