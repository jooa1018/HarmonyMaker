import { isChordParseResult } from "../chord/parser";
import { digestMusicalSource } from "../digest/source";
import { addFractions, compareFractions, isPositiveFraction } from "../fraction";
import { comparePositions } from "../time";
import {
  validateOmrEvidenceArchive, validateOmrReviewRecord, validateSourceEvidenceIndex,
} from "../omr/foundation";
import {
  hasExactKeys, hasUniqueStrings, isCanonicalFraction, isCanonicalId,
  isCanonicalKeySignature, isCanonicalSpelledPitch, isCanonicalTimeSignature,
  isMusicalRange, isPlainRecord, isSemanticDigest,
} from "../validation";
import { isLyricToken } from "./lyrics";
import type {
  LeadEvent, RightsMetadata, SongSourceDocument, SourceMeasure, TempoSpec,
} from "./model";
import { validateRights, validateSectionPartition } from "./model";
import { hasCanonicalSongSourceOrder } from "./normalize";
import {
  isSourceRevisionRef, validateRevisionHistory, validateRevisionHistoryIntegrity,
} from "./revision";

const SOURCE_KINDS = ["manual", "musicxml", "omr", "suggested"] as const;
const ALLOWED_USES = ["generation", "evaluation", "share", "provider-transfer"] as const;

function isTempoSpec(value: unknown): value is TempoSpec {
  return isPlainRecord(value)
    && hasExactKeys(value, ["beatUnit", "dotted", "bpm"])
    && (value.beatUnit === 4 || value.beatUnit === 8)
    && typeof value.dotted === "boolean"
    && Number.isSafeInteger(value.bpm)
    && (value.bpm as number) >= 20
    && (value.bpm as number) <= 300;
}

function isRightsMetadata(value: unknown): value is RightsMetadata {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["basis", "allowedUses"], ["sourceReference", "licenseNote", "confirmedAt"])
    || !["self-authored", "public-domain", "licensed", "user-confirmed-rights"].includes(String(value.basis))
    || !Array.isArray(value.allowedUses)
    || !value.allowedUses.every((item) => ALLOWED_USES.includes(item as typeof ALLOWED_USES[number]))
    || (value.sourceReference !== undefined && typeof value.sourceReference !== "string")
    || (value.licenseNote !== undefined && typeof value.licenseNote !== "string")
    || (value.confirmedAt !== undefined && typeof value.confirmedAt !== "string")) return false;
  return validateRights(value as unknown as RightsMetadata);
}

function isImportInfo(value: unknown): boolean {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["sourceKind", "importerVersion"], ["originalFileName", "importedAt", "rawDigest", "providerMetadata", "omrReviewRecord", "omrEvidenceArchive"])
    || !["manual", "musicxml", "omr"].includes(String(value.sourceKind))
    || typeof value.importerVersion !== "string" || value.importerVersion.length === 0
    || (value.originalFileName !== undefined && typeof value.originalFileName !== "string")
    || (value.importedAt !== undefined && typeof value.importedAt !== "string")
    || (value.rawDigest !== undefined && !isSemanticDigest(value.rawDigest))
    || (value.providerMetadata !== undefined && (!isPlainRecord(value.providerMetadata)
      || !Object.values(value.providerMetadata).every((item) => typeof item === "string")))
    || (value.omrReviewRecord !== undefined && validateOmrReviewRecord(value.omrReviewRecord).length > 0)
    || (value.omrEvidenceArchive !== undefined && !validateOmrEvidenceArchive(value.omrEvidenceArchive))) return false;
  return true;
}

function isRepeat(value: unknown): boolean {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["startRepeat"], ["endRepeat", "endingNumbers"]) || typeof value.startRepeat !== "boolean") return false;
  if (value.endRepeat !== undefined && (!isPlainRecord(value.endRepeat)
    || !hasExactKeys(value.endRepeat, ["totalPasses"])
    || ![2, 3, 4].includes(value.endRepeat.totalPasses as number))) return false;
  return value.endingNumbers === undefined || (Array.isArray(value.endingNumbers)
    && value.endingNumbers.every((item) => item === 1 || item === 2)
    && new Set(value.endingNumbers).size === value.endingNumbers.length);
}

