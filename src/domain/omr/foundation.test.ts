import { describe, expect, it } from "vitest";
import type { BinaryDigest, SemanticDigest } from "../digest/canonical";
import { fraction } from "../fraction";
import { createSourceIdRemap } from "../source/revision";
import {
  computeProviderBundleDigest, coordinateMicrounit, isCorrectionPatchCompatible,
  mapVendorEvidenceToSource, matrixCoefficientNanounit, remapRevisionScopedTarget,
  validateOmrReviewRecord, type OmrReviewRecord, type VendorEvidenceBundle,
} from "./foundation";

const sd = "0".repeat(64) as SemanticDigest;
const bd = "1".repeat(64) as BinaryDigest;
const fromRevision = { documentId: "doc", revisionOrdinal: 0, revisionDigest: sd };
const toRevision = { documentId: "doc", revisionOrdinal: 1, revisionDigest: sd };

describe("revision-scoped OMR foundation", () => {
  it("remaps structural edit targets only through mapped-one SourceIdRemap", async () => {
    const remap = await createSourceIdRemap(fromRevision, toRevision, [{ entityKind: "lead-event", fromId: "le:old", toIds: ["le:new"], status: "mapped-one" }]);
    expect(remapRevisionScopedTarget({ sourceRevision: fromRevision, target: { kind: "voice-event", eventId: "le:old" } }, remap)).toEqual({ sourceRevision: toRevision, target: { kind: "voice-event", eventId: "le:new" } });
  });

  it("separates Vendor evidence payload from canonical target mapping authority", async () => {
    const box = { frameId: "frame:0", xMu: coordinateMicrounit(0), yMu: coordinateMicrounit(0), widthMu: coordinateMicrounit(1_000_000), heightMu: coordinateMicrounit(1_000_000) };
    const payload = { granularity: "measure", frames: [{ id: "frame:0", pageIndex: 0, coordinateSpace: "normalized-original", widthPixels: 100, heightPixels: 100, imageDigest: bd }], transforms: [], evidence: [{ id: "e:0", vendorTargetId: "vendor:0", granularity: "measure", box, vendorId: "vendor" }, { id: "e:1", granularity: "page", box, vendorId: "vendor" }] } as const;
    const bundle: VendorEvidenceBundle = { ...payload, providerBundleDigest: await computeProviderBundleDigest(payload) };
    const result = await mapVendorEvidenceToSource({ sourceRevision: fromRevision, mappingVersion: "map-v1", vendorBundle: bundle, targetMappings: [{ vendorTargetId: "vendor:0", target: { sourceRevision: fromRevision, target: { kind: "measure", sourceMeasureId: "m1" } } }] });
    expect(result.index.evidence.map((item) => item.id)).toEqual(["e:0"]);
    expect(result.archive.unmappedEvidence.map((item) => item.id)).toEqual(["e:1"]);
    expect(result.index.providerBundleDigest).toBe(bundle.providerBundleDigest);
  });

  it("canonicalizes every evidence graph permutation and blocks broken references", async () => {
    const frame0 = { id: "frame:0", pageIndex: 0, coordinateSpace: "normalized-original", widthPixels: 100, heightPixels: 100, imageDigest: bd } as const;
    const frame1 = { id: "frame:1", pageIndex: 0, coordinateSpace: "processed-pixels", widthPixels: 80, heightPixels: 80, imageDigest: "2".repeat(64) as BinaryDigest } as const;
    const identity = [
      matrixCoefficientNanounit(1_000_000_000), matrixCoefficientNanounit(0), matrixCoefficientNanounit(0),
      matrixCoefficientNanounit(0), matrixCoefficientNanounit(1_000_000_000), matrixCoefficientNanounit(0),
      matrixCoefficientNanounit(0), matrixCoefficientNanounit(0), matrixCoefficientNanounit(1_000_000_000),
    ] as const;
    const transform = { id: "transform:0", pageIndex: 0, sourceFrameId: frame1.id, targetFrameId: frame0.id, matrix3x3Nano: identity } as const;
    const transformBack = { id: "transform:1", pageIndex: 0, sourceFrameId: frame0.id, targetFrameId: frame1.id, matrix3x3Nano: identity } as const;
    const evidence0 = {
      id: "e:0", vendorTargetId: "vendor:0", granularity: "measure",
      box: { frameId: frame0.id, xMu: coordinateMicrounit(0), yMu: coordinateMicrounit(0), widthMu: coordinateMicrounit(500_000), heightMu: coordinateMicrounit(500_000) },
      vendorId: "vendor",
    } as const;
    const evidence1 = {
      id: "e:1", vendorTargetId: "vendor:1", granularity: "symbol",
      box: { frameId: frame1.id, xMu: coordinateMicrounit(0), yMu: coordinateMicrounit(0), widthMu: coordinateMicrounit(1_000_000), heightMu: coordinateMicrounit(1_000_000) },
      transformId: transform.id, vendorId: "vendor",
    } as const;
    const evidence2 = {
      id: "e:2", granularity: "page",
      box: { frameId: frame0.id, xMu: coordinateMicrounit(500_000), yMu: coordinateMicrounit(500_000), widthMu: coordinateMicrounit(500_000), heightMu: coordinateMicrounit(500_000) },
      vendorId: "vendor",
    } as const;
    const payload = { granularity: "symbol", frames: [frame0, frame1], transforms: [transform, transformBack], evidence: [evidence0, evidence1, evidence2] } as const;
    const permutedPayload = { ...payload, frames: [frame1, frame0], transforms: [transformBack, transform], evidence: [evidence2, evidence1, evidence0] } as const;
    const providerBundleDigest = await computeProviderBundleDigest(payload);
    expect(await computeProviderBundleDigest(permutedPayload)).toBe(providerBundleDigest);
    const mappings = [
      { vendorTargetId: "vendor:0", target: { sourceRevision: fromRevision, target: { kind: "measure", sourceMeasureId: "measure:0" } as const } },
      { vendorTargetId: "vendor:1", target: { sourceRevision: fromRevision, target: { kind: "voice-event", eventId: "event:0" } as const } },
    ] as const;
    const first = await mapVendorEvidenceToSource({ sourceRevision: fromRevision, mappingVersion: "map-v1", vendorBundle: { ...payload, providerBundleDigest }, targetMappings: mappings });
    const second = await mapVendorEvidenceToSource({ sourceRevision: fromRevision, mappingVersion: "map-v1", vendorBundle: { ...permutedPayload, providerBundleDigest }, targetMappings: [...mappings].reverse() });
    expect(second.index.bundleDigest).toBe(first.index.bundleDigest);
    expect(second.archive.archiveDigest).toBe(first.archive.archiveDigest);
    expect(second.index.frames.map((frame) => frame.id)).toEqual(first.index.frames.map((frame) => frame.id));
    expect(second.index.evidence.map((item) => item.id)).toEqual(first.index.evidence.map((item) => item.id));
    expect(second.index.targetMappings).toEqual(first.index.targetMappings);
    await expect(mapVendorEvidenceToSource({ sourceRevision: fromRevision, mappingVersion: "map-v1", vendorBundle: { ...payload, providerBundleDigest: sd }, targetMappings: mappings })).rejects.toThrow("providerBundleDigest");
    await expect(computeProviderBundleDigest({ ...payload, evidence: [{ ...evidence0, box: { ...evidence0.box, frameId: "frame:missing" } }] })).rejects.toThrow("evidence");
    await expect(computeProviderBundleDigest({ ...payload, transforms: [{ ...transform, targetFrameId: "frame:missing" }] })).rejects.toThrow("transform");
    await expect(computeProviderBundleDigest({ ...payload, frames: [frame0, frame0] })).rejects.toThrow("duplicate ID");
  });

  it("validates typed correction target compatibility", () => {
    expect(isCorrectionPatchCompatible({ kind: "voice-event", eventId: "le:0" }, { kind: "duration", duration: fraction(1) })).toBe(true);
    expect(isCorrectionPatchCompatible({ kind: "chord-event", chordEventId: "ch:0" }, { kind: "duration", duration: fraction(1) })).toBe(false);
  });

  it("checks review resolution to correction linkage", () => {
    const patch = { kind: "duration", duration: fraction(1) } as const;
    const record: OmrReviewRecord = { vendorResultDigest: bd, vendorId: "vendor", corrections: [{ id: "correction:0", reviewItemId: "review:0", target: { sourceRevision: fromRevision, target: { kind: "voice-event", eventId: "le:0" } }, beforeProjection: "{}", patch, source: "review-alternative", appliedAt: "2026-01-01T00:00:00Z" }], reviewItems: [{ id: "review:0", target: { sourceRevision: fromRevision, target: { kind: "voice-event", eventId: "le:0" } }, reasonCode: "OMR_REVIEW_REQUIRED", alternatives: [{ id: "alternative:0", labelKo: "duration", patch }], evidenceIds: [], resolution: { status: "accepted", selectedAlternativeId: "alternative:0", correctionRecordId: "correction:0" } }] };
    expect(validateOmrReviewRecord(record)).toEqual([]);
    expect(validateOmrReviewRecord({ ...record, corrections: [] })).toContain("OMR_REVIEW_RESOLUTION_INVALID:review:0");
    expect(validateOmrReviewRecord({
      ...record,
      corrections: [{ ...record.corrections[0], reviewItemId: "review:missing" }],
    })).toContain("OMR_REVIEW_RESOLUTION_INVALID:correction:0:review-reference");
    expect(validateOmrReviewRecord({ ...record, injectedAuthority: true })).toContain("OMR_REVIEW_RESOLUTION_INVALID:malformed-record");
    expect(validateOmrReviewRecord({
      ...record,
      corrections: [{ ...record.corrections[0], patch: { kind: "replace-event", event: { kind: "note", onset: fraction(0), duration: fraction(1), pitch: {}, tieStart: false, tieStop: false } } }],
    })).toContain("OMR_REVIEW_RESOLUTION_INVALID:malformed-record");
  });
});
