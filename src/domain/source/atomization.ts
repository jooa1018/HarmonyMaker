import { semanticDigest, type SemanticDigest } from "../digest/canonical";
import type { Diagnostic } from "../diagnostics";
import { addFractions } from "../fraction";
import type { EffectiveChordTimeline } from "../harmony/chord-timeline";
import type { PerformanceSequence } from "../performance/repeat";
import type { SpelledPitch } from "../pitch";
import { comparePositions, musicalRange, positionWithinRange, type MusicalPosition, type MusicalRange } from "../time";
import { resolveProductionLyricEmphasis } from "./lyrics";
import type { LeadEvent, LyricToken, PhraseRegion, SectionOccurrence, SourceMeasure } from "./model";

export interface TimelineAtom {
  readonly id: string;
  readonly sourceEventId: string;
  readonly range: MusicalRange;
  readonly pitch: SpelledPitch | null;
  readonly tiedFromPrevious: boolean;
  readonly tiedToNext: boolean;
  readonly lyricTokenIds: readonly string[];
}
export interface SourceLeadAtomization {
  readonly atomizerVersion: string;
  readonly musicalSourceDigest: SemanticDigest;
  readonly effectiveChordTimelineDigest: SemanticDigest;
  readonly atoms: readonly TimelineAtom[];
  readonly digest: SemanticDigest;
}
export type SourceLeadAtomizationState =
  | { readonly status: "unresolved" }
  | { readonly status: "resolved"; readonly atomization: SourceLeadAtomization; readonly diagnostics: readonly Diagnostic[] }
  | { readonly status: "stale"; readonly previousAtomization: SourceLeadAtomization; readonly diagnostics: readonly Diagnostic[] }
  | { readonly status: "blocked"; readonly previousAtomization?: SourceLeadAtomization; readonly diagnostics: readonly Diagnostic[] };
export interface StageLocalLeadSubAtom { readonly sourceAtomId: string; readonly range: MusicalRange; readonly pitch: SpelledPitch | null; readonly lyricTokenIds: readonly string[] }
export interface LeadAtomReference { readonly sourceLeadAtomizationDigest: SemanticDigest; readonly leadAtomId: string }
export interface SourceLeadAtomizationLookup { readonly atomizationDigest: SemanticDigest; readonly atomById: Readonly<Record<string, TimelineAtom>> }

function containingSection(index: number, sections: readonly SectionOccurrence[]): SectionOccurrence | undefined {
  return sections.find((section) => index >= section.startPerformanceMeasureIndex && index < section.endPerformanceMeasureIndexExclusive);
}

function boundariesForRange(
  range: MusicalRange,
  chordTimeline: EffectiveChordTimeline,
  phrases: readonly PhraseRegion[],
  sections: readonly SectionOccurrence[],
): readonly MusicalPosition[] {
  const values: MusicalPosition[] = [range.start, range.end];
  for (const span of chordTimeline.spans) values.push(span.range.start, span.range.end);
  for (const phrase of phrases) values.push(phrase.range.start, phrase.range.end);
  for (const section of sections) {
    values.push({ performanceMeasureIndex: section.startPerformanceMeasureIndex, offset: { n: 0, d: 1 } });
    values.push({ performanceMeasureIndex: section.endPerformanceMeasureIndexExclusive, offset: { n: 0, d: 1 } });
  }
  const inside = values.filter((position) => comparePositions(position, range.start) >= 0 && comparePositions(position, range.end) <= 0);
  inside.sort(comparePositions);
  return inside.filter((position, index) => index === 0 || comparePositions(position, inside[index - 1]) !== 0);
}

