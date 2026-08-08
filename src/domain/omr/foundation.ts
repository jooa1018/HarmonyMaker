import type { BinaryDigest, SemanticDigest } from "../digest/canonical";
import type { Diagnostic, DiagnosticCode } from "../diagnostics";
import type { Fraction } from "../fraction";
import type { Alter, KeySignature, SpelledPitch } from "../pitch";
import type { TimeSignature } from "../meter";
import type { ResolvedChordParseResult } from "../chord/model";
import { remapSourceId, type SourceEntityKind, type SourceIdRemap, type SourceRevisionRef } from "../source/revision";
import { canonicalJson, semanticDigest } from "../digest/canonical";

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
export type CoordinateSpace = "original-pixels" | "normalized-original" | "processed-pixels";
export type CoordinateMicrounit = number & { readonly __brand: "CoordinateMicrounit" };
export type MatrixCoefficientNanounit = number & { readonly __brand: "MatrixCoefficientNanounit" };
export interface ImageCoordinateFrame { readonly id: string; readonly pageIndex: number; readonly coordinateSpace: CoordinateSpace; readonly widthPixels: number; readonly heightPixels: number; readonly imageDigest: BinaryDigest }
export interface BoundingBox { readonly frameId: string; readonly xMu: CoordinateMicrounit; readonly yMu: CoordinateMicrounit; readonly widthMu: CoordinateMicrounit; readonly heightMu: CoordinateMicrounit }
export interface ImageTransform { readonly id: string; readonly pageIndex: number; readonly sourceFrameId: string; readonly targetFrameId: string; readonly matrix3x3Nano: readonly MatrixCoefficientNanounit[]; readonly inverseMatrix3x3Nano?: readonly MatrixCoefficientNanounit[] }
export interface OmrEvidence { readonly id: string; readonly vendorTargetId?: string; readonly granularity: EvidenceGranularity; readonly box: BoundingBox; readonly transformId?: string; readonly confidenceBp?: import("../rates").BasisPoints; readonly vendorId: string }
export interface EvidenceTargetMapping { readonly vendorTargetId: string; readonly target: RevisionScopedTarget }
export interface VendorEvidenceBundle { readonly granularity: EvidenceGranularity; readonly frames: readonly ImageCoordinateFrame[]; readonly transforms: readonly ImageTransform[]; readonly evidence: readonly OmrEvidence[]; readonly providerBundleDigest: SemanticDigest }
export interface SourceEvidenceIndex { readonly sourceRevision: SourceRevisionRef; readonly mappingVersion: string; readonly providerBundleDigest: SemanticDigest; readonly frames: readonly ImageCoordinateFrame[]; readonly transforms: readonly ImageTransform[]; readonly evidence: readonly OmrEvidence[]; readonly targetMappings: readonly EvidenceTargetMapping[]; readonly bundleDigest: SemanticDigest }
export interface OmrEvidenceArchive { readonly sourceRevision: SourceRevisionRef; readonly providerBundleDigest: SemanticDigest; readonly frames: readonly ImageCoordinateFrame[]; readonly transforms: readonly ImageTransform[]; readonly unmappedEvidence: readonly OmrEvidence[]; readonly archiveDigest: SemanticDigest }
export interface OmrReviewAlternative { readonly id: string; readonly labelKo: string; readonly patch: OmrCorrectionPatch }
export type OmrReviewResolution = { readonly status: "open" } | { readonly status: "accepted"; readonly selectedAlternativeId: string; readonly correctionRecordId: string } | { readonly status: "rejected"; readonly rejectedAlternativeIds: readonly string[] } | { readonly status: "manually-corrected"; readonly correctionRecordId: string };
export interface OmrReviewItem { readonly id: string; readonly target: RevisionScopedTarget; readonly reasonCode: DiagnosticCode; readonly alternatives: readonly OmrReviewAlternative[]; readonly evidenceIds: readonly string[]; readonly resolution: OmrReviewResolution }
export interface OmrCorrectionRecord { readonly id: string; readonly reviewItemId?: string; readonly target: RevisionScopedTarget; readonly beforeProjection: string; readonly patch: OmrCorrectionPatch; readonly source: "auto-accepted" | "review-alternative" | "manual"; readonly appliedAt: string }
export interface OmrReviewRecord { readonly vendorResultDigest: BinaryDigest; readonly vendorId: string; readonly corrections: readonly OmrCorrectionRecord[]; readonly reviewItems: readonly OmrReviewItem[]; readonly diagnostics?: readonly Diagnostic[] }

