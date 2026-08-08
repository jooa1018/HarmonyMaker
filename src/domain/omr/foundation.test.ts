import { describe, expect, it } from "vitest";
import type { BinaryDigest, SemanticDigest } from "../digest/canonical";
import { fraction } from "../fraction";
import { createSourceIdRemap } from "../source/revision";
import { coordinateMicrounit, isCorrectionPatchCompatible, mapVendorEvidenceToSource, remapRevisionScopedTarget, validateOmrReviewRecord, type OmrReviewRecord, type VendorEvidenceBundle } from "./foundation";

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
    const bundle: VendorEvidenceBundle = { granularity: "measure", frames: [{ id: "frame:0", pageIndex: 0, coordinateSpace: "normalized-original", widthPixels: 100, heightPixels: 100, imageDigest: bd }], transforms: [], evidence: [{ id: "e:0", vendorTargetId: "vendor:0", granularity: "measure", box, vendorId: "vendor" }, { id: "e:1", granularity: "page", box, vendorId: "vendor" }], providerBundleDigest: sd };
    const result = await mapVendorEvidenceToSource({ sourceRevision: fromRevision, mappingVersion: "map-v1", vendorBundle: bundle, targetMappings: [{ vendorTargetId: "vendor:0", target: { sourceRevision: fromRevision, target: { kind: "measure", sourceMeasureId: "m1" } } }] });
    expect(result.index.evidence.map((item) => item.id)).toEqual(["e:0"]);
    expect(result.archive.unmappedEvidence.map((item) => item.id)).toEqual(["e:1"]);
    expect(result.index.providerBundleDigest).toBe(bundle.providerBundleDigest);
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
  });
});
