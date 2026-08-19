import type { ChordParseResult } from "../chord/model";
import type { BinaryDigest, SemanticDigest } from "../digest/canonical";
import type { Fraction } from "../fraction";
import type { KeySignature, SpelledPitch } from "../pitch";
import type { TimeSignature } from "../meter";
import type { MusicalRange } from "../time";
import type { OmrEvidenceArchive, OmrReviewRecord, SourceEvidenceIndex } from "../omr/foundation";
import type { PerformanceSequence } from "../performance/repeat";
import type { SourceRevisionRecord, SourceRevisionRef } from "./revision";

export type MusicXmlSourceTargetSelector =
  | { readonly kind: "measure"; readonly musicXmlPartOrdinal: number; readonly measureOrdinal: number }
  | { readonly kind: "measure-start"; readonly musicXmlPartOrdinal: number; readonly measureOrdinal: number }
  | { readonly kind: "measure-end"; readonly musicXmlPartOrdinal: number; readonly measureOrdinal: number }
  | { readonly kind: "voice-event"; readonly musicXmlPartOrdinal: number; readonly musicXmlStaffNumber: number; readonly musicXmlVoiceKey: string; readonly measureOrdinal: number; readonly eventOrdinal: number }
  | { readonly kind: "chord-event"; readonly musicXmlPartOrdinal: number; readonly measureOrdinal: number; readonly eventOrdinal: number }
  | { readonly kind: "section-text"; readonly musicXmlPartOrdinal: number; readonly measureOrdinal: number; readonly eventOrdinal: number };
export type MusicXmlCurrentSourceTarget =
  | { readonly kind: "voice-event"; readonly eventId: string }
  | { readonly kind: "chord-event"; readonly chordEventId: string }
  | { readonly kind: "measure" | "measure-start" | "measure-end"; readonly sourceMeasureId: string }
  | { readonly kind: "section-text"; readonly sourceTextId: string };
export type MusicXmlSourceTargetMapEntry =
  | { readonly selector: MusicXmlSourceTargetSelector; readonly status: "mapped-one"; readonly targets: readonly [MusicXmlCurrentSourceTarget] }
  | { readonly selector: MusicXmlSourceTargetSelector; readonly status: "mapped-many"; readonly targets: readonly MusicXmlCurrentSourceTarget[] }
  | { readonly selector: MusicXmlSourceTargetSelector; readonly status: "deleted" | "unresolved"; readonly targets: readonly [] };
export interface MusicXmlSourceTargetMap {
  readonly version: "musicxml-source-target-map-v1";
  readonly sourceRevision: SourceRevisionRef;
  readonly entries: readonly MusicXmlSourceTargetMapEntry[];
  readonly mapDigest: SemanticDigest;
}
export interface OmrRuntimeWarningAcknowledgement {
  readonly diagnosticId: string;
  readonly sourceRevision: SourceRevisionRef;
  readonly acknowledgedAt: string;
}

export type RightsBasis = "self-authored" | "public-domain" | "licensed" | "user-confirmed-rights";
export type AllowedUse = "generation" | "evaluation" | "share" | "provider-transfer";
export interface RightsMetadata {
  readonly basis: RightsBasis;
  readonly allowedUses: readonly AllowedUse[];
  readonly sourceReference?: string;
  readonly licenseNote?: string;
  readonly confirmedAt?: string;
}
export interface TempoSpec {
  readonly beatUnit: 4 | 8;
  readonly dotted: boolean;
  readonly bpm: number;
}
export interface MeasureRepeatDirectives {
  readonly startRepeat: boolean;
  readonly endRepeat?: { readonly totalPasses: 2 | 3 | 4 };
  readonly endingNumbers?: readonly (1 | 2)[];
}
export interface SourceTextEvent {
  readonly id: string;
  readonly sourceMeasureId: string;
  readonly onset: Fraction;
  readonly kind: "section-label" | "rehearsal-mark" | "other";
  readonly text: string;
}
export interface LeadNoteEvent {
  readonly kind: "note";
  readonly id: string;
  readonly sourceMeasureId: string;
  readonly onset: Fraction;
  readonly duration: Fraction;
  readonly pitch: SpelledPitch;
  readonly tieStart: boolean;
  readonly tieStop: boolean;
  readonly lyricTokenIds: readonly string[];
}
export interface LeadRestEvent {
  readonly kind: "rest";
  readonly id: string;
  readonly sourceMeasureId: string;
  readonly onset: Fraction;
  readonly duration: Fraction;
}
export type LeadEvent = LeadNoteEvent | LeadRestEvent;
export interface SourceChordEvent {
  readonly id: string;
  readonly sourceMeasureId: string;
  readonly onset: Fraction;
  readonly sourceText: string;
  readonly parseResult: ChordParseResult;
  readonly source: "manual" | "musicxml" | "omr" | "suggested";
  readonly confirmation: "confirmed" | "unconfirmed";
}
export interface LyricTokenBase {
  readonly id: string;
  readonly text: string;
  readonly syllabic: "single" | "begin" | "middle" | "end";
  readonly leadEventId: string;
  readonly verse: number;
  readonly extend: boolean;
}
export type LyricEmphasisAnnotation =
  | { readonly emphasis: "none"; readonly emphasisSource?: never }
  | { readonly emphasis: "suggested"; readonly emphasisSource: "musicxml-accent" | "metric-heuristic" }
  | { readonly emphasis: "confirmed"; readonly emphasisSource: "manual" | "musicxml-accent" | "metric-heuristic" };
