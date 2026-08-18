import { APPLICATION_ALGORITHM_VERSION_REGISTRY } from "../../app/algorithm-version-registry";
import { binaryDigest, canonicalJson } from "../digest/canonical";
import { digestMusicalSource } from "../digest/source";
import {
  mapVendorEvidenceToSource,
  type EvidenceTargetMapping, type OmrEvidenceArchive, type OmrReviewItem, type OmrReviewRecord,
  type RevisionScopedTarget, type SourceEvidenceIndex,
} from "./foundation";
import { validateVendorNormalizationMappingArtifact, type OmrProviderResult, type VendorExportEvidenceMapping } from "./contracts";
import type { RightsMetadata, SongSourceDocument } from "../source/model";
import { normalizeSongSourceDocument } from "../source/normalize";
import { validateSongSourceDocumentIntegrity } from "../source/validation";
import { importMusicXml } from "../../import/musicxml/parser";
import { step3ImportVersionsFromRegistry, type MusicXmlImportDraft } from "../../import/musicxml/types";
import { finalizeImportedSource } from "../../import/review/finalize";
import { createOmrReviewItem, proposeOmrAutoRepairs, unsupportedOmrAutoRepairDiagnostics, validateOmrCorrectionHistory, validateReviewEvidenceReferences, validateReviewEvidenceTargetBindings } from "./review";
import { validateOmrReviewCompletion } from "./foundation";
import { resolveMusicXmlSourceTarget } from "./import-identity";
import { acknowledgeRuntimeOmrWarnings } from "./readiness";

export const OMR_NORMALIZER_VERSION = "omr-normalizer-v1" as const;
const versions = step3ImportVersionsFromRegistry(APPLICATION_ALGORITHM_VERSION_REGISTRY);

export type VendorMusicXmlPreparation =
  | { readonly status: "review-required"; readonly draft: MusicXmlImportDraft; readonly vendorResultDigest: Awaited<ReturnType<typeof binaryDigest>> }
  | { readonly status: "blocked"; readonly diagnostics: Awaited<ReturnType<typeof importMusicXml>>["diagnostics"]; readonly vendorResultDigest: Awaited<ReturnType<typeof binaryDigest>> };

export async function prepareVendorMusicXml(result: OmrProviderResult, options: {
  readonly originalFileName?: string;
  readonly documentId?: string;
} = {}): Promise<VendorMusicXmlPreparation> {
  const bytes = new TextEncoder().encode(result.rawMusicXml);
  const vendorResultDigest = await binaryDigest(bytes);
  if (vendorResultDigest !== result.vendorResultDigest) throw new RangeError("OMR_RESULT_INTEGRITY_FAILED");
  await validateVendorNormalizationMappingArtifact(result.normalizationMapping);
  if (result.normalizationMapping.vendorResultDigest !== result.vendorResultDigest
    || result.normalizationMapping.providerBundleDigest !== result.evidence.providerBundleDigest) throw new RangeError("OMR_RESULT_INTEGRITY_FAILED");
  const imported = await importMusicXml(bytes, {
    algorithmVersions: versions,
    ...(options.originalFileName ? { originalFileName: options.originalFileName } : {}),
    identityFactory: () => options.documentId ?? `doc:omr:${vendorResultDigest.slice(0, 32)}`,
  });
  return imported.status === "blocked"
    ? { status: "blocked", diagnostics: imported.diagnostics, vendorResultDigest }
    : { status: "review-required", draft: imported.draft, vendorResultDigest };
}

function revision(source: SongSourceDocument): RevisionScopedTarget["sourceRevision"] {
  return { documentId: source.documentId, revisionOrdinal: source.revisionOrdinal, revisionDigest: source.revisionDigest };
}

export interface OmrSelectedMusicXmlIdentity {
  readonly partOrdinal: number;
  readonly staffNumber: number;
  readonly voiceKey: string;
  readonly chordAuthorityPartOrdinal: number;
}

function normalizedTarget(source: SongSourceDocument, mapping: VendorExportEvidenceMapping, selection: OmrSelectedMusicXmlIdentity): RevisionScopedTarget | undefined {
  const sourceRevision = revision(source);
  const selector = mapping.target;
  if (selector.kind === "voice-event") {
    if (selector.musicXmlPartOrdinal !== selection.partOrdinal || selector.musicXmlStaffNumber !== selection.staffNumber || selector.musicXmlVoiceKey !== selection.voiceKey) return undefined;
  } else if (selector.kind === "chord-event") {
    if (selector.musicXmlPartOrdinal !== selection.chordAuthorityPartOrdinal) return undefined;
  } else if (selector.musicXmlPartOrdinal !== selection.partOrdinal) return undefined;
  const importMap = source.importInfo?.musicXmlSourceTargetMap;
  if (!importMap) throw new RangeError("OMR_IMPORT_IDENTITY_INVALID");
  const target = resolveMusicXmlSourceTarget(importMap, selector);
  return target ? { sourceRevision, target } : undefined;
}

