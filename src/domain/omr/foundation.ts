import type { BinaryDigest, SemanticDigest } from "../digest/canonical";
import type { Diagnostic, DiagnosticCode } from "../diagnostics";
import type { Fraction } from "../fraction";
import type { Alter, KeySignature, SpelledPitch } from "../pitch";
import type { TimeSignature } from "../meter";
import type { ResolvedChordParseResult } from "../chord/model";
import type { BasisPoints } from "../rates";
import { remapSourceId, type SourceEntityKind, type SourceIdRemap, type SourceRevisionRef } from "../source/revision";
import { canonicalJson, compareCanonicalValues, semanticDigest } from "../digest/canonical";
import { isChordParseResult } from "../chord/parser";
import { DIAGNOSTIC_CODES } from "../diagnostics";
import { isKeySignature } from "../pitch";
import { isTimeSignature } from "../meter";
import {
  hasExactKeys, hasUniqueStrings, isCanonicalFraction, isCanonicalId,
  isCanonicalSpelledPitch, isMusicalRange, isPlainRecord, isSemanticDigest,
} from "../validation";
import { isSourceRevisionRef } from "../source/revision";

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
export const EVIDENCE_COORDINATE_SCALE = 1_000_000 as const;
export const EVIDENCE_MATRIX_SCALE = 1_000_000_000 as const;
export interface ImageCoordinateFrame { readonly id: string; readonly pageIndex: number; readonly coordinateSpace: CoordinateSpace; readonly widthPixels: number; readonly heightPixels: number; readonly imageDigest: BinaryDigest }
export interface BoundingBox { readonly frameId: string; readonly xMu: CoordinateMicrounit; readonly yMu: CoordinateMicrounit; readonly widthMu: CoordinateMicrounit; readonly heightMu: CoordinateMicrounit }
export interface ImageTransform { readonly id: string; readonly pageIndex: number; readonly sourceFrameId: string; readonly targetFrameId: string; readonly matrix3x3Nano: readonly MatrixCoefficientNanounit[]; readonly inverseMatrix3x3Nano?: readonly MatrixCoefficientNanounit[] }
export interface OmrEvidence { readonly id: string; readonly vendorTargetId?: string; readonly granularity: EvidenceGranularity; readonly box: BoundingBox; readonly transformId?: string; readonly confidenceBp?: BasisPoints; readonly vendorId: string }
export interface EvidenceTargetMapping { readonly vendorTargetId: string; readonly target: RevisionScopedTarget }
export interface VendorEvidenceBundle { readonly granularity: EvidenceGranularity; readonly frames: readonly ImageCoordinateFrame[]; readonly transforms: readonly ImageTransform[]; readonly evidence: readonly OmrEvidence[]; readonly providerBundleDigest: SemanticDigest }
export interface SourceEvidenceIndex { readonly sourceRevision: SourceRevisionRef; readonly mappingVersion: string; readonly providerBundleDigest: SemanticDigest; readonly frames: readonly ImageCoordinateFrame[]; readonly transforms: readonly ImageTransform[]; readonly evidence: readonly OmrEvidence[]; readonly targetMappings: readonly EvidenceTargetMapping[]; readonly bundleDigest: SemanticDigest }
export interface OmrEvidenceArchive { readonly sourceRevision: SourceRevisionRef; readonly providerBundleDigest: SemanticDigest; readonly frames: readonly ImageCoordinateFrame[]; readonly transforms: readonly ImageTransform[]; readonly unmappedEvidence: readonly OmrEvidence[]; readonly archiveDigest: SemanticDigest }
export interface OmrReviewAlternative { readonly id: string; readonly labelKo: string; readonly patch: OmrCorrectionPatch; readonly confidenceBp?: BasisPoints }
export type OmrReviewResolution = { readonly status: "open" } | { readonly status: "accepted"; readonly selectedAlternativeId: string; readonly correctionRecordId: string } | { readonly status: "rejected"; readonly rejectedAlternativeIds: readonly string[] } | { readonly status: "manually-corrected"; readonly correctionRecordId: string };
export interface OmrReviewItem { readonly id: string; readonly target: RevisionScopedTarget; readonly reasonCode: DiagnosticCode; readonly alternatives: readonly OmrReviewAlternative[]; readonly evidenceIds: readonly string[]; readonly resolution: OmrReviewResolution }
export type OmrAutoRepairResolution = { readonly status: "pending" } | { readonly status: "accepted"; readonly correctionRecordId: string } | { readonly status: "rejected" };
export interface OmrAutoRepairProposal {
  readonly id: string;
  readonly target: RevisionScopedTarget;
  readonly originalProjection: string;
  readonly patch: OmrCorrectionPatch;
  readonly reason: "MEASURE_DURATION" | "TIE_PITCH" | "CHORD_GRAMMAR" | "ACCIDENTAL_CONTEXT" | "VOICE_TIMELINE";
  readonly confidence: "high" | "medium" | "low";
  readonly resolution: OmrAutoRepairResolution;
}
export interface OmrCorrectionRecord { readonly id: string; readonly reviewItemId?: string; readonly autoRepairProposalId?: string; readonly target: RevisionScopedTarget; readonly beforeProjection: string; readonly patch: OmrCorrectionPatch; readonly source: "auto-accepted" | "review-alternative" | "manual"; readonly appliedAt: string }
export interface OmrReviewRecord { readonly vendorResultDigest: BinaryDigest; readonly vendorId: string; readonly autoRepairs: readonly OmrAutoRepairProposal[]; readonly corrections: readonly OmrCorrectionRecord[]; readonly reviewItems: readonly OmrReviewItem[]; readonly diagnostics?: readonly Diagnostic[] }