export type LyricToken = LyricTokenBase & LyricEmphasisAnnotation;
export type ProductionLyricEmphasis = "none" | "confirmed" | "musicxml-accent-suggested";
export interface SourceMeasure {
  readonly id: string;
  readonly number: number;
  readonly implicit: boolean;
  readonly time: TimeSignature;
  readonly duration: Fraction;
  readonly key?: KeySignature;
  readonly leadEvents: readonly LeadEvent[];
  readonly chordEvents: readonly SourceChordEvent[];
  readonly lyricTokens: readonly LyricToken[];
  readonly textEvents: readonly SourceTextEvent[];
  readonly repeat: MeasureRepeatDirectives;
}
export type SectionType = "intro" | "verse" | "pre-chorus" | "chorus" | "bridge" | "tag" | "ending" | "other";
export type SectionVariant = "base" | "reprise" | "final" | "drop";
export interface SectionDefinition {
  readonly id: string;
  readonly type: SectionType;
  readonly label: string;
  readonly sourceMeasureIds: readonly string[];
  readonly confirmation: "confirmed" | "suggested";
}
export interface SectionOccurrence {
  readonly id: string;
  readonly sectionDefinitionId: string;
  readonly occurrenceIndex: number;
  readonly variant: SectionVariant;
  readonly lyricVerseIndex: number;
  readonly startPerformanceMeasureIndex: number;
  readonly endPerformanceMeasureIndexExclusive: number;
}
export interface PhraseRegion {
  readonly id: string;
  readonly sectionOccurrenceId: string;
  readonly range: MusicalRange;
  readonly boundarySource: "manual" | "musicxml" | "lead-rest" | "long-note" | "section-boundary" | "automatic-split";
}
interface ImportInfoBase {
  readonly originalFileName?: string;
  readonly importedAt?: string;
  readonly importerVersion: string;
}
export interface ManualImportInfo extends ImportInfoBase {
  readonly sourceKind: "manual";
  readonly rawDigest?: never;
  readonly musicXmlMetadata?: never;
  readonly providerMetadata?: never;
  readonly omrReviewRecord?: never;
  readonly omrEvidenceArchive?: never;
  readonly musicXmlSourceTargetMap?: never;
  readonly omrRuntimeWarningAcknowledgements?: never;
}
export interface MusicXmlImportInfo extends ImportInfoBase {
  readonly sourceKind: "musicxml";
  readonly rawDigest: BinaryDigest;
  readonly musicXmlMetadata: Readonly<Record<string, string>>;
  readonly musicXmlSourceTargetMap: MusicXmlSourceTargetMap;
  readonly providerMetadata?: never;
  readonly omrReviewRecord?: never;
  readonly omrEvidenceArchive?: never;
  readonly omrRuntimeWarningAcknowledgements?: never;
}
export interface OmrImportInfo extends ImportInfoBase {
  readonly sourceKind: "omr";
  readonly rawDigest: BinaryDigest;
  readonly providerMetadata: Readonly<Record<string, string>>;
  readonly omrReviewRecord: OmrReviewRecord;
  readonly omrEvidenceArchive: OmrEvidenceArchive;
  readonly musicXmlSourceTargetMap: MusicXmlSourceTargetMap;
  readonly musicXmlMetadata?: never;
  readonly omrRuntimeWarningAcknowledgements?: readonly OmrRuntimeWarningAcknowledgement[];
}
export type ImportInfo = ManualImportInfo | MusicXmlImportInfo | OmrImportInfo;
export interface SongSourceDocument {
  readonly schemaVersion: 9;
  readonly documentId: string;
  readonly revisionOrdinal: number;
  readonly revisionDigest: SemanticDigest;
  readonly previousRevision?: SourceRevisionRef;
  readonly revisionHistory: readonly SourceRevisionRecord[];
  readonly revisionHistoryDigest: SemanticDigest;
  readonly sourceProvenanceDigest: SemanticDigest;
  readonly title: string;
  readonly composer?: string;
  readonly defaultKey: KeySignature;
  readonly defaultTempo: TempoSpec;
  readonly sourceMeasures: readonly SourceMeasure[];
  readonly performanceSequence: PerformanceSequence;
  readonly sectionDefinitions: readonly SectionDefinition[];
  readonly sectionOccurrences: readonly SectionOccurrence[];
  readonly phraseRegions: readonly PhraseRegion[];
  readonly rights: RightsMetadata;
  readonly importInfo?: ImportInfo;
  readonly sourceEvidence?: SourceEvidenceIndex;
}