function isLeadEvent(value: unknown, measureId: string): value is LeadEvent {
  if (!isPlainRecord(value) || !isCanonicalId(value.id) || value.sourceMeasureId !== measureId
    || !isCanonicalFraction(value.onset) || value.onset.n < 0
    || !isCanonicalFraction(value.duration) || !isPositiveFraction(value.duration)) return false;
  if (value.kind === "rest") return hasExactKeys(value, ["kind", "id", "sourceMeasureId", "onset", "duration"]);
  return value.kind === "note"
    && hasExactKeys(value, ["kind", "id", "sourceMeasureId", "onset", "duration", "pitch", "tieStart", "tieStop", "lyricTokenIds"])
    && isCanonicalSpelledPitch(value.pitch)
    && typeof value.tieStart === "boolean"
    && typeof value.tieStop === "boolean"
    && Array.isArray(value.lyricTokenIds)
    && value.lyricTokenIds.every(isCanonicalId)
    && hasUniqueStrings(value.lyricTokenIds);
}

function eventFitsMeasure(event: LeadEvent, measure: SourceMeasure): boolean {
  try {
    return compareFractions(addFractions(event.onset, event.duration), measure.duration) <= 0;
  } catch {
    return false;
  }
}

function isSourceMeasure(value: unknown): value is SourceMeasure {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["id", "number", "implicit", "time", "duration", "leadEvents", "chordEvents", "lyricTokens", "textEvents", "repeat"], ["key"])
    || !isCanonicalId(value.id)
    || !Number.isSafeInteger(value.number)
    || (value.number as number) < 1
    || typeof value.implicit !== "boolean"
    || !isCanonicalTimeSignature(value.time)
    || !isCanonicalFraction(value.duration)
    || !isPositiveFraction(value.duration)
    || (value.key !== undefined && !isCanonicalKeySignature(value.key))
    || !Array.isArray(value.leadEvents)
    || !Array.isArray(value.chordEvents)
    || !Array.isArray(value.lyricTokens)
    || !Array.isArray(value.textEvents)
    || !isRepeat(value.repeat)) return false;
  const measureId = value.id;
  if (!value.leadEvents.every((event) => isLeadEvent(event, measureId))) return false;
  const typedMeasure = value as unknown as SourceMeasure;
  if (!typedMeasure.leadEvents.every((event) => eventFitsMeasure(event, typedMeasure))) return false;
  const leadIds = typedMeasure.leadEvents.map((event) => event.id);
  if (!hasUniqueStrings(leadIds)) return false;
  const lyricIds = value.lyricTokens.map((token) => isPlainRecord(token) ? token.id : undefined);
  if (!lyricIds.every(isCanonicalId) || !hasUniqueStrings(lyricIds as string[])) return false;
  if (!value.lyricTokens.every((token) => isLyricToken(token)
    && isPlainRecord(token)
    && hasExactKeys(token, ["id", "text", "syllabic", "leadEventId", "verse", "extend", "emphasis"], ["emphasisSource"])
    && leadIds.includes(token.leadEventId as string))) return false;
  const lyricById = new Map(typedMeasure.lyricTokens.map((token) => [token.id, token]));
  for (const event of typedMeasure.leadEvents) {
    if (event.kind === "note" && event.lyricTokenIds.some((id) => lyricById.get(id)?.leadEventId !== event.id)) return false;
  }
  if (!value.chordEvents.every((event) => isPlainRecord(event)
    && hasExactKeys(event, ["id", "sourceMeasureId", "onset", "sourceText", "parseResult", "source", "confirmation"])
    && isCanonicalId(event.id)
    && event.sourceMeasureId === measureId
    && isCanonicalFraction(event.onset)
    && event.onset.n >= 0
    && compareFractions(event.onset, typedMeasure.duration) < 0
    && typeof event.sourceText === "string"
    && isChordParseResult(event.parseResult)
    && SOURCE_KINDS.includes(event.source as typeof SOURCE_KINDS[number])
    && (event.confirmation === "confirmed" || event.confirmation === "unconfirmed"))) return false;
  if (!value.textEvents.every((event) => isPlainRecord(event)
    && hasExactKeys(event, ["id", "sourceMeasureId", "onset", "kind", "text"])
    && isCanonicalId(event.id)
    && event.sourceMeasureId === measureId
    && isCanonicalFraction(event.onset)
    && event.onset.n >= 0
    && compareFractions(event.onset, typedMeasure.duration) < 0
    && ["section-label", "rehearsal-mark", "other"].includes(String(event.kind))
    && typeof event.text === "string")) return false;
  return hasUniqueStrings([
    ...leadIds,
    ...value.chordEvents.map((event) => (event as Readonly<Record<string, unknown>>).id as string),
    ...(lyricIds as string[]),
    ...value.textEvents.map((event) => (event as Readonly<Record<string, unknown>>).id as string),
  ]);
}