function revisionEqual(left: SourceRevisionRef, right: SourceRevisionRef): boolean {
  return left.documentId === right.documentId && left.revisionOrdinal === right.revisionOrdinal && left.revisionDigest === right.revisionDigest;
}
export function isCorrectionPatchCompatible(target: OmrCorrectionTarget, patch: OmrCorrectionPatch): boolean {
  if (["pitch", "duration", "accidental", "tie", "replace-event"].includes(patch.kind)) return target.kind === "voice-event";
  if (patch.kind === "chord") return target.kind === "chord-event";
  if (patch.kind === "time-signature" || patch.kind === "key-signature") return target.kind === "measure-start";
  // Structural split/merge semantics are intentionally deferred. Never treat the legacy
  // implicit-flag toggle as a completed barline correction.
  if (patch.kind === "insert-barline" || patch.kind === "delete-barline") return false;
  return patch.kind === "replace-source-text" && target.kind === "section-text";
}
function isCorrectionTarget(value: unknown): value is OmrCorrectionTarget {
  if (!isPlainRecord(value) || !isCanonicalId(value.kind)) return false;
  if (value.kind === "voice-event") return hasExactKeys(value, ["kind", "eventId"]) && isCanonicalId(value.eventId);
  if (value.kind === "chord-event") return hasExactKeys(value, ["kind", "chordEventId"]) && isCanonicalId(value.chordEventId);
  if (value.kind === "section-text") return hasExactKeys(value, ["kind", "sourceTextId"]) && isCanonicalId(value.sourceTextId);
  return ["measure", "measure-start", "measure-end"].includes(String(value.kind))
    && hasExactKeys(value, ["kind", "sourceMeasureId"])
    && isCanonicalId(value.sourceMeasureId);
}

function isRevisionScopedTarget(value: unknown): value is RevisionScopedTarget {
  return isPlainRecord(value)
    && hasExactKeys(value, ["sourceRevision", "target"])
    && isSourceRevisionRef(value.sourceRevision)
    && isCorrectionTarget(value.target);
}

function isCorrectionPatch(value: unknown): value is OmrCorrectionPatch {
  if (!isPlainRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "pitch") return hasExactKeys(value, ["kind", "pitch"]) && isCanonicalSpelledPitch(value.pitch);
  if (value.kind === "duration") return hasExactKeys(value, ["kind", "duration"]) && isCanonicalFraction(value.duration) && value.duration.n > 0;
  if (value.kind === "accidental") return hasExactKeys(value, ["kind", "alter"]) && [-2, -1, 0, 1, 2].includes(value.alter as number);
  if (value.kind === "chord") return hasExactKeys(value, ["kind", "parseResult"])
    && isChordParseResult(value.parseResult)
    && (value.parseResult.status === "ok" || value.parseResult.status === "no-chord");
  if (value.kind === "time-signature") return hasExactKeys(value, ["kind", "value"]) && isTimeSignature(value.value);
  if (value.kind === "key-signature") return hasExactKeys(value, ["kind", "value"]) && isKeySignature(value.value);
  if (value.kind === "tie") return hasExactKeys(value, ["kind", "tieStart", "tieStop"]) && typeof value.tieStart === "boolean" && typeof value.tieStop === "boolean";
  if (value.kind === "replace-source-text") return hasExactKeys(value, ["kind", "text"]) && typeof value.text === "string";
  if (value.kind === "insert-barline" || value.kind === "delete-barline") return hasExactKeys(value, ["kind"]);
  if (value.kind !== "replace-event" || !hasExactKeys(value, ["kind", "event"]) || !isPlainRecord(value.event)) return false;
  if (value.event.kind === "rest") {
    return hasExactKeys(value.event, ["kind", "onset", "duration"])
      && isCanonicalFraction(value.event.onset)
      && isCanonicalFraction(value.event.duration)
      && value.event.duration.n > 0;
  }
  return value.event.kind === "note"
    && hasExactKeys(value.event, ["kind", "onset", "duration", "pitch", "tieStart", "tieStop"])
    && isCanonicalFraction(value.event.onset)
    && isCanonicalFraction(value.event.duration)
    && value.event.duration.n > 0
    && isCanonicalSpelledPitch(value.event.pitch)
    && typeof value.event.tieStart === "boolean"
    && typeof value.event.tieStop === "boolean";
}

function isStoredDiagnostic(value: unknown): value is Diagnostic {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["id", "code", "severity", "messageKo"], ["location", "details"])
    || !isCanonicalId(value.id)
    || !DIAGNOSTIC_CODES.includes(value.code as typeof DIAGNOSTIC_CODES[number])
    || !["info", "warning", "error", "blocking"].includes(String(value.severity))
    || typeof value.messageKo !== "string") return false;
  if (value.location !== undefined && (!isPlainRecord(value.location)
    || !hasExactKeys(value.location, [], ["range", "phraseId", "sectionOccurrenceId", "sourceEventIds", "trackPlanIds"])
    || (value.location.range !== undefined && !isMusicalRange(value.location.range))
    || (value.location.phraseId !== undefined && !isCanonicalId(value.location.phraseId))
    || (value.location.sectionOccurrenceId !== undefined && !isCanonicalId(value.location.sectionOccurrenceId))
    || (value.location.sourceEventIds !== undefined && (!Array.isArray(value.location.sourceEventIds)
      || !value.location.sourceEventIds.every(isCanonicalId) || !hasUniqueStrings(value.location.sourceEventIds)))
    || (value.location.trackPlanIds !== undefined && (!Array.isArray(value.location.trackPlanIds)
      || !value.location.trackPlanIds.every(isCanonicalId) || !hasUniqueStrings(value.location.trackPlanIds))))) return false;
  return value.details === undefined || (isPlainRecord(value.details)
    && Object.values(value.details).every((item) => typeof item === "string"
      || typeof item === "boolean"
      || (typeof item === "number" && Number.isFinite(item))));
}