export async function atomizeSourceLead(input: {
  readonly sourceMeasures: readonly SourceMeasure[];
  readonly performanceSequence: PerformanceSequence;
  readonly sectionOccurrences: readonly SectionOccurrence[];
  readonly phraseRegions: readonly PhraseRegion[];
  readonly chordTimeline: EffectiveChordTimeline;
  readonly musicalSourceDigest: SemanticDigest;
  readonly atomizerVersion: string;
}): Promise<SourceLeadAtomization> {
  const measures = new Map(input.sourceMeasures.map((measure, ordinal) => [measure.id, { measure, ordinal }]));
  const durations = input.performanceSequence.occurrences.map((occurrence) => occurrence.duration);
  const atoms: TimelineAtom[] = [];
  const semanticAtoms: object[] = [];
  for (const occurrence of input.performanceSequence.occurrences) {
    const entry = measures.get(occurrence.sourceMeasureId);
    if (!entry) throw new RangeError("performance occurrence references a missing source measure");
    const section = containingSection(occurrence.performanceIndex, input.sectionOccurrences);
    if (!section) throw new RangeError("SECTION_COVERAGE_INVALID");
    const lyricById = new Map(entry.measure.lyricTokens.map((token) => [token.id, token]));
    for (let eventOrdinal = 0; eventOrdinal < entry.measure.leadEvents.length; eventOrdinal += 1) {
      const event = entry.measure.leadEvents[eventOrdinal];
      const start: MusicalPosition = { performanceMeasureIndex: occurrence.performanceIndex, offset: event.onset };
      const rawEnd: MusicalPosition = { performanceMeasureIndex: occurrence.performanceIndex, offset: addFractions(event.onset, event.duration) };
      const eventRange = musicalRange(start, rawEnd, durations);
      const boundaries = boundariesForRange(eventRange, input.chordTimeline, input.phraseRegions, input.sectionOccurrences);
      const selectedTokens: LyricToken[] = event.kind === "note"
        ? event.lyricTokenIds.map((id) => lyricById.get(id)).filter((token): token is LyricToken => token?.verse === section.lyricVerseIndex)
        : [];
      for (let segmentIndex = 0; segmentIndex < boundaries.length - 1; segmentIndex += 1) {
        const range = musicalRange(boundaries[segmentIndex], boundaries[segmentIndex + 1]);
        const tokenProjection = segmentIndex === 0 ? selectedTokens.map((token) => ({ syllabic: token.syllabic, extend: token.extend, emphasis: resolveProductionLyricEmphasis(token) })) : [];
        const projection = {
          occurrenceOrdinal: occurrence.performanceIndex,
          sourceMeasureOrdinal: entry.ordinal,
          sourceEventOrdinal: eventOrdinal,
          range,
          pitch: event.kind === "note" ? event.pitch : null,
          tiedFromPrevious: event.kind === "note" && (event.tieStop || segmentIndex > 0),
          tiedToNext: event.kind === "note" && (event.tieStart || segmentIndex < boundaries.length - 2),
          lyricTokens: tokenProjection,
        };
        const id = `atom:${await semanticDigest({ projectionSchema: "hm-timeline-atom-v1", ...projection })}`;
        atoms.push({ id, sourceEventId: event.id, range, pitch: event.kind === "note" ? event.pitch : null, tiedFromPrevious: projection.tiedFromPrevious, tiedToNext: projection.tiedToNext, lyricTokenIds: segmentIndex === 0 ? selectedTokens.map((token) => token.id) : [] });
        semanticAtoms.push(projection);
      }
    }
  }
  atoms.sort((a, b) => comparePositions(a.range.start, b.range.start) || a.id.localeCompare(b.id));
  const digest = await semanticDigest({ projectionSchema: "hm-source-lead-atomization-v1", atomizerVersion: input.atomizerVersion, musicalSourceDigest: input.musicalSourceDigest, effectiveChordTimelineDigest: input.chordTimeline.digest, atoms: semanticAtoms });
  return { atomizerVersion: input.atomizerVersion, musicalSourceDigest: input.musicalSourceDigest, effectiveChordTimelineDigest: input.chordTimeline.digest, atoms, digest };
}

export function createAtomizationLookup(atomization: SourceLeadAtomization): SourceLeadAtomizationLookup {
  const entries = atomization.atoms.map((atom) => [atom.id, atom] as const);
  if (new Set(entries.map(([id]) => id)).size !== entries.length) throw new RangeError("duplicate TimelineAtom ID");
  return { atomizationDigest: atomization.digest, atomById: Object.fromEntries(entries) };
}

export function resolveLeadAtomReference(reference: LeadAtomReference, lookup: SourceLeadAtomizationLookup): TimelineAtom | undefined {
  return reference.sourceLeadAtomizationDigest === lookup.atomizationDigest ? lookup.atomById[reference.leadAtomId] : undefined;
}

export function createStageLocalSubAtom(atom: TimelineAtom, range: MusicalRange): StageLocalLeadSubAtom {
  if (!positionWithinRange(range.start, atom.range) || comparePositions(range.end, atom.range.end) > 0) throw new RangeError("stage-local split must stay inside its source atom");
  return { sourceAtomId: atom.id, range, pitch: atom.pitch, lyricTokenIds: atom.lyricTokenIds };
}