function alternativeForTarget(source: SongSourceDocument, target: RevisionScopedTarget): { readonly labelKo: string; readonly patch: import("./foundation").OmrCorrectionPatch } | undefined {
  const correctionTarget = target.target;
  for (const measure of source.sourceMeasures) {
    if (correctionTarget.kind === "voice-event") {
      const event = measure.leadEvents.find((candidate) => candidate.id === correctionTarget.eventId);
      if (event?.kind === "note") return { labelKo: `${event.pitch.step}${event.pitch.alter === 1 ? "♯" : event.pitch.alter === -1 ? "♭" : ""}${event.pitch.octave} 인식값`, patch: { kind: "pitch", pitch: event.pitch } };
      if (event?.kind === "rest") return { labelKo: "쉼표 인식값", patch: { kind: "replace-event", event: { kind: "rest", onset: event.onset, duration: event.duration } } };
    }
    if (correctionTarget.kind === "chord-event") {
      const chord = measure.chordEvents.find((candidate) => candidate.id === correctionTarget.chordEventId);
      if (chord && (chord.parseResult.status === "ok" || chord.parseResult.status === "no-chord")) return { labelKo: `${chord.sourceText} 인식값`, patch: { kind: "chord", parseResult: chord.parseResult } };
    }
    if (correctionTarget.kind === "section-text") {
      const text = measure.textEvents.find((candidate) => candidate.id === correctionTarget.sourceTextId);
      if (text) return { labelKo: `${text.text} 인식값`, patch: { kind: "replace-source-text", text: text.text } };
    }
    if (correctionTarget.kind === "measure-start" && measure.id === correctionTarget.sourceMeasureId) {
      return { labelKo: `${measure.time.numerator}/${measure.time.denominator} 인식값`, patch: { kind: "time-signature", value: measure.time } };
    }
  }
  return undefined;
}

export async function createInitialOmrReviewContext(source: SongSourceDocument, providerResult: OmrProviderResult, selection: OmrSelectedMusicXmlIdentity): Promise<{
  readonly sourceEvidence: SourceEvidenceIndex;
  readonly evidenceArchive: OmrEvidenceArchive;
  readonly reviewRecord: OmrReviewRecord;
}> {
  if (await binaryDigest(new TextEncoder().encode(providerResult.rawMusicXml)) !== providerResult.vendorResultDigest) throw new RangeError("OMR_RESULT_INTEGRITY_FAILED");
  await validateVendorNormalizationMappingArtifact(providerResult.normalizationMapping);
  if (providerResult.normalizationMapping.vendorResultDigest !== providerResult.vendorResultDigest
    || providerResult.normalizationMapping.providerBundleDigest !== providerResult.evidence.providerBundleDigest) throw new RangeError("OMR_RESULT_INTEGRITY_FAILED");
  const mappingByVendorTarget = new Map<string, EvidenceTargetMapping>();
  const evidenceVendorIds = new Set(providerResult.evidence.evidence.flatMap((evidence) => evidence.vendorTargetId ? [evidence.vendorTargetId] : []));
  for (const mapping of providerResult.normalizationMapping.mappings) {
    if (!evidenceVendorIds.has(mapping.vendorTargetId)) continue;
    const target = normalizedTarget(source, mapping, selection);
    if (target) mappingByVendorTarget.set(mapping.vendorTargetId, { vendorTargetId: mapping.vendorTargetId, target });
  }
  const mapped = await mapVendorEvidenceToSource({ sourceRevision: revision(source), mappingVersion: "omr-evidence-map-v1", vendorBundle: providerResult.evidence, targetMappings: [...mappingByVendorTarget.values()] });
  const reviewItems: OmrReviewItem[] = [];
  const itemGroups = new Map<string, { readonly target: RevisionScopedTarget; readonly evidenceIds: string[] }>();
  for (const mapping of mappingByVendorTarget.values()) {
    const key = canonicalJson(mapping.target);
    const evidenceIds = providerResult.evidence.evidence.filter((evidence) => evidence.vendorTargetId === mapping.vendorTargetId).map((evidence) => evidence.id);
    const group = itemGroups.get(key);
    if (group) group.evidenceIds.push(...evidenceIds);
    else itemGroups.set(key, { target: mapping.target, evidenceIds });
  }
  for (const group of itemGroups.values()) {
    const alternative = alternativeForTarget(source, group.target);
    if (!alternative) continue;
    reviewItems.push(await createOmrReviewItem({ target: group.target, reasonCode: "OMR_REVIEW_REQUIRED", alternatives: [alternative], evidenceIds: [...new Set(group.evidenceIds)] }));
  }
  const reviewRecord: OmrReviewRecord = {
    vendorResultDigest: providerResult.vendorResultDigest, vendorId: providerResult.vendorId,
    autoRepairs: await proposeOmrAutoRepairs(source), corrections: [],
    reviewItems: reviewItems.sort((left, right) => left.id.localeCompare(right.id)),
    diagnostics: await unsupportedOmrAutoRepairDiagnostics(source),
  };
  if (validateReviewEvidenceReferences(reviewRecord, mapped.index, mapped.archive).length > 0) throw new RangeError("OMR_REVIEW_RESOLUTION_INVALID");
  return { sourceEvidence: mapped.index, evidenceArchive: mapped.archive, reviewRecord };
}