function isReviewRecordShape(value: unknown): value is OmrReviewRecord {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["vendorResultDigest", "vendorId", "autoRepairs", "corrections", "reviewItems"], ["diagnostics"])
    || !isSemanticDigest(value.vendorResultDigest)
    || typeof value.vendorId !== "string" || value.vendorId.length === 0
    || !Array.isArray(value.autoRepairs) || !Array.isArray(value.corrections) || !Array.isArray(value.reviewItems)
    || (value.diagnostics !== undefined && (!Array.isArray(value.diagnostics)
      || !value.diagnostics.every(isStoredDiagnostic)))) return false;
  if (!value.autoRepairs.every((proposal) => isPlainRecord(proposal)
    && hasExactKeys(proposal, ["id", "target", "originalProjection", "patch", "reason", "confidence", "resolution"])
    && isCanonicalId(proposal.id)
    && isRevisionScopedTarget(proposal.target)
    && typeof proposal.originalProjection === "string"
    && (() => { try { return canonicalJson(JSON.parse(proposal.originalProjection as string)) === proposal.originalProjection; } catch { return false; } })()
    && isCorrectionPatch(proposal.patch)
    && isCorrectionPatchCompatible(proposal.target.target, proposal.patch)
    && ["MEASURE_DURATION", "TIE_PITCH", "CHORD_GRAMMAR", "ACCIDENTAL_CONTEXT", "VOICE_TIMELINE"].includes(String(proposal.reason))
    && ["high", "medium", "low"].includes(String(proposal.confidence))
    && isPlainRecord(proposal.resolution)
    && (proposal.resolution.status === "pending" || proposal.resolution.status === "rejected"
      ? hasExactKeys(proposal.resolution, ["status"])
      : proposal.resolution.status === "accepted"
        && hasExactKeys(proposal.resolution, ["status", "correctionRecordId"])
        && isCanonicalId(proposal.resolution.correctionRecordId)))) return false;
  if (!value.corrections.every((correction) => isPlainRecord(correction)
    && hasExactKeys(correction, ["id", "target", "beforeProjection", "patch", "source", "appliedAt"], ["reviewItemId", "autoRepairProposalId"])
    && isCanonicalId(correction.id)
    && (correction.reviewItemId === undefined || isCanonicalId(correction.reviewItemId))
    && (correction.autoRepairProposalId === undefined || isCanonicalId(correction.autoRepairProposalId))
    && !(correction.reviewItemId !== undefined && correction.autoRepairProposalId !== undefined)
    && isRevisionScopedTarget(correction.target)
    && typeof correction.beforeProjection === "string"
    && (() => { try { return canonicalJson(JSON.parse(correction.beforeProjection as string)) === correction.beforeProjection; } catch { return false; } })()
    && isCorrectionPatch(correction.patch)
    && isCorrectionPatchCompatible(correction.target.target, correction.patch)
    && ["auto-accepted", "review-alternative", "manual"].includes(String(correction.source))
    && typeof correction.appliedAt === "string"
    && Number.isFinite(Date.parse(correction.appliedAt as string)))) return false;
  return value.reviewItems.every((item) => isPlainRecord(item)
    && hasExactKeys(item, ["id", "target", "reasonCode", "alternatives", "evidenceIds", "resolution"])
    && isCanonicalId(item.id)
    && isRevisionScopedTarget(item.target)
    && DIAGNOSTIC_CODES.includes(item.reasonCode as typeof DIAGNOSTIC_CODES[number])
    && Array.isArray(item.alternatives)
    && item.alternatives.every((alternative) => isPlainRecord(alternative)
      && hasExactKeys(alternative, ["id", "labelKo", "patch"], ["confidenceBp"])
      && isCanonicalId(alternative.id)
      && typeof alternative.labelKo === "string"
      && isCorrectionPatch(alternative.patch)
      && (alternative.confidenceBp === undefined || (Number.isSafeInteger(alternative.confidenceBp)
        && (alternative.confidenceBp as number) >= 0 && (alternative.confidenceBp as number) <= 10_000))
      && isCorrectionPatchCompatible((item.target as RevisionScopedTarget).target, alternative.patch))
    && Array.isArray(item.evidenceIds)
    && item.evidenceIds.every(isCanonicalId)
    && hasUniqueStrings(item.evidenceIds)
    && isPlainRecord(item.resolution)
    && (item.resolution.status === "open"
      ? hasExactKeys(item.resolution, ["status"])
      : item.resolution.status === "accepted"
        ? hasExactKeys(item.resolution, ["status", "selectedAlternativeId", "correctionRecordId"])
          && isCanonicalId(item.resolution.selectedAlternativeId) && isCanonicalId(item.resolution.correctionRecordId)
        : item.resolution.status === "rejected"
          ? hasExactKeys(item.resolution, ["status", "rejectedAlternativeIds"])
            && Array.isArray(item.resolution.rejectedAlternativeIds)
            && item.resolution.rejectedAlternativeIds.every(isCanonicalId)
          : item.resolution.status === "manually-corrected"
            && hasExactKeys(item.resolution, ["status", "correctionRecordId"])
            && isCanonicalId(item.resolution.correctionRecordId)));
}

