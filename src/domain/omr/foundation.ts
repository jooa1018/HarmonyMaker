import type { BinaryDigest, SemanticDigest } from "../digest/canonical";
import type { Diagnostic, DiagnosticCode } from "../diagnostics";
import type { Fraction } from "../fraction";
import type { Alter, KeySignature, SpelledPitch } from "../pitch";
import type { TimeSignature } from "../meter";
import type { ResolvedChordParseResult } from "../chord/model";
import type { SourceRevisionRef } from "../source/revision";

export type OmrCorrectionTarget =
  | { readonly kind: "voice-event"; readonly eventId: string }
  | { readonly kind: "chord-event"; readonly chordEventId: string }
  | { readonly kind: "measure"; readonly sourceMeasureId: string }
  | { readonly kind: "measure-start"; readonly sourceMeasureId: string }
  | { readonly kind: "measure-end"; readonly sourceMeasureId: string }
  | { readonly kind: "section-text"; readonly sourceTextId: string };
export interface RevisionScopedTarget { readonly sourceRevision: SourceRevisionRef; readonly target: OmrCorrectionTarget }
export type ReplacementLeadEventPayload =
  | { readonly kind: "note"; readonly onset: Fraction; readonly duration: Fraction; readonly pitch: SpelledPitch; readonly tieStart: boolean; readonly tieStop: boolean }
  | { readonly kind: "rest"; readonly onset: Fraction; readonly duration: Fraction };
export type OmrCorrectionPatch =
  | { readonly kind: "pitch"; readonly pitch: SpelledPitch }
  | { readonly kind: "duration"; readonly duration: Fraction }
  | { readonly kind: "accidental"; readonly alter: Alter }
  | { readonly kind: "chord"; readonly parseResult: ResolvedChordParseResult }
  | { readonly kind: "time-signature"; readonly value: TimeSignature }
  | { readonly kind: "key-signature"; readonly value: KeySignature }
  | { readonly kind: "tie"; readonly tieStart: boolean; readonly tieStop: boolean }
  | { readonly kind: "replace-event"; readonly event: ReplacementLeadEventPayload }
  | { readonly kind: "replace-source-text"; readonly text: string }
  | { readonly kind: "insert-barline" | "delete-barline" };
export type EvidenceGranularity = "none" | "page" | "staff" | "measure" | "symbol";
export interface OmrEvidence { readonly id: string; readonly vendorTargetId?: string; readonly granularity: EvidenceGranularity; readonly vendorId: string }
export interface EvidenceTargetMapping { readonly vendorTargetId: string; readonly target: RevisionScopedTarget }
export interface VendorEvidenceBundle { readonly granularity: EvidenceGranularity; readonly evidence: readonly OmrEvidence[]; readonly providerBundleDigest: SemanticDigest }
export interface SourceEvidenceIndex { readonly sourceRevision: SourceRevisionRef; readonly mappingVersion: string; readonly providerBundleDigest: SemanticDigest; readonly evidence: readonly OmrEvidence[]; readonly targetMappings: readonly EvidenceTargetMapping[]; readonly bundleDigest: SemanticDigest }
export interface OmrEvidenceArchive { readonly sourceRevision: SourceRevisionRef; readonly providerBundleDigest: SemanticDigest; readonly unmappedEvidence: readonly OmrEvidence[]; readonly archiveDigest: SemanticDigest }
export interface OmrReviewAlternative { readonly id: string; readonly labelKo: string; readonly patch: OmrCorrectionPatch }
export interface OmrReviewItem { readonly id: string; readonly target: RevisionScopedTarget; readonly reasonCode: DiagnosticCode; readonly alternatives: readonly OmrReviewAlternative[]; readonly evidenceIds: readonly string[] }
export interface OmrCorrectionRecord { readonly id: string; readonly reviewItemId?: string; readonly target: RevisionScopedTarget; readonly beforeProjection: string; readonly patch: OmrCorrectionPatch; readonly source: "auto-accepted" | "review-alternative" | "manual"; readonly appliedAt: string }
export interface OmrReviewRecord { readonly vendorResultDigest: BinaryDigest; readonly vendorId: string; readonly corrections: readonly OmrCorrectionRecord[]; readonly reviewItems: readonly OmrReviewItem[]; readonly diagnostics?: readonly Diagnostic[] }