function revisionEqual(left: SourceRevisionRef, right: SourceRevisionRef): boolean {
  return left.documentId === right.documentId && left.revisionOrdinal === right.revisionOrdinal && left.revisionDigest === right.revisionDigest;
}
export function isCorrectionPatchCompatible(target: OmrCorrectionTarget, patch: OmrCorrectionPatch): boolean {
  if (["pitch", "duration", "accidental", "tie", "replace-event"].includes(patch.kind)) return target.kind === "voice-event";
  if (patch.kind === "chord") return target.kind === "chord-event";
  if (patch.kind === "time-signature" || patch.kind === "key-signature") return target.kind === "measure-start";
  if (patch.kind === "insert-barline" || patch.kind === "delete-barline") return target.kind === "measure-end";
  return patch.kind === "replace-source-text" && target.kind === "section-text";
}
export function validateOmrReviewRecord(record: OmrReviewRecord): readonly string[] {
  const errors: string[] = [];
  const corrections = new Map(record.corrections.map((correction) => [correction.id, correction]));
  for (const item of record.reviewItems) {
    if (new Set(item.alternatives.map((alternative) => alternative.id)).size !== item.alternatives.length) errors.push(`OMR_REVIEW_RESOLUTION_INVALID:${item.id}:duplicate-alternative`);
    if (item.resolution.status === "accepted") {
      const resolution = item.resolution;
      const alternative = item.alternatives.find((candidate) => candidate.id === resolution.selectedAlternativeId);
      const correction = corrections.get(resolution.correctionRecordId);
      if (!alternative || !correction || correction.reviewItemId !== item.id || correction.source !== "review-alternative" || canonicalJson(alternative.patch) !== canonicalJson(correction.patch)) errors.push(`OMR_REVIEW_RESOLUTION_INVALID:${item.id}`);
    } else if (item.resolution.status === "manually-corrected") {
      const correction = corrections.get(item.resolution.correctionRecordId);
      if (!correction || correction.reviewItemId !== item.id || correction.source !== "manual") errors.push(`OMR_REVIEW_RESOLUTION_INVALID:${item.id}`);
    } else if (item.resolution.status === "rejected") {
      const ids = new Set(item.alternatives.map((alternative) => alternative.id));
      if (new Set(item.resolution.rejectedAlternativeIds).size !== item.resolution.rejectedAlternativeIds.length || item.resolution.rejectedAlternativeIds.some((id) => !ids.has(id))) errors.push(`OMR_REVIEW_RESOLUTION_INVALID:${item.id}`);
    }
  }
  return errors;
}