export function validateOmrReviewRecord(value: unknown): readonly string[] {
  const errors: string[] = [];
  if (!isReviewRecordShape(value)) return ["OMR_REVIEW_RESOLUTION_INVALID:malformed-record"];
  const record = value;
  if (!hasUniqueStrings(record.autoRepairs.map((item) => item.id)) || !hasUniqueStrings(record.corrections.map((item) => item.id)) || !hasUniqueStrings(record.reviewItems.map((item) => item.id))) {
    errors.push("OMR_REVIEW_RESOLUTION_INVALID:duplicate-id");
  }
  const corrections = new Map(record.corrections.map((correction) => [correction.id, correction]));
  const reviewItems = new Map(record.reviewItems.map((item) => [item.id, item]));
  const autoRepairs = new Map(record.autoRepairs.map((proposal) => [proposal.id, proposal]));
  for (const correction of record.corrections) {
    const reviewItem = correction.reviewItemId === undefined ? undefined : reviewItems.get(correction.reviewItemId);
    const autoRepair = correction.autoRepairProposalId === undefined ? undefined : autoRepairs.get(correction.autoRepairProposalId);
    if ((correction.reviewItemId !== undefined && !reviewItem)
      || (correction.autoRepairProposalId !== undefined && !autoRepair)
      || ((correction.source === "review-alternative" || correction.source === "manual") && !reviewItem)
      || (correction.source === "auto-accepted" && !autoRepair)
      || (reviewItem && canonicalJson(reviewItem.target) !== canonicalJson(correction.target))
      || (autoRepair && canonicalJson(autoRepair.target) !== canonicalJson(correction.target))) {
      errors.push(`OMR_REVIEW_RESOLUTION_INVALID:${correction.id}:review-reference`);
    }
  }
  const usedCorrectionIds = new Set<string>();
  for (const proposal of record.autoRepairs) {
    if (proposal.resolution.status !== "accepted") continue;
    const correction = corrections.get(proposal.resolution.correctionRecordId);
    if (!correction || correction.autoRepairProposalId !== proposal.id || correction.source !== "auto-accepted"
      || canonicalJson(correction.patch) !== canonicalJson(proposal.patch)) {
      errors.push(`OMR_REVIEW_RESOLUTION_INVALID:${proposal.id}`);
    }
    if (usedCorrectionIds.has(proposal.resolution.correctionRecordId)) errors.push(`OMR_REVIEW_RESOLUTION_INVALID:${proposal.id}:duplicate-correction-reference`);
    usedCorrectionIds.add(proposal.resolution.correctionRecordId);
  }
  for (const item of record.reviewItems) {
    if (new Set(item.alternatives.map((alternative) => alternative.id)).size !== item.alternatives.length) errors.push(`OMR_REVIEW_RESOLUTION_INVALID:${item.id}:duplicate-alternative`);
    if (item.resolution.status === "accepted") {
      const resolution = item.resolution;
      const alternative = item.alternatives.find((candidate) => candidate.id === resolution.selectedAlternativeId);
      const correction = corrections.get(resolution.correctionRecordId);
      if (!alternative || !correction || correction.reviewItemId !== item.id || correction.source !== "review-alternative" || canonicalJson(alternative.patch) !== canonicalJson(correction.patch)) errors.push(`OMR_REVIEW_RESOLUTION_INVALID:${item.id}`);
      if (usedCorrectionIds.has(resolution.correctionRecordId)) errors.push(`OMR_REVIEW_RESOLUTION_INVALID:${item.id}:duplicate-correction-reference`);
      usedCorrectionIds.add(resolution.correctionRecordId);
    } else if (item.resolution.status === "manually-corrected") {
      const correction = corrections.get(item.resolution.correctionRecordId);
      if (!correction || correction.reviewItemId !== item.id || correction.source !== "manual") errors.push(`OMR_REVIEW_RESOLUTION_INVALID:${item.id}`);
      if (usedCorrectionIds.has(item.resolution.correctionRecordId)) errors.push(`OMR_REVIEW_RESOLUTION_INVALID:${item.id}:duplicate-correction-reference`);
      usedCorrectionIds.add(item.resolution.correctionRecordId);
    } else if (item.resolution.status === "rejected") {
      const ids = new Set(item.alternatives.map((alternative) => alternative.id));
      if (new Set(item.resolution.rejectedAlternativeIds).size !== item.resolution.rejectedAlternativeIds.length || item.resolution.rejectedAlternativeIds.some((id) => !ids.has(id))) errors.push(`OMR_REVIEW_RESOLUTION_INVALID:${item.id}`);
    }
  }
  return errors;
}

export function validateOmrReviewCompletion(record: OmrReviewRecord): readonly string[] {
  const errors = [...validateOmrReviewRecord(record)];
  for (const item of record.reviewItems) {
    if (item.resolution.status === "open" || item.resolution.status === "rejected") {
      errors.push(`OMR_REVIEW_REQUIRED:${item.id}`);
    }
  }
  for (const proposal of record.autoRepairs) {
    if (proposal.resolution.status === "pending") errors.push(`OMR_REVIEW_REQUIRED:${proposal.id}`);
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

interface DecimalFraction { readonly numerator: bigint; readonly denominator: bigint }

function decimalFraction(value: string): DecimalFraction {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/u.exec(value.trim());
  if (!match) throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:decimal");
  const fractionDigits = match[3] ?? "";
  const exponent = Number(match[4] ?? "0");
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 30) throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:decimal");
  const digits = BigInt(`${match[2]}${fractionDigits}`);
  const decimalPlaces = fractionDigits.length - exponent;
  const numeratorMagnitude = decimalPlaces < 0 ? digits * (BigInt(10) ** BigInt(-decimalPlaces)) : digits;
  const denominator = decimalPlaces > 0 ? BigInt(10) ** BigInt(decimalPlaces) : BigInt(1);
  return { numerator: match[1] === "-" ? -numeratorMagnitude : numeratorMagnitude, denominator };
}

function roundHalfUpFraction(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= BigInt(0)) throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:division");
  const sign = numerator < BigInt(0) ? -BigInt(1) : BigInt(1);
  const absolute = numerator < BigInt(0) ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  return sign * (quotient + (remainder * BigInt(2) >= denominator ? BigInt(1) : BigInt(0)));
}

export function quantizeEvidenceDecimal(value: string, scale: number): number {
  if (!Number.isSafeInteger(scale) || scale <= 0) throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:scale");
  const fractionValue = decimalFraction(value);
  const quantized = roundHalfUpFraction(fractionValue.numerator * BigInt(scale), fractionValue.denominator);
  const numberValue = Number(quantized);
  if (!Number.isSafeInteger(numberValue)) throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:unsafe-integer");
  return numberValue;
}