export function isSongSourceDocument(value: unknown): value is SongSourceDocument {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["schemaVersion", "documentId", "revisionOrdinal", "revisionDigest", "revisionHistory", "revisionHistoryDigest", "title", "defaultKey", "defaultTempo", "sourceMeasures", "performanceSequence", "sectionDefinitions", "sectionOccurrences", "phraseRegions", "rights"], ["previousRevision", "composer", "importInfo", "sourceEvidence"])
    || value.schemaVersion !== 9
    || !isCanonicalId(value.documentId)
    || !Number.isSafeInteger(value.revisionOrdinal)
    || (value.revisionOrdinal as number) < 0
    || !isSemanticDigest(value.revisionDigest)
    || !isSemanticDigest(value.revisionHistoryDigest)
    || (value.previousRevision !== undefined && !isSourceRevisionRef(value.previousRevision))
    || !Array.isArray(value.revisionHistory)
    || typeof value.title !== "string"
    || (value.composer !== undefined && typeof value.composer !== "string")
    || !isCanonicalKeySignature(value.defaultKey)
    || !isTempoSpec(value.defaultTempo)
    || !Array.isArray(value.sourceMeasures)
    || value.sourceMeasures.length === 0
    || !value.sourceMeasures.every(isSourceMeasure)
    || !isPlainRecord(value.performanceSequence)
    || !hasExactKeys(value.performanceSequence, ["expanderVersion", "occurrences"])
    || typeof value.performanceSequence.expanderVersion !== "string"
    || !Array.isArray(value.performanceSequence.occurrences)
    || !Array.isArray(value.sectionDefinitions)
    || !Array.isArray(value.sectionOccurrences)
    || !Array.isArray(value.phraseRegions)
    || !isRightsMetadata(value.rights)) return false;
  const source = value as unknown as SongSourceDocument;
  const current = { documentId: source.documentId, revisionOrdinal: source.revisionOrdinal, revisionDigest: source.revisionDigest };
  if (source.importInfo !== undefined && !isImportInfo(source.importInfo)) return false;
  if (source.sourceEvidence !== undefined && (!validateSourceEvidenceIndex(source.sourceEvidence)
    || !isSourceRevisionRef(source.sourceEvidence.sourceRevision)
    || source.sourceEvidence.sourceRevision.documentId !== current.documentId
    || source.sourceEvidence.sourceRevision.revisionOrdinal !== current.revisionOrdinal
    || source.sourceEvidence.sourceRevision.revisionDigest !== current.revisionDigest)) return false;
  if (!validateRevisionHistory(current, source.revisionHistory)) return false;
  if (source.revisionOrdinal === 0) {
    if (source.previousRevision !== undefined) return false;
  } else if (!source.previousRevision
    || source.previousRevision.revisionOrdinal !== source.revisionOrdinal - 1
    || source.previousRevision.documentId !== source.documentId) return false;
  const measureById = new Map(source.sourceMeasures.map((measure) => [measure.id, measure]));
  if (measureById.size !== source.sourceMeasures.length) return false;
  if (!source.performanceSequence.occurrences.every((occurrence, index) => isPlainRecord(occurrence)
    && hasExactKeys(occurrence, ["occurrenceId", "sourceMeasureId", "sourceMeasureNumber", "occurrenceIndexForSource", "performanceIndex", "time", "duration"])
    && isCanonicalId(occurrence.occurrenceId)
    && isCanonicalId(occurrence.sourceMeasureId)
    && Number.isSafeInteger(occurrence.sourceMeasureNumber)
    && Number.isSafeInteger(occurrence.occurrenceIndexForSource)
    && (occurrence.occurrenceIndexForSource as number) >= 0
    && occurrence.performanceIndex === index
    && isCanonicalTimeSignature(occurrence.time)
    && isCanonicalFraction(occurrence.duration)
    && measureById.has(occurrence.sourceMeasureId as string)
    && measureById.get(occurrence.sourceMeasureId as string)?.number === occurrence.sourceMeasureNumber)) return false;
  if (!hasUniqueStrings(source.performanceSequence.occurrences.map((item) => item.occurrenceId))) return false;
  if (!source.sectionDefinitions.every((definition) => isPlainRecord(definition)
    && hasExactKeys(definition, ["id", "type", "label", "sourceMeasureIds", "confirmation"])
    && isCanonicalId(definition.id)
    && ["intro", "verse", "pre-chorus", "chorus", "bridge", "tag", "ending", "other"].includes(String(definition.type))
    && typeof definition.label === "string"
    && Array.isArray(definition.sourceMeasureIds)
    && definition.sourceMeasureIds.every((id) => isCanonicalId(id) && measureById.has(id))
    && hasUniqueStrings(definition.sourceMeasureIds as string[])
    && (definition.confirmation === "confirmed" || definition.confirmation === "suggested"))) return false;
  const definitionIds = new Set(source.sectionDefinitions.map((item) => item.id));
  if (definitionIds.size !== source.sectionDefinitions.length) return false;
  if (!source.sectionOccurrences.every((occurrence) => isPlainRecord(occurrence)
    && hasExactKeys(occurrence, ["id", "sectionDefinitionId", "occurrenceIndex", "variant", "lyricVerseIndex", "startPerformanceMeasureIndex", "endPerformanceMeasureIndexExclusive"])
    && isCanonicalId(occurrence.id)
    && definitionIds.has(occurrence.sectionDefinitionId as string)
    && Number.isSafeInteger(occurrence.occurrenceIndex)
    && (occurrence.occurrenceIndex as number) >= 0
    && ["base", "reprise", "final", "drop"].includes(String(occurrence.variant))
    && Number.isSafeInteger(occurrence.lyricVerseIndex)
    && (occurrence.lyricVerseIndex as number) >= 1
    && Number.isSafeInteger(occurrence.startPerformanceMeasureIndex)
    && Number.isSafeInteger(occurrence.endPerformanceMeasureIndexExclusive)
    && (occurrence.startPerformanceMeasureIndex as number) >= 0
    && (occurrence.endPerformanceMeasureIndexExclusive as number) > (occurrence.startPerformanceMeasureIndex as number)
    && (occurrence.endPerformanceMeasureIndexExclusive as number) <= source.performanceSequence.occurrences.length)) return false;
  const occurrenceById = new Map(source.sectionOccurrences.map((item) => [item.id, item]));
  if (occurrenceById.size !== source.sectionOccurrences.length) return false;
  if (!source.phraseRegions.every((phrase) => isPlainRecord(phrase)
    && hasExactKeys(phrase, ["id", "sectionOccurrenceId", "range", "boundarySource"])
    && isCanonicalId(phrase.id)
    && occurrenceById.has(phrase.sectionOccurrenceId as string)
    && isMusicalRange(phrase.range)
    && ["manual", "musicxml", "lead-rest", "long-note", "section-boundary", "automatic-split"].includes(String(phrase.boundarySource)))) return false;
  if (!hasUniqueStrings(source.phraseRegions.map((phrase) => phrase.id))) return false;
  for (const phrase of source.phraseRegions) {
    const section = occurrenceById.get(phrase.sectionOccurrenceId);
    if (!section
      || phrase.range.start.performanceMeasureIndex < section.startPerformanceMeasureIndex
      || phrase.range.end.performanceMeasureIndex > section.endPerformanceMeasureIndexExclusive) return false;
  }
  const orderedPhrases = [...source.phraseRegions].sort((left, right) => comparePositions(left.range.start, right.range.start));
  if (orderedPhrases.some((phrase, index) => index > 0 && comparePositions(orderedPhrases[index - 1].range.end, phrase.range.start) > 0)) return false;
  if (validateSectionPartition(source.sectionDefinitions, source.sectionOccurrences, source.sourceMeasures, source.performanceSequence).length > 0) return false;
  return hasCanonicalSongSourceOrder(source);
}

export async function validateSongSourceDocumentIntegrity(value: unknown): Promise<boolean> {
  if (!isSongSourceDocument(value)) return false;
  const current = {
    documentId: value.documentId,
    revisionOrdinal: value.revisionOrdinal,
    revisionDigest: value.revisionDigest,
  };
  return await validateRevisionHistoryIntegrity(
    current,
    value.revisionHistory,
    value.revisionHistoryDigest,
  ) && await digestMusicalSource(value) === value.revisionDigest;
}