export function coordinateMicrounit(value: number): CoordinateMicrounit {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("coordinate must be a non-negative safe integer");
  return value as CoordinateMicrounit;
}
export function matrixCoefficientNanounit(value: number): MatrixCoefficientNanounit {
  if (!Number.isSafeInteger(value)) throw new RangeError("matrix coefficient must be a safe integer");
  return value as MatrixCoefficientNanounit;
}
export function remapRevisionScopedTarget(target: RevisionScopedTarget, remap: SourceIdRemap): RevisionScopedTarget | undefined {
  if (!revisionEqual(target.sourceRevision, remap.fromRevision)) return undefined;
  const kindByTarget: Readonly<Record<OmrCorrectionTarget["kind"], SourceEntityKind>> = { "voice-event": "lead-event", "chord-event": "chord-event", measure: "measure", "measure-start": "measure", "measure-end": "measure", "section-text": "source-text" };
  const id = target.target.kind === "voice-event" ? target.target.eventId : target.target.kind === "chord-event" ? target.target.chordEventId : target.target.kind === "section-text" ? target.target.sourceTextId : target.target.sourceMeasureId;
  const mapped = remapSourceId(remap, kindByTarget[target.target.kind], id);
  if (!mapped || mapped.length !== 1) return undefined;
  const nextTarget: OmrCorrectionTarget = target.target.kind === "voice-event" ? { kind: "voice-event", eventId: mapped[0] } : target.target.kind === "chord-event" ? { kind: "chord-event", chordEventId: mapped[0] } : target.target.kind === "section-text" ? { kind: "section-text", sourceTextId: mapped[0] } : { kind: target.target.kind, sourceMeasureId: mapped[0] };
  return { sourceRevision: remap.toRevision, target: nextTarget };
}
export async function mapVendorEvidenceToSource(input: { readonly sourceRevision: SourceRevisionRef; readonly mappingVersion: string; readonly vendorBundle: VendorEvidenceBundle; readonly targetMappings: readonly EvidenceTargetMapping[] }): Promise<{ readonly index: SourceEvidenceIndex; readonly archive: OmrEvidenceArchive }> {
  const mappingIds = input.targetMappings.map((mapping) => mapping.vendorTargetId);
  if (new Set(mappingIds).size !== mappingIds.length || input.targetMappings.some((mapping) => !revisionEqual(mapping.target.sourceRevision, input.sourceRevision))) throw new RangeError("OMR_EVIDENCE_TARGET_UNMAPPED");
  const mappedIds = new Set(mappingIds);
  if (mappingIds.some((id) => !input.vendorBundle.evidence.some((evidence) => evidence.vendorTargetId === id))) throw new RangeError("OMR_EVIDENCE_TARGET_UNMAPPED");
  const evidence = input.vendorBundle.evidence.filter((item) => item.vendorTargetId !== undefined && mappedIds.has(item.vendorTargetId));
  const unmappedEvidence = input.vendorBundle.evidence.filter((item) => item.vendorTargetId === undefined || !mappedIds.has(item.vendorTargetId));
  const common = { sourceRevision: input.sourceRevision, providerBundleDigest: input.vendorBundle.providerBundleDigest, frames: input.vendorBundle.frames, transforms: input.vendorBundle.transforms };
  const orderedFrames = [...input.vendorBundle.frames].sort((a, b) => a.pageIndex - b.pageIndex || a.coordinateSpace.localeCompare(b.coordinateSpace) || a.imageDigest.localeCompare(b.imageDigest));
  const frameOrdinal = new Map(orderedFrames.map((frame, index) => [frame.id, index]));
  const orderedTransforms = [...input.vendorBundle.transforms].sort((a, b) => a.pageIndex - b.pageIndex || (frameOrdinal.get(a.sourceFrameId) ?? -1) - (frameOrdinal.get(b.sourceFrameId) ?? -1) || (frameOrdinal.get(a.targetFrameId) ?? -1) - (frameOrdinal.get(b.targetFrameId) ?? -1));
  const transformOrdinal = new Map(orderedTransforms.map((transform, index) => [transform.id, index]));
  const frameProjection = orderedFrames.map((frame) => ({ pageIndex: frame.pageIndex, coordinateSpace: frame.coordinateSpace, widthPixels: frame.widthPixels, heightPixels: frame.heightPixels, imageDigest: frame.imageDigest }));
  const transformProjection = orderedTransforms.map((transform) => ({ pageIndex: transform.pageIndex, sourceFrameOrdinal: frameOrdinal.get(transform.sourceFrameId), targetFrameOrdinal: frameOrdinal.get(transform.targetFrameId), matrix3x3Nano: transform.matrix3x3Nano, inverseMatrix3x3Nano: transform.inverseMatrix3x3Nano ?? null }));
  const evidenceProjection = (item: OmrEvidence): object => ({ vendorTargetId: item.vendorTargetId ?? null, granularity: item.granularity, vendorId: item.vendorId, box: { frameOrdinal: frameOrdinal.get(item.box.frameId), xMu: item.box.xMu, yMu: item.box.yMu, widthMu: item.box.widthMu, heightMu: item.box.heightMu }, transformOrdinal: item.transformId === undefined ? null : transformOrdinal.get(item.transformId), confidenceBp: item.confidenceBp ?? null });
  const bundleDigest = await semanticDigest({ projectionSchema: "hm-source-evidence-index-v1", sourceRevision: input.sourceRevision, providerBundleDigest: input.vendorBundle.providerBundleDigest, mappingVersion: input.mappingVersion, frames: frameProjection, transforms: transformProjection, evidence: evidence.map(evidenceProjection), targetMappings: input.targetMappings });
  const archiveDigest = await semanticDigest({ projectionSchema: "hm-omr-evidence-archive-v1", sourceRevision: input.sourceRevision, providerBundleDigest: input.vendorBundle.providerBundleDigest, frames: frameProjection, transforms: transformProjection, unmappedEvidence: unmappedEvidence.map(evidenceProjection) });
  return { index: { ...common, mappingVersion: input.mappingVersion, evidence, targetMappings: input.targetMappings, bundleDigest }, archive: { ...common, unmappedEvidence, archiveDigest } };
}