export function quantizeHomography(input: readonly string[]): readonly MatrixCoefficientNanounit[] {
  if (input.length !== 9) throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:matrix-size");
  const values = input.map(decimalFraction);
  const denominatorCoefficient = values[8];
  const denominatorAbsolute = denominatorCoefficient.numerator < BigInt(0) ? -denominatorCoefficient.numerator : denominatorCoefficient.numerator;
  if (denominatorAbsolute === BigInt(0) || denominatorAbsolute * BigInt(1_000_000_000_000) < denominatorCoefficient.denominator) {
    throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:matrix-normalization");
  }
  return values.map((value, index) => {
    if (index === 8) return matrixCoefficientNanounit(EVIDENCE_MATRIX_SCALE);
    const numerator = value.numerator * denominatorCoefficient.denominator * BigInt(EVIDENCE_MATRIX_SCALE);
    const denominator = value.denominator * denominatorCoefficient.numerator;
    const normalizedNumerator = denominator < BigInt(0) ? -numerator : numerator;
    const normalizedDenominator = denominator < BigInt(0) ? -denominator : denominator;
    const quantized = roundHalfUpFraction(normalizedNumerator, normalizedDenominator);
    const numberValue = Number(quantized);
    if (!Number.isSafeInteger(numberValue)) throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:unsafe-matrix");
    return matrixCoefficientNanounit(numberValue);
  });
}

async function deterministicOmrId(prefix: string, projection: object): Promise<string> {
  const digest = await semanticDigest(projection);
  return `${prefix}:${digest.slice(0, 32)}`;
}

export function createOmrReviewItemId(target: RevisionScopedTarget, reasonCode: DiagnosticCode): Promise<string> {
  return deterministicOmrId("omr-review", { projectionSchema: "hm-omr-review-item-id-v1", target, reasonCode });
}

export function createOmrReviewAlternativeId(reviewItemId: string, patch: OmrCorrectionPatch, ordinal: number): Promise<string> {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) throw new RangeError("OMR_REVIEW_RESOLUTION_INVALID:alternative-ordinal");
  return deterministicOmrId("omr-alternative", { projectionSchema: "hm-omr-review-alternative-id-v1", reviewItemId, patch, ordinal });
}

export function createOmrAutoRepairProposalId(input: {
  readonly target: RevisionScopedTarget;
  readonly reason: OmrAutoRepairProposal["reason"];
  readonly patch: OmrCorrectionPatch;
  readonly patchOrdinal: number;
}): Promise<string> {
  if (!Number.isSafeInteger(input.patchOrdinal) || input.patchOrdinal < 0) throw new RangeError("OMR_REVIEW_RESOLUTION_INVALID:proposal-ordinal");
  return deterministicOmrId("omr-repair", { projectionSchema: "hm-omr-auto-repair-id-v1", ...input });
}

export function findEvidenceTransformPath(
  sourceFrameId: string,
  frames: readonly ImageCoordinateFrame[],
  transforms: readonly ImageTransform[],
): readonly string[] | undefined {
  const frameById = new Map(frames.map((frame) => [frame.id, frame]));
  const source = frameById.get(sourceFrameId);
  if (!source) return undefined;
  if (source.coordinateSpace !== "processed-pixels") return [];
  const ordered = [...transforms].sort((left, right) => left.id.localeCompare(right.id));
  const queue: Array<{ readonly frameId: string; readonly path: readonly string[] }> = [{ frameId: sourceFrameId, path: [] }];
  const shortest = new Map<string, number>([[sourceFrameId, 0]]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const transform of ordered) {
      if (transform.sourceFrameId !== current.frameId) continue;
      const target = frameById.get(transform.targetFrameId);
      if (!target || target.pageIndex !== source.pageIndex) continue;
      const path = [...current.path, transform.id];
      if (target.coordinateSpace !== "processed-pixels") return path;
      const known = shortest.get(target.id);
      if (known !== undefined && known <= path.length) continue;
      shortest.set(target.id, path.length);
      queue.push({ frameId: target.id, path });
    }
  }
  return undefined;
}

function applyEvidenceMatrixPoint(matrix: readonly MatrixCoefficientNanounit[], xMu: number, yMu: number): readonly [number, number] {
  if (matrix.length !== 9 || matrix.some((value) => !Number.isSafeInteger(value))) throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:matrix");
  const x = BigInt(xMu); const y = BigInt(yMu); const coordinateOne = BigInt(EVIDENCE_COORDINATE_SCALE);
  const value = (index: number) => BigInt(matrix[index]);
  const denominator = value(6) * x + value(7) * y + value(8) * coordinateOne;
  if (denominator === BigInt(0)) throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:matrix-projection");
  const project = (a: number, b: number, c: number) => {
    const numerator = (value(a) * x + value(b) * y + value(c) * coordinateOne) * coordinateOne;
    const normalizedNumerator = denominator < BigInt(0) ? -numerator : numerator;
    const normalizedDenominator = denominator < BigInt(0) ? -denominator : denominator;
    const result = Number(roundHalfUpFraction(normalizedNumerator, normalizedDenominator));
    if (!Number.isSafeInteger(result)) throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:matrix-projection");
    return result;
  };
  return [project(0, 1, 2), project(3, 4, 5)];
}