export async function attachOmrReviewContext(input: {
  readonly source: SongSourceDocument;
  readonly providerResult: OmrProviderResult;
  readonly reviewRecord: OmrReviewRecord;
  readonly selection: OmrSelectedMusicXmlIdentity;
  readonly acknowledgeRuntimeWarningsAt?: string;
}): Promise<SongSourceDocument> {
  if (input.reviewRecord.vendorId !== input.providerResult.vendorId || input.reviewRecord.vendorResultDigest !== input.providerResult.vendorResultDigest) throw new RangeError("OMR_RESULT_INTEGRITY_FAILED");
  if (validateOmrReviewCompletion(input.reviewRecord).length > 0) throw new RangeError("OMR_REVIEW_REQUIRED");
  if ((await validateOmrCorrectionHistory(input.source, input.reviewRecord)).length > 0) throw new RangeError("OMR_REVIEW_RESOLUTION_INVALID");
  const context = await createInitialOmrReviewContext(input.source, input.providerResult, input.selection);
  if (validateReviewEvidenceReferences(input.reviewRecord, context.sourceEvidence, context.evidenceArchive).length > 0) throw new RangeError("OMR_REVIEW_RESOLUTION_INVALID");
  if (validateReviewEvidenceTargetBindings(input.source, input.reviewRecord, context.sourceEvidence, context.evidenceArchive).length > 0) throw new RangeError("OMR_EVIDENCE_TARGET_UNMAPPED");
  let source = normalizeSongSourceDocument({
    ...input.source,
    importInfo: {
      ...input.source.importInfo, sourceKind: "omr", rawDigest: input.providerResult.vendorResultDigest,
      importerVersion: OMR_NORMALIZER_VERSION,
      providerMetadata: { vendorId: input.providerResult.vendorId, vendorResultDigest: input.providerResult.vendorResultDigest, evidenceGranularity: input.providerResult.evidence.granularity },
      omrReviewRecord: input.reviewRecord, omrEvidenceArchive: context.evidenceArchive,
    },
    sourceEvidence: context.sourceEvidence,
  });
  if (input.acknowledgeRuntimeWarningsAt) {
    source = await acknowledgeRuntimeOmrWarnings(source, { acknowledgedAt: input.acknowledgeRuntimeWarningsAt });
  }
  if (await digestMusicalSource(source) !== source.revisionDigest) throw new RangeError("SOURCE_REVISION_INVALID");
  if (!await validateSongSourceDocumentIntegrity(source, versions.performanceExpanderVersion)) throw new RangeError("SOURCE_REVISION_INVALID");
  return source;
}

export async function finalizeReviewedOmrSource(input: {
  readonly reviewedDraft: MusicXmlImportDraft;
  readonly providerResult: OmrProviderResult;
  readonly rights: RightsMetadata;
  readonly reviewRecord: OmrReviewRecord;
  readonly sourceEvidence: SourceEvidenceIndex;
  readonly evidenceArchive: OmrEvidenceArchive;
}): Promise<{ readonly status: "complete"; readonly source: SongSourceDocument } | { readonly status: "blocked"; readonly diagnostics: readonly import("../diagnostics").Diagnostic[] }> {
  if (input.reviewRecord.vendorId !== input.providerResult.vendorId
    || input.reviewRecord.vendorResultDigest !== input.providerResult.vendorResultDigest
    || input.sourceEvidence.providerBundleDigest !== input.providerResult.evidence.providerBundleDigest
    || input.evidenceArchive.providerBundleDigest !== input.providerResult.evidence.providerBundleDigest) throw new RangeError("OMR_RESULT_INTEGRITY_FAILED");
  if (validateOmrReviewCompletion(input.reviewRecord).length > 0) throw new RangeError("OMR_REVIEW_REQUIRED");
  const finalized = await finalizeImportedSource({ ...input.reviewedDraft, rights: input.rights }, versions);
  if (finalized.status === "blocked") return finalized;
  let source = normalizeSongSourceDocument({
    ...finalized.source,
    sourceMeasures: finalized.source.sourceMeasures.map((measure) => ({
      ...measure,
      chordEvents: measure.chordEvents.map((chord) => ({ ...chord, source: chord.source === "manual" ? "manual" : "omr" })),
    })),
    importInfo: {
      ...finalized.source.importInfo,
      sourceKind: "omr",
      rawDigest: input.providerResult.vendorResultDigest,
      importerVersion: OMR_NORMALIZER_VERSION,
      providerMetadata: {
        vendorId: input.providerResult.vendorId,
        vendorResultDigest: input.providerResult.vendorResultDigest,
        evidenceGranularity: input.providerResult.evidence.granularity,
      },
      omrReviewRecord: input.reviewRecord,
      omrEvidenceArchive: input.evidenceArchive,
    },
    sourceEvidence: input.sourceEvidence,
  });
  source = { ...source, revisionDigest: await digestMusicalSource(source) };
  if (!await validateSongSourceDocumentIntegrity(source, versions.performanceExpanderVersion)) throw new RangeError("SOURCE_REVISION_INVALID");
  return { status: "complete", source };
}
