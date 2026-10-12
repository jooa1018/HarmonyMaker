import type { EffectiveChordTimeline, PerformanceChordSpan } from "../harmony/chord-timeline";
import type { SourceLeadAtomization, TimelineAtom } from "../source/atomization";
import type { PhraseRegion, SectionOccurrence, SongSourceDocument } from "../source/model";
import { compareRanges } from "../time";

// These are the existing WAG execution orders, including stable-sort ties.
// Source serialization order is a separate contract and must not be rewritten.
export function canonicalSections(source: SongSourceDocument): readonly SectionOccurrence[] {
  return [...source.sectionOccurrences].sort((left, right) =>
    left.startPerformanceMeasureIndex - right.startPerformanceMeasureIndex
    || left.endPerformanceMeasureIndexExclusive - right.endPerformanceMeasureIndexExclusive
    || left.occurrenceIndex - right.occurrenceIndex);
}
export function canonicalPhrases(source: SongSourceDocument): readonly PhraseRegion[] {
  return [...source.phraseRegions].sort((left, right) => compareRanges(left.range, right.range));
}
export function canonicalAtoms(atomization: SourceLeadAtomization): readonly TimelineAtom[] {
  return [...atomization.atoms].sort((left, right) => compareRanges(left.range, right.range));
}
export function canonicalChordSpans(timeline: EffectiveChordTimeline): readonly PerformanceChordSpan[] {
  return [...timeline.spans].sort((left, right) => compareRanges(left.range, right.range));
}