export function mapEvidenceBoxToNormalizedOriginal(
  evidence: OmrEvidence,
  frames: readonly ImageCoordinateFrame[],
  transforms: readonly ImageTransform[],
): BoundingBox | undefined {
  const frameById = new Map(frames.map((frame) => [frame.id, frame]));
  const transformById = new Map(transforms.map((transform) => [transform.id, transform]));
  let frame = frameById.get(evidence.box.frameId);
  if (!frame) return undefined;
  let corners: Array<readonly [number, number]> = [
    [evidence.box.xMu, evidence.box.yMu],
    [evidence.box.xMu + evidence.box.widthMu, evidence.box.yMu],
    [evidence.box.xMu, evidence.box.yMu + evidence.box.heightMu],
    [evidence.box.xMu + evidence.box.widthMu, evidence.box.yMu + evidence.box.heightMu],
  ];
  if (frame.coordinateSpace === "processed-pixels") {
    const first = evidence.transformId ? transformById.get(evidence.transformId) : undefined;
    if (!first || first.sourceFrameId !== frame.id) return undefined;
    const tail = findEvidenceTransformPath(first.targetFrameId, frames, transforms);
    if (tail === undefined) return undefined;
    for (const transformId of [first.id, ...tail]) {
      const transform = transformById.get(transformId);
      if (!transform || transform.sourceFrameId !== frame.id) return undefined;
      corners = corners.map(([x, y]) => applyEvidenceMatrixPoint(transform.matrix3x3Nano, x, y));
      const next = frameById.get(transform.targetFrameId); if (!next) return undefined; frame = next;
    }
  }
  if (frame.coordinateSpace === "processed-pixels") return undefined;
  const maxX = frame.coordinateSpace === "normalized-original" ? EVIDENCE_COORDINATE_SCALE : frame.widthPixels * EVIDENCE_COORDINATE_SCALE;
  const maxY = frame.coordinateSpace === "normalized-original" ? EVIDENCE_COORDINATE_SCALE : frame.heightPixels * EVIDENCE_COORDINATE_SCALE;
  const xs = corners.map(([x]) => x); const ys = corners.map(([, y]) => y);
  const left = Math.min(...xs); const top = Math.min(...ys); const right = Math.max(...xs); const bottom = Math.max(...ys);
  if (![left, top, right, bottom].every(Number.isSafeInteger) || left < 0 || top < 0 || right > maxX || bottom > maxY || right <= left || bottom <= top) return undefined;
  const normalized = (value: number, maximum: number) => coordinateMicrounit(Number(roundHalfUpFraction(BigInt(value) * BigInt(EVIDENCE_COORDINATE_SCALE), BigInt(maximum))));
  return { frameId: frame.id, xMu: normalized(left, maxX), yMu: normalized(top, maxY), widthMu: normalized(right - left, maxX), heightMu: normalized(bottom - top, maxY) };
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

interface CanonicalEvidenceGraph {
  readonly frames: readonly ImageCoordinateFrame[];
  readonly transforms: readonly ImageTransform[];
  readonly evidence: readonly OmrEvidence[];
  readonly frameProjection: readonly object[];
  readonly transformProjection: readonly object[];
  readonly evidenceProjection: readonly object[];
}

function canonicalEvidenceGraph(bundle: VendorEvidenceBundle): CanonicalEvidenceGraph {
  if (!isPlainRecord(bundle)
    || !hasExactKeys(bundle, ["granularity", "frames", "transforms", "evidence", "providerBundleDigest"])
    || !Array.isArray(bundle.frames)
    || !Array.isArray(bundle.transforms)
    || !Array.isArray(bundle.evidence)
    || !isSemanticDigest(bundle.providerBundleDigest)
    || !["none", "page", "staff", "measure", "symbol"].includes(String(bundle.granularity))) throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:granularity");
  if (!hasUniqueStrings(bundle.frames.map((item) => item.id))
    || !hasUniqueStrings(bundle.transforms.map((item) => item.id))
    || !hasUniqueStrings(bundle.evidence.map((item) => item.id))) throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:duplicate ID");
  const frameEntries = bundle.frames.map((frame) => {
    if (!isPlainRecord(frame)
      || !hasExactKeys(frame, ["id", "pageIndex", "coordinateSpace", "widthPixels", "heightPixels", "imageDigest"])) throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:frame");
    const typedFrame = frame as unknown as ImageCoordinateFrame;
    if (!isCanonicalId(typedFrame.id) || !Number.isSafeInteger(typedFrame.pageIndex) || typedFrame.pageIndex < 0
      || !["original-pixels", "normalized-original", "processed-pixels"].includes(typedFrame.coordinateSpace)
      || !Number.isSafeInteger(typedFrame.widthPixels) || typedFrame.widthPixels <= 0
      || !Number.isSafeInteger(typedFrame.heightPixels) || typedFrame.heightPixels <= 0
      || !isSemanticDigest(typedFrame.imageDigest)) throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:frame");
    return { value: typedFrame, projection: { pageIndex: typedFrame.pageIndex, coordinateSpace: typedFrame.coordinateSpace, widthPixels: typedFrame.widthPixels, heightPixels: typedFrame.heightPixels, imageDigest: typedFrame.imageDigest } };
  }).sort((left, right) => compareCanonicalValues(left.projection, right.projection));
  for (let index = 1; index < frameEntries.length; index += 1) if (compareCanonicalValues(frameEntries[index - 1].projection, frameEntries[index].projection) === 0) throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:duplicate frame");
  const frameOrdinal = new Map(frameEntries.map((entry, index) => [entry.value.id, index]));
  const frameById = new Map(frameEntries.map((entry) => [entry.value.id, entry.value]));
  const transformEntries = bundle.transforms.map((transform) => {
    if (!isPlainRecord(transform)
      || !hasExactKeys(transform, ["id", "pageIndex", "sourceFrameId", "targetFrameId", "matrix3x3Nano"], ["inverseMatrix3x3Nano"])
      || !Array.isArray(transform.matrix3x3Nano)
      || (transform.inverseMatrix3x3Nano !== undefined && !Array.isArray(transform.inverseMatrix3x3Nano))) {
      throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:transform");
    }
    const typedTransform = transform as unknown as ImageTransform;
    const sourceFrame = frameById.get(typedTransform.sourceFrameId);
    const targetFrame = frameById.get(typedTransform.targetFrameId);
    if (!isCanonicalId(typedTransform.id) || !Number.isSafeInteger(typedTransform.pageIndex) || typedTransform.pageIndex < 0
      || !sourceFrame || !targetFrame
      || sourceFrame.id === targetFrame.id
      || sourceFrame.pageIndex !== typedTransform.pageIndex
      || targetFrame.pageIndex !== typedTransform.pageIndex
      || typedTransform.matrix3x3Nano.length !== 9 || typedTransform.matrix3x3Nano.some((item) => !Number.isSafeInteger(item))
      || (typedTransform.inverseMatrix3x3Nano !== undefined && (typedTransform.inverseMatrix3x3Nano.length !== 9 || typedTransform.inverseMatrix3x3Nano.some((item) => !Number.isSafeInteger(item))))) throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:transform");
    return { value: typedTransform, projection: { pageIndex: typedTransform.pageIndex, sourceFrameOrdinal: frameOrdinal.get(typedTransform.sourceFrameId), targetFrameOrdinal: frameOrdinal.get(typedTransform.targetFrameId), matrix3x3Nano: typedTransform.matrix3x3Nano, inverseMatrix3x3Nano: typedTransform.inverseMatrix3x3Nano ?? null } };
  }).sort((left, right) => compareCanonicalValues(left.projection, right.projection));
  for (let index = 1; index < transformEntries.length; index += 1) if (compareCanonicalValues(transformEntries[index - 1].projection, transformEntries[index].projection) === 0) throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:duplicate transform");
  const transformOrdinal = new Map(transformEntries.map((entry, index) => [entry.value.id, index]));
  const transformById = new Map(transformEntries.map((entry) => [entry.value.id, entry.value]));
  const hasOriginalPath = (frameId: string, visited: ReadonlySet<string>): boolean => {
    const frame = frameById.get(frameId);
    if (!frame) return false;
    if (frame.coordinateSpace !== "processed-pixels") return true;
    if (visited.has(frameId)) return false;
    const nextVisited = new Set(visited).add(frameId);
    return transformEntries.some((entry) => entry.value.sourceFrameId === frameId
      && hasOriginalPath(entry.value.targetFrameId, nextVisited));
  };
  const evidenceEntries = bundle.evidence.map((item) => {
    if (!isPlainRecord(item)
      || !hasExactKeys(item, ["id", "granularity", "box", "vendorId"], ["vendorTargetId", "transformId", "confidenceBp"])
      || !isPlainRecord(item.box)
      || !hasExactKeys(item.box, ["frameId", "xMu", "yMu", "widthMu", "heightMu"])) {
      throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:evidence");
    }
    const typedItem = item as unknown as OmrEvidence;
    const frame = frameById.get(typedItem.box.frameId);
    const transform = typedItem.transformId === undefined ? undefined : transformById.get(typedItem.transformId);
    const maxX = frame?.coordinateSpace === "normalized-original" ? 1_000_000 : (frame?.widthPixels ?? 0) * 1_000_000;
    const maxY = frame?.coordinateSpace === "normalized-original" ? 1_000_000 : (frame?.heightPixels ?? 0) * 1_000_000;
    if (!isCanonicalId(typedItem.id) || !frame
      || ![typedItem.box.xMu, typedItem.box.yMu, typedItem.box.widthMu, typedItem.box.heightMu].every((value) => Number.isSafeInteger(value) && value >= 0)
      || typedItem.box.widthMu <= 0 || typedItem.box.heightMu <= 0
      || typedItem.box.xMu + typedItem.box.widthMu > maxX || typedItem.box.yMu + typedItem.box.heightMu > maxY
      || (typedItem.transformId !== undefined && (!transform || transform.sourceFrameId !== typedItem.box.frameId))
      || (frame.coordinateSpace === "processed-pixels"
        && (!transform || !hasOriginalPath(transform.targetFrameId, new Set([frame.id]))))
      || (typedItem.confidenceBp !== undefined && (!Number.isSafeInteger(typedItem.confidenceBp) || typedItem.confidenceBp < 0 || typedItem.confidenceBp > 10_000))
      || !["none", "page", "staff", "measure", "symbol"].includes(typedItem.granularity)
      || typeof typedItem.vendorId !== "string" || typedItem.vendorId.length === 0) throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:evidence");
    return { value: typedItem, projection: { vendorTargetId: typedItem.vendorTargetId ?? null, granularity: typedItem.granularity, vendorId: typedItem.vendorId, box: { frameOrdinal: frameOrdinal.get(typedItem.box.frameId), xMu: typedItem.box.xMu, yMu: typedItem.box.yMu, widthMu: typedItem.box.widthMu, heightMu: typedItem.box.heightMu }, transformOrdinal: typedItem.transformId === undefined ? null : transformOrdinal.get(typedItem.transformId), confidenceBp: typedItem.confidenceBp ?? null } };
  }).sort((left, right) => compareCanonicalValues(left.projection, right.projection));
  for (let index = 1; index < evidenceEntries.length; index += 1) if (compareCanonicalValues(evidenceEntries[index - 1].projection, evidenceEntries[index].projection) === 0) throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:duplicate evidence");
  return { frames: frameEntries.map((entry) => entry.value), transforms: transformEntries.map((entry) => entry.value), evidence: evidenceEntries.map((entry) => entry.value), frameProjection: frameEntries.map((entry) => entry.projection), transformProjection: transformEntries.map((entry) => entry.projection), evidenceProjection: evidenceEntries.map((entry) => entry.projection) };
}

export async function computeProviderBundleDigest(bundle: Omit<VendorEvidenceBundle, "providerBundleDigest">): Promise<SemanticDigest> {
  const graph = canonicalEvidenceGraph({ ...bundle, providerBundleDigest: "0".repeat(64) as SemanticDigest });
  return semanticDigest({ projectionSchema: "hm-vendor-evidence-bundle-v1", granularity: bundle.granularity, frames: graph.frameProjection, transforms: graph.transformProjection, evidence: graph.evidenceProjection });
}

export async function mapVendorEvidenceToSource(input: { readonly sourceRevision: SourceRevisionRef; readonly mappingVersion: string; readonly vendorBundle: VendorEvidenceBundle; readonly targetMappings: readonly EvidenceTargetMapping[] }): Promise<{ readonly index: SourceEvidenceIndex; readonly archive: OmrEvidenceArchive }> {
  if (!isSourceRevisionRef(input.sourceRevision) || typeof input.mappingVersion !== "string" || input.mappingVersion.length === 0) throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:input");
  if (!Array.isArray(input.targetMappings) || input.targetMappings.some((mapping) => !isPlainRecord(mapping)
    || !hasExactKeys(mapping, ["vendorTargetId", "target"])
    || typeof mapping.vendorTargetId !== "string" || mapping.vendorTargetId.length === 0
    || !isRevisionScopedTarget(mapping.target))) throw new RangeError("OMR_EVIDENCE_TARGET_UNMAPPED");
  const graph = canonicalEvidenceGraph(input.vendorBundle);
  const recomputedProviderDigest = await computeProviderBundleDigest(input.vendorBundle);
  if (recomputedProviderDigest !== input.vendorBundle.providerBundleDigest) throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:providerBundleDigest");
  const mappingIds = input.targetMappings.map((mapping) => mapping.vendorTargetId);
  if (new Set(mappingIds).size !== mappingIds.length || input.targetMappings.some((mapping) => !revisionEqual(mapping.target.sourceRevision, input.sourceRevision))) throw new RangeError("OMR_EVIDENCE_TARGET_UNMAPPED");
  const mappedIds = new Set(mappingIds);
  if (mappingIds.some((id) => !graph.evidence.some((evidence) => evidence.vendorTargetId === id))) throw new RangeError("OMR_EVIDENCE_TARGET_UNMAPPED");
  const evidence = graph.evidence.filter((item) => item.vendorTargetId !== undefined && mappedIds.has(item.vendorTargetId));
  const unmappedEvidence = graph.evidence.filter((item) => item.vendorTargetId === undefined || !mappedIds.has(item.vendorTargetId));
  const targetMappings = [...input.targetMappings].sort((left, right) => compareCanonicalValues({ vendorTargetId: left.vendorTargetId, target: left.target }, { vendorTargetId: right.vendorTargetId, target: right.target }));
  const projectionByEvidenceId = new Map(graph.evidence.map((item, index) => [item.id, graph.evidenceProjection[index]]));
  const common = { sourceRevision: input.sourceRevision, providerBundleDigest: input.vendorBundle.providerBundleDigest, frames: graph.frames, transforms: graph.transforms };
  const bundleDigest = await semanticDigest({ projectionSchema: "hm-source-evidence-index-v1", sourceRevision: input.sourceRevision, providerBundleDigest: input.vendorBundle.providerBundleDigest, mappingVersion: input.mappingVersion, frames: graph.frameProjection, transforms: graph.transformProjection, evidence: evidence.map((item) => projectionByEvidenceId.get(item.id)), targetMappings });
  const archiveDigest = await semanticDigest({ projectionSchema: "hm-omr-evidence-archive-v1", sourceRevision: input.sourceRevision, providerBundleDigest: input.vendorBundle.providerBundleDigest, frames: graph.frameProjection, transforms: graph.transformProjection, unmappedEvidence: unmappedEvidence.map((item) => projectionByEvidenceId.get(item.id)) });
  return { index: { ...common, mappingVersion: input.mappingVersion, evidence, targetMappings, bundleDigest }, archive: { ...common, unmappedEvidence, archiveDigest } };
}

function hasCanonicalEvidenceOrder(input: {
  readonly frames: readonly ImageCoordinateFrame[];
  readonly transforms: readonly ImageTransform[];
  readonly evidence: readonly OmrEvidence[];
  readonly providerBundleDigest: SemanticDigest;
}): boolean {
  try {
    const graph = canonicalEvidenceGraph({ ...input, granularity: "none" });
    return canonicalJson(input.frames.map((item) => item.id)) === canonicalJson(graph.frames.map((item) => item.id))
      && canonicalJson(input.transforms.map((item) => item.id)) === canonicalJson(graph.transforms.map((item) => item.id))
      && canonicalJson(input.evidence.map((item) => item.id)) === canonicalJson(graph.evidence.map((item) => item.id));
  } catch {
    return false;
  }
}

export function validateSourceEvidenceIndex(value: unknown): value is SourceEvidenceIndex {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["sourceRevision", "mappingVersion", "providerBundleDigest", "frames", "transforms", "evidence", "targetMappings", "bundleDigest"])
    || !isSourceRevisionRef(value.sourceRevision)
    || typeof value.mappingVersion !== "string" || value.mappingVersion.length === 0
    || !isSemanticDigest(value.providerBundleDigest)
    || !isSemanticDigest(value.bundleDigest)
    || !Array.isArray(value.frames) || !Array.isArray(value.transforms) || !Array.isArray(value.evidence)
    || !Array.isArray(value.targetMappings)
    || !value.targetMappings.every((mapping) => isPlainRecord(mapping)
      && hasExactKeys(mapping, ["vendorTargetId", "target"])
      && typeof mapping.vendorTargetId === "string" && mapping.vendorTargetId.length > 0
      && isRevisionScopedTarget(mapping.target)
      && revisionEqual(mapping.target.sourceRevision, value.sourceRevision as SourceRevisionRef))) return false;
  const typed = value as unknown as SourceEvidenceIndex;
  if (!hasCanonicalEvidenceOrder({ frames: typed.frames, transforms: typed.transforms, evidence: typed.evidence, providerBundleDigest: typed.providerBundleDigest })) return false;
  const mappingIds = typed.targetMappings.map((mapping) => mapping.vendorTargetId);
  if (!hasUniqueStrings(mappingIds)
    || typed.evidence.some((item) => item.vendorTargetId === undefined || !mappingIds.includes(item.vendorTargetId))
    || mappingIds.some((id) => !typed.evidence.some((item) => item.vendorTargetId === id))) return false;
  const orderedMappings = [...typed.targetMappings].sort((left, right) => compareCanonicalValues(
    { vendorTargetId: left.vendorTargetId, target: left.target },
    { vendorTargetId: right.vendorTargetId, target: right.target },
  ));
  return canonicalJson(typed.targetMappings) === canonicalJson(orderedMappings);
}

export function validateOmrEvidenceArchive(value: unknown): value is OmrEvidenceArchive {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["sourceRevision", "providerBundleDigest", "frames", "transforms", "unmappedEvidence", "archiveDigest"])
    || !isSourceRevisionRef(value.sourceRevision)
    || !isSemanticDigest(value.providerBundleDigest)
    || !isSemanticDigest(value.archiveDigest)
    || !Array.isArray(value.frames) || !Array.isArray(value.transforms) || !Array.isArray(value.unmappedEvidence)) return false;
  const typed = value as unknown as OmrEvidenceArchive;
  return hasCanonicalEvidenceOrder({ frames: typed.frames, transforms: typed.transforms, evidence: typed.unmappedEvidence, providerBundleDigest: typed.providerBundleDigest });
}
