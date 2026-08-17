import { canonicalJson } from "../digest/canonical";
import type { SongSourceDocument } from "../source/model";
import { revisionRefsEqual } from "../source/revision";
import {
  computeProviderBundleDigest, mapVendorEvidenceToSource,
  validateOmrEvidenceArchive, validateOmrReviewRecord, validateSourceEvidenceIndex,
  type EvidenceGranularity, type VendorEvidenceBundle,
} from "./foundation";
import { validateOmrCorrectionHistory, validateReviewEvidenceReferences } from "./review";

const GRANULARITY_RANK: Readonly<Record<EvidenceGranularity, number>> = {
  none: 0, page: 1, staff: 2, measure: 3, symbol: 4,
};

/**
 * Verifies the complete persisted Step 10 context. Non-OMR Sources retain the
 * legacy correction-history check when a review record is explicitly attached.
 */
export async function validatePersistedOmrContext(source: SongSourceDocument): Promise<readonly string[]> {
  const importInfo = source.importInfo;
  if (importInfo?.sourceKind !== "omr") {
    return importInfo?.omrReviewRecord
      ? validateOmrCorrectionHistory(source, importInfo.omrReviewRecord)
      : [];
  }

  const errors: string[] = [];
  const rawDigest = importInfo.rawDigest;
  const providerMetadata = importInfo.providerMetadata;
  const reviewRecord = importInfo.omrReviewRecord;
  const archive = importInfo.omrEvidenceArchive;
  const index = source.sourceEvidence;
  if (!rawDigest || !providerMetadata || !reviewRecord || !archive || !index) {
    return ["OMR_PERSISTED_CONTEXT_INVALID:missing-context"];
  }
  if (!validateSourceEvidenceIndex(index)
    || !validateOmrEvidenceArchive(archive)
    || validateOmrReviewRecord(reviewRecord).length > 0) {
    return ["OMR_PERSISTED_CONTEXT_INVALID:malformed-context"];
  }

  const vendorId = providerMetadata.vendorId;
  const metadataResultDigest = providerMetadata.vendorResultDigest;
  const evidenceGranularity = providerMetadata.evidenceGranularity as EvidenceGranularity | undefined;
  if (!vendorId || !metadataResultDigest || evidenceGranularity === undefined
    || GRANULARITY_RANK[evidenceGranularity] === undefined) {
    errors.push("OMR_PERSISTED_CONTEXT_INVALID:provider-metadata");
  } else {
    if (reviewRecord.vendorResultDigest !== rawDigest || metadataResultDigest !== rawDigest) {
      errors.push("OMR_PERSISTED_CONTEXT_INVALID:vendor-result-digest");
    }
    if (reviewRecord.vendorId !== vendorId) errors.push("OMR_PERSISTED_CONTEXT_INVALID:vendor-id");
  }

  const currentRevision = {
    documentId: source.documentId,
    revisionOrdinal: source.revisionOrdinal,
    revisionDigest: source.revisionDigest,
  };
  if (!revisionRefsEqual(index.sourceRevision, currentRevision)
    || !revisionRefsEqual(archive.sourceRevision, currentRevision)) {
    errors.push("OMR_PERSISTED_CONTEXT_INVALID:source-revision");
  }
  if (index.providerBundleDigest !== archive.providerBundleDigest) {
    errors.push("OMR_PERSISTED_CONTEXT_INVALID:provider-bundle-binding");
  }
  if (canonicalJson(index.frames) !== canonicalJson(archive.frames)
    || canonicalJson(index.transforms) !== canonicalJson(archive.transforms)) {
    errors.push("OMR_PERSISTED_CONTEXT_INVALID:shared-evidence-graph");
  }

  const indexedEvidenceIds = new Set(index.evidence.map((item) => item.id));
  if (archive.unmappedEvidence.some((item) => indexedEvidenceIds.has(item.id))) {
    errors.push("OMR_PERSISTED_CONTEXT_INVALID:duplicate-evidence-id");
  }
  errors.push(...validateReviewEvidenceReferences(reviewRecord, index, archive));
  errors.push(...await validateOmrCorrectionHistory(source, reviewRecord));

  if (evidenceGranularity !== undefined && GRANULARITY_RANK[evidenceGranularity] !== undefined) {
    const evidence = [...index.evidence, ...archive.unmappedEvidence];
    if (evidence.some((item) => item.vendorId !== vendorId)) {
      errors.push("OMR_PERSISTED_CONTEXT_INVALID:evidence-granularity-or-vendor");
    }
    try {
      const providerBundle: VendorEvidenceBundle = {
        granularity: evidenceGranularity,
        frames: index.frames,
        transforms: index.transforms,
        evidence,
        providerBundleDigest: index.providerBundleDigest,
      };
      if (await computeProviderBundleDigest(providerBundle) !== index.providerBundleDigest) {
        errors.push("OMR_PERSISTED_CONTEXT_INVALID:provider-bundle-digest");
      } else {
        const rebuilt = await mapVendorEvidenceToSource({
          sourceRevision: currentRevision,
          mappingVersion: index.mappingVersion,
          vendorBundle: providerBundle,
          targetMappings: index.targetMappings,
        });
        if (rebuilt.index.bundleDigest !== index.bundleDigest) {
          errors.push("OMR_PERSISTED_CONTEXT_INVALID:index-bundle-digest");
        }
        if (rebuilt.archive.archiveDigest !== archive.archiveDigest) {
          errors.push("OMR_PERSISTED_CONTEXT_INVALID:archive-digest");
        }
      }
    } catch {
      errors.push("OMR_PERSISTED_CONTEXT_INVALID:provider-bundle-digest");
    }
  }
  return errors;
}
