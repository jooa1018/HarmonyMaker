import { sourceMeasureId } from "../../domain/ids";
import { expandRepeats, type PerformanceSequence } from "../../domain/performance/repeat";
import type { SourceMeasure } from "../../domain/source/model";
import type {
  ImportedPartDraft,
  ImportedSectionDraft,
  ImportedSectionOccurrenceReview,
  LeadVoiceCandidate,
} from "../musicxml/types";

export interface ImportedSectionOccurrenceRun {
  readonly sectionKey: string;
  readonly occurrenceIndex: number;
  readonly startPerformanceMeasureIndex: number;
  readonly endPerformanceMeasureIndexExclusive: number;
  readonly firstSourceMeasureOrdinal: number;
  readonly lastSourceMeasureOrdinal: number;
}

export function importedSectionOccurrenceReviewKey(input: {
  readonly candidateKey: string;
  readonly sectionKey: string;
  readonly occurrenceIndex: number;
  readonly startPerformanceMeasureIndex: number;
  readonly endPerformanceMeasureIndexExclusive: number;
}): string {
  return `section-occurrence:${input.candidateKey.length}:${input.candidateKey}:${input.sectionKey.length}:${input.sectionKey}:i:${input.occurrenceIndex}:p:${input.startPerformanceMeasureIndex}-${input.endPerformanceMeasureIndexExclusive}`;
}

export function buildImportedSectionOccurrenceRuns(
  part: ImportedPartDraft,
  sections: readonly ImportedSectionDraft[],
  performance: PerformanceSequence,
): readonly ImportedSectionOccurrenceRun[] {
  const selectedSections = sections
    .filter((section) => section.partOrdinal === part.partOrdinal)
    .sort((left, right) => left.startMeasureOrdinal - right.startMeasureOrdinal
      || left.endMeasureOrdinalExclusive - right.endMeasureOrdinalExclusive
      || left.key.localeCompare(right.key));
  const sourceOrdinalById = new Map(part.measures.map((measure) => [sourceMeasureId(measure.ordinal), measure.ordinal]));
  const runs: Array<{
    sectionKey: string;
    startPerformanceMeasureIndex: number;
    endPerformanceMeasureIndexExclusive: number;
    firstSourceMeasureOrdinal: number;
    lastSourceMeasureOrdinal: number;
  }> = [];
  for (const occurrence of performance.occurrences) {
    const sourceOrdinal = sourceOrdinalById.get(occurrence.sourceMeasureId);
    if (sourceOrdinal === undefined) throw new RangeError("performance references a missing imported source measure");
    const section = selectedSections.find((candidate) => sourceOrdinal >= candidate.startMeasureOrdinal
      && sourceOrdinal < candidate.endMeasureOrdinalExclusive);
    if (!section) throw new RangeError("section partition has an uncovered performance measure");
    const previous = runs.at(-1);
    if (previous
      && previous.sectionKey === section.key
      && sourceOrdinal > previous.lastSourceMeasureOrdinal) {
      previous.endPerformanceMeasureIndexExclusive = occurrence.performanceIndex + 1;
      previous.lastSourceMeasureOrdinal = sourceOrdinal;
    } else {
      runs.push({
        sectionKey: section.key,
        startPerformanceMeasureIndex: occurrence.performanceIndex,
        endPerformanceMeasureIndexExclusive: occurrence.performanceIndex + 1,
        firstSourceMeasureOrdinal: sourceOrdinal,
        lastSourceMeasureOrdinal: sourceOrdinal,
      });
    }
  }
  const counts = new Map<string, number>();
  return runs.map((run) => {
    const occurrenceIndex = counts.get(run.sectionKey) ?? 0;
    counts.set(run.sectionKey, occurrenceIndex + 1);
    return { ...run, occurrenceIndex };
  });
}

function expanderMeasures(part: ImportedPartDraft): readonly SourceMeasure[] {
  return part.measures.map((measure): SourceMeasure => ({
    id: sourceMeasureId(measure.ordinal),
    number: measure.number,
    implicit: measure.implicit,
    time: measure.time,
    duration: measure.duration,
    ...(measure.key ? { key: measure.key } : {}),
    leadEvents: [],
    chordEvents: [],
    lyricTokens: [],
    textEvents: [],
    repeat: measure.repeat,
  }));
}

export function buildImportedSectionOccurrenceReviews(
  parts: readonly ImportedPartDraft[],
  candidates: readonly LeadVoiceCandidate[],
  sections: readonly ImportedSectionDraft[],
  performanceExpanderVersion: string,
): readonly ImportedSectionOccurrenceReview[] {
  const reviews: ImportedSectionOccurrenceReview[] = [];
  for (const part of parts) {
    const expanded = expandRepeats(expanderMeasures(part), performanceExpanderVersion);
    if (expanded.status === "blocked") continue;
    const runs = buildImportedSectionOccurrenceRuns(part, sections, expanded.sequence);
    const candidatesForPart = candidates.filter((candidate) => candidate.partOrdinal === part.partOrdinal);
    for (const candidate of candidatesForPart) {
      for (const run of runs) {
        const sourceOrdinals = new Set(expanded.sequence.occurrences
          .slice(run.startPerformanceMeasureIndex, run.endPerformanceMeasureIndexExclusive)
          .map((occurrence) => part.measures.find((measure) => sourceMeasureId(measure.ordinal) === occurrence.sourceMeasureId)?.ordinal)
          .filter((ordinal): ordinal is number => ordinal !== undefined));
        const availableLyricVerses = [...new Set(part.measures
          .filter((measure) => sourceOrdinals.has(measure.ordinal))
          .flatMap((measure) => measure.leadEvents
            .filter((event) => event.candidateKey === candidate.key && event.kind === "note")
            .flatMap((event) => event.kind === "note" ? event.lyrics.map((lyric) => lyric.verse) : [])))]
          .sort((left, right) => left - right);
        const identity = {
          candidateKey: candidate.key,
          sectionKey: run.sectionKey,
          occurrenceIndex: run.occurrenceIndex,
          startPerformanceMeasureIndex: run.startPerformanceMeasureIndex,
          endPerformanceMeasureIndexExclusive: run.endPerformanceMeasureIndexExclusive,
        };
        reviews.push({
          key: importedSectionOccurrenceReviewKey(identity),
          ...identity,
          partOrdinal: part.partOrdinal,
          availableLyricVerses,
          ...(availableLyricVerses.length === 1 ? { selectedLyricVerse: availableLyricVerses[0] } : {}),
        });
      }
    }
  }
  return reviews.sort((left, right) => left.partOrdinal - right.partOrdinal
    || left.candidateKey.localeCompare(right.candidateKey)
    || left.startPerformanceMeasureIndex - right.startPerformanceMeasureIndex
    || left.key.localeCompare(right.key));
}
