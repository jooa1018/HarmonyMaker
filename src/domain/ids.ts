import type { ArrangementPresetId } from "./config";
import type { SemanticDigest } from "./digest/canonical";
import type { Fraction } from "./fraction";
import type { SectionType } from "./source/model";
import type { MusicalPosition } from "./time";

function ordinal(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer`);
  return value;
}
export const fractionKey = (value: Fraction): string => `${value.n}/${value.d}`;
export const positionKey = (value: MusicalPosition): string => `${ordinal(value.performanceMeasureIndex, "measure index")}:${fractionKey(value.offset)}`;
export const sourceRevisionId = (revisionOrdinal: number, digest: SemanticDigest): string => `rev:${ordinal(revisionOrdinal, "revision ordinal")}:${digest}`;
export const sourceMeasureId = (sourceMeasureIndex: number): string => `sm:${ordinal(sourceMeasureIndex, "source measure index")}`;
export const leadEventId = (sourceMeasureIndex: number, eventOrdinal: number): string => `le:${ordinal(sourceMeasureIndex, "source measure index")}:${ordinal(eventOrdinal, "event ordinal")}`;
export const sourceChordEventId = (sourceMeasureIndex: number, chordOrdinal: number): string => `ch:${ordinal(sourceMeasureIndex, "source measure index")}:${ordinal(chordOrdinal, "chord ordinal")}`;
export const lyricTokenId = (sourceMeasureIndex: number, leadEventOrdinal: number, verse: number, tokenOrdinal: number): string => `ly:${ordinal(sourceMeasureIndex, "source measure index")}:${ordinal(leadEventOrdinal, "lead event ordinal")}:${ordinal(verse - 1, "verse") + 1}:${ordinal(tokenOrdinal, "token ordinal")}`;
export const performanceOccurrenceId = (performanceIndex: number, sourceMeasureIndex: number, sourceOccurrenceIndex: number): string => `pm:${ordinal(performanceIndex, "performance index")}:${ordinal(sourceMeasureIndex, "source measure index")}:${ordinal(sourceOccurrenceIndex, "source occurrence index")}`;
export const sectionDefinitionId = (sourceStart: number, sourceEndExclusive: number, type: SectionType, duplicateOrdinal: number): string => `sd:${ordinal(sourceStart, "source start")}:${ordinal(sourceEndExclusive, "source end")}:${type}:${ordinal(duplicateOrdinal, "definition ordinal")}`;
export const sectionOccurrenceId = (performanceStart: number, performanceEndExclusive: number, definitionOrdinal: number): string => `so:${ordinal(performanceStart, "performance start")}:${ordinal(performanceEndExclusive, "performance end")}:${ordinal(definitionOrdinal, "definition ordinal")}`;
export const phraseRegionId = (sectionOccurrenceOrdinal: number, start: MusicalPosition, end: MusicalPosition): string => `ph:${ordinal(sectionOccurrenceOrdinal, "section occurrence ordinal")}:${positionKey(start)}:${positionKey(end)}`;
export const harmonyTrackId = (trackOrdinal: 1 | 2): string => `track:h${trackOrdinal}`;
export const performanceChordSpanId = (start: MusicalPosition, end: MusicalPosition): string => `pcs:${positionKey(start)}:${positionKey(end)}`;
export const timelineAtomId = (performanceMeasureIndex: number, sourceEventOrdinal: number, startOffset: Fraction, endOffset: Fraction): string => `ta:${ordinal(performanceMeasureIndex, "performance measure index")}:${ordinal(sourceEventOrdinal, "source event ordinal")}:${fractionKey(startOffset)}:${fractionKey(endOffset)}`;
export const sectionIntentId = (preset: ArrangementPresetId, sectionOccurrenceOrdinal: number): string => `si:${preset}:${ordinal(sectionOccurrenceOrdinal, "section occurrence ordinal")}`;
export const phraseIntentId = (preset: ArrangementPresetId, phraseOrdinal: number): string => `pi:${preset}:${ordinal(phraseOrdinal, "phrase ordinal")}`;
export const performerId = (performerOrdinal: number): string => `pf:${ordinal(performerOrdinal, "performer ordinal")}`;

