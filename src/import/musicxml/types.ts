import type { ChordParseResult } from "../../domain/chord/model";
import type { BinaryDigest } from "../../domain/digest/canonical";
import type { Diagnostic } from "../../domain/diagnostics";
import type { Fraction } from "../../domain/fraction";
import type { TimeSignature } from "../../domain/meter";
import type { PerformerProfile } from "../../domain/performer";
import type { KeySignature, SpelledPitch } from "../../domain/pitch";
import type {
  MeasureRepeatDirectives,
  RightsMetadata,
  SectionType,
  TempoSpec,
} from "../../domain/source/model";

export const MUSICXML_IMPORTER_VERSION = "hm-musicxml-import-v1";

export interface ImportSecurityLimits {
  readonly maxXmlBytes: number;
  readonly maxArchiveBytes: number;
  readonly maxArchiveEntries: number;
  readonly maxEntryCompressedBytes: number;
  readonly maxEntryUncompressedBytes: number;
  readonly maxTotalUncompressedBytes: number;
  readonly maxCompressionRatio: number;
  readonly maxArchivePathBytes: number;
  readonly maxXmlDepth: number;
}

export const DEFAULT_IMPORT_SECURITY_LIMITS: ImportSecurityLimits = Object.freeze({
  maxXmlBytes: 4_000_000,
  maxArchiveBytes: 8_000_000,
  maxArchiveEntries: 64,
  maxEntryCompressedBytes: 4_000_000,
  maxEntryUncompressedBytes: 4_000_000,
  maxTotalUncompressedBytes: 12_000_000,
  maxCompressionRatio: 100,
  maxArchivePathBytes: 512,
  maxXmlDepth: 128,
});

export interface ImportedLyricDraft {
  readonly text: string;
  readonly verse: number;
  readonly syllabic: "single" | "begin" | "middle" | "end";
  readonly extend: boolean;
  readonly musicXmlAccent: boolean;
}

export type ImportedLeadEventDraft =
  | {
      readonly kind: "note";
      readonly candidateKey: string;
      readonly onset: Fraction;
      readonly duration: Fraction;
      readonly pitch: SpelledPitch;
      readonly tieStart: boolean;
      readonly tieStop: boolean;
      readonly lyrics: readonly ImportedLyricDraft[];
    }
  | {
      readonly kind: "rest";
      readonly candidateKey: string;
      readonly onset: Fraction;
      readonly duration: Fraction;
    };

export interface ImportedChordDraft {
  readonly key: string;
  readonly partOrdinal: number;
  readonly measureOrdinal: number;
  readonly onset: Fraction;
  readonly sourceText: string;
  readonly parseResult: ChordParseResult;
  readonly source: "musicxml" | "manual";
  readonly confirmation: "confirmed" | "unconfirmed";
}

export interface ImportedTextDraft {
  readonly onset: Fraction;
  readonly kind: "section-label" | "rehearsal-mark" | "other";
  readonly text: string;
}

export interface ImportedMeasureDraft {
  readonly ordinal: number;
  readonly number: number;
  readonly implicit: boolean;
  readonly time: TimeSignature;
  readonly duration: Fraction;
  readonly key?: KeySignature;
  readonly importedFifths?: number;
  readonly leadEvents: readonly ImportedLeadEventDraft[];
  readonly chords: readonly ImportedChordDraft[];
  readonly textEvents: readonly ImportedTextDraft[];
  readonly repeat: MeasureRepeatDirectives;
}

export interface ImportedPartDraft {
  readonly partOrdinal: number;
  readonly displayPartName: string;
  readonly measures: readonly ImportedMeasureDraft[];
}

export interface LeadVoiceCandidate {
  readonly key: string;
  readonly partOrdinal: number;
  readonly staffNumber: number;
  readonly voiceKey: string;
  readonly displayPartName: string;
  readonly noteCount: number;
  readonly lyricCount: number;
  readonly pitchRangePreview?: {
    readonly low: SpelledPitch;
    readonly high: SpelledPitch;
  };
  readonly measureCoverage: readonly number[];
}

export interface ImportedSectionDraft {
  readonly key: string;
  readonly partOrdinal: number;
  readonly startMeasureOrdinal: number;
  readonly endMeasureOrdinalExclusive: number;
  readonly type: SectionType;
  readonly label: string;
  readonly confirmation: "confirmed" | "suggested";
}

export interface UnsupportedPerformanceFlow {
  readonly id: string;
  readonly partOrdinal: number;
  readonly measureOrdinal: number;
  readonly text: string;
}

export interface PerformerReviewSlot {
  readonly id: string;
  readonly displayName: string;
  readonly profile?: PerformerProfile;
}

export interface MusicXmlImportDraft {
  readonly importerVersion: typeof MUSICXML_IMPORTER_VERSION;
  readonly documentId: string;
  readonly rawDigest: BinaryDigest;
  readonly containerKind: "xml" | "mxl";
  readonly originalFileName?: string;
  readonly title: string;
  readonly composer?: string;
  readonly parts: readonly ImportedPartDraft[];
  readonly leadCandidates: readonly LeadVoiceCandidate[];
  readonly selectedLeadStaffKey?: string;
  readonly sections: readonly ImportedSectionDraft[];
  readonly unsupportedPerformanceFlows: readonly UnsupportedPerformanceFlow[];
  readonly defaultKey?: KeySignature;
  readonly defaultTempo?: TempoSpec;
  readonly selectedLyricVerse?: number;
  readonly singerCount: 1 | 2 | 3;
  readonly performerSlots: readonly PerformerReviewSlot[];
  readonly rights?: RightsMetadata;
  readonly diagnostics: readonly Diagnostic[];
}

export type MusicImportResult =
  | {
      readonly status: "review-required";
      readonly draft: MusicXmlImportDraft;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly status: "blocked";
      readonly diagnostics: readonly Diagnostic[];
    };

export interface Step3ImportVersions {
  readonly performanceExpanderVersion: string;
  readonly chordTimelineResolverVersion: string;
  readonly sourceLeadAtomizerVersion: string;
}

export const STEP3_IMPORT_VERSIONS: Step3ImportVersions = Object.freeze({
  performanceExpanderVersion: "repeat-v1",
  chordTimelineResolverVersion: "chord-timeline-v1",
  sourceLeadAtomizerVersion: "source-lead-atomizer-v1",
});

export type DocumentIdentityFactory = () => string;