export function tempoSpec(beatUnit: 4 | 8, dotted: boolean, bpm: number): TempoSpec {
  if (!Number.isSafeInteger(bpm) || bpm < 20 || bpm > 300) throw new RangeError("tempo bpm must be an integer from 20 to 300");
  return { beatUnit, dotted, bpm };
}

export function validateRights(rights: RightsMetadata): boolean {
  if (new Set(rights.allowedUses).size !== rights.allowedUses.length) return false;
  if (rights.basis === "user-confirmed-rights" && !rights.confirmedAt) return false;
  if (rights.basis === "licensed" && !rights.sourceReference && !rights.licenseNote) return false;
  return true;
}

export function makePhraseId(sectionOccurrenceOrdinal: number, range: MusicalRange): string {
  const position = (value: MusicalRange["start"]) => `${value.performanceMeasureIndex}:${value.offset.n}/${value.offset.d}`;
  return `ph:${sectionOccurrenceOrdinal}:${position(range.start)}:${position(range.end)}`;
}

export function validateSectionPartition(
  definitions: readonly SectionDefinition[],
  occurrences: readonly SectionOccurrence[],
  sourceMeasures: readonly SourceMeasure[],
  performance: PerformanceSequence,
): readonly string[] {
  const errors: string[] = [];
  const sourceIndex = new Map(sourceMeasures.map((measure, index) => [measure.id, index]));
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
  for (const definition of definitions) {
    const indices = definition.sourceMeasureIds.map((id) => sourceIndex.get(id));
    if (indices.some((index) => index === undefined) || new Set(indices).size !== indices.length || indices.some((index, position) => position > 0 && index !== (indices[position - 1] ?? 0) + 1)) {
      errors.push(`definition:${definition.id}`);
    }
  }
  const coverage = Array.from({ length: performance.occurrences.length }, () => 0);
  for (const occurrence of occurrences) {
    const definition = definitionsById.get(occurrence.sectionDefinitionId);
    if (!definition || !Number.isSafeInteger(occurrence.lyricVerseIndex) || occurrence.lyricVerseIndex < 1) {
      errors.push(`occurrence:${occurrence.id}`); continue;
    }
    for (let index = occurrence.startPerformanceMeasureIndex; index < occurrence.endPerformanceMeasureIndexExclusive; index += 1) {
      const performanceOccurrence = performance.occurrences[index];
      if (!performanceOccurrence || !definition.sourceMeasureIds.includes(performanceOccurrence.sourceMeasureId)) errors.push(`coverage:${occurrence.id}:${index}`);
      else coverage[index] += 1;
    }
  }
  coverage.forEach((count, index) => { if (count !== 1) errors.push(`partition:${index}`); });
  return errors;
}
