import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { APPLICATION_ALGORITHM_VERSION_REGISTRY } from "../../app/algorithm-version-registry";
import { parseChord } from "../../domain/chord/parser";
import { binaryDigest, semanticDigest } from "../../domain/digest/canonical";
import {
  computeProviderBundleDigest, coordinateMicrounit, quantizeHomography,
  type OmrReviewRecord,
} from "../../domain/omr/foundation";
import { REFERENCE_OMR_MUSICXML, referenceOmrPageBytes } from "../../domain/omr/reference-fixture-data";
import { attachOmrReviewContext, createInitialOmrReviewContext, prepareVendorMusicXml } from "../../domain/omr/normalization";
import { integrateReviewedOmrSource } from "../../domain/omr/product-handoff";
import { manuallyCorrectOmrReviewItem } from "../../domain/omr/review";
import { basisPoints } from "../../domain/rates";
import { validateHarmonyProject } from "../../domain/project";
import {
  confirmChord, confirmRights, confirmSection, selectLeadCandidate, setDefaultTempo, setPerformerRange,
} from "../../import/review/commands";
import { deriveQuickReview } from "../../import/review/quick-review";
import { step3ImportVersionsFromRegistry, type MusicXmlImportDraft } from "../../import/musicxml/types";
import { createProjectFromQuickReview, generateProjectVariant } from "../../product/workspace";
import { loadProductExecutionRegistry } from "../../product/registry";
import { MemoryGovernanceStore } from "../persistence/memory-store.test-adapter";
import type { PrivateRowId } from "../persistence/store";
import { MemoryOwnedObjectStore } from "../storage/memory-owned-object-store.test-adapter";
import { DurableOmrApplicationService, omrQuotaConfig } from "./application-service";
import { ReferenceOmrVendorAdapter, type ReferenceOmrFixture } from "./reference-adapter";
import { MemoryOmrStore } from "./store";

const versions = step3ImportVersionsFromRegistry(APPLICATION_ALGORITHM_VERSION_REGISTRY);
const rights = { basis: "self-authored" as const, allowedUses: ["generation", "provider-transfer"] as const };

function completeReview(draft: MusicXmlImportDraft): MusicXmlImportDraft {
  let next = draft.selectedLeadStaffKey ? draft : selectLeadCandidate(draft, draft.leadCandidates[0].key);
  for (const part of next.parts) for (const measure of part.measures) for (const chord of measure.chords) next = confirmChord(next, chord.key);
  for (const section of next.sections) next = confirmSection(next, section.key);
  if (!next.defaultTempo) next = setDefaultTempo(next, { beatUnit: 4, dotted: false, bpm: 100 });
  next = setPerformerRange(next, 0, {
    displayName: "Lead",
    hardRange: { low: { step: "C", alter: 0, octave: 3 }, high: { step: "C", alter: 0, octave: 6 } },
    comfortableRange: { low: { step: "G", alter: 0, octave: 3 }, high: { step: "G", alter: 0, octave: 5 } },
  });
  return confirmRights(next, rights);
}

function evidenceFixture(iteration: number, pageDigest: Awaited<ReturnType<typeof binaryDigest>>): ReferenceOmrFixture["evidence"] {
  const suffix = `run-${iteration}`;
  const original = { id: `frame:original:${suffix}`, pageIndex: 0, coordinateSpace: "original-pixels" as const, widthPixels: 260, heightPixels: 340, imageDigest: pageDigest };
  const processed = { id: `frame:processed:${suffix}`, pageIndex: 0, coordinateSpace: "processed-pixels" as const, widthPixels: 260, heightPixels: 340, imageDigest: pageDigest };
  const transform = { id: `transform:${suffix}`, pageIndex: 0, sourceFrameId: processed.id, targetFrameId: original.id, matrix3x3Nano: quantizeHomography(["1", "0", "0", "0", "1", "0", "0", "0", "1"]) };
  const page = { id: `evidence:page:${suffix}`, granularity: "page" as const, box: { frameId: original.id, xMu: coordinateMicrounit(0), yMu: coordinateMicrounit(0), widthMu: coordinateMicrounit(260_000_000), heightMu: coordinateMicrounit(340_000_000) }, vendorId: "hm-reference" };
  const measure = { id: `evidence:measure:${suffix}`, vendorTargetId: "symbol_abc", granularity: "measure" as const, box: { frameId: processed.id, xMu: coordinateMicrounit(13_000_000), yMu: coordinateMicrounit(14_000_000), widthMu: coordinateMicrounit(234_000_000), heightMu: coordinateMicrounit(95_000_000) }, transformId: transform.id, confidenceBp: basisPoints(9000), vendorId: "hm-reference" };
  const reverse = iteration % 2 === 1;
  return {
    granularity: "measure",
    frames: reverse ? [processed, original] : [original, processed],
    transforms: [transform],
    evidence: reverse ? [measure, page] : [page, measure],
  };
}

describe("canonical OMR fixture pipeline determinism", () => {
  it("produces one semantic result over 101 governance and Vendor-order permutations", async () => {
    const pageBytes = referenceOmrPageBytes();
    const pageDigest = await binaryDigest(pageBytes);
    const pageDigests = new Set<string>();
    const vendorResultDigests = new Set<string>();
    const providerBundleDigests = new Set<string>();
    const sourceEvidenceDigests = new Set<string>();
    const archiveDigests = new Set<string>();
    const reviewResults = new Set<string>();
    const sourceResults = new Set<string>();
    const identityResults = new Set<string>();
    const opaqueHandles = new Set<string>();

    for (let iteration = 0; iteration < 101; iteration += 1) {
      const evidence = evidenceFixture(iteration, pageDigest);
      const fixture: ReferenceOmrFixture = {
        id: `fixture:${iteration}`, orderedPageDigests: [pageDigest], statusScript: [{ kind: "completed" }],
        musicXml: REFERENCE_OMR_MUSICXML, evidence,
        normalizationMappings: [{ vendorTargetId: "symbol_abc", target: { kind: "chord-event", measureOrdinal: 0, eventOrdinal: 0 } }],
        retentionInfo: { canDeleteImmediately: true, policyReference: "in-repository-reference-fixture" },
      };
      const adapter = new ReferenceOmrVendorAdapter([fixture], {
        vendorId: "hm-reference", supportedMimeTypes: ["image/png"], maxPages: 12,
        evidenceGranularity: "measure", supportsDeletion: true, retentionDisclosure: true,
        supportsIdempotency: true, supportsInteractiveInput: true, estimatedCreditPerPage: 1,
      });
      for (let dummy = 0; dummy < iteration % 3; dummy += 1) await adapter.createVendorJob({ pageCount: 1, idempotencyKey: `governance-dummy:${iteration}:${dummy}` });
      const governance = new MemoryGovernanceStore();
      const objects = new MemoryOwnedObjectStore(governance);
      const sessionId = `session:determinism:${iteration}` as PrivateRowId;
      const now = new Date(Date.UTC(2026, 0, 1, 0, 0, iteration));
      const service = new DurableOmrApplicationService({
        store: new MemoryOmrStore(), objects, adapter,
        handleHmacKey: new Uint8Array(32).fill(11), vendorJobEncryptionKey: new Uint8Array(32).fill(12),
        quota: omrQuotaConfig(1_000), actor: { sessionId, ipOwnerHash: `ip:hmac:${iteration}` }, now: () => now,
        inspectPage: async ({ bytes, mimeType }) => ({
          bytes: Uint8Array.from(bytes), digest: await binaryDigest(bytes), mimeType, width: 260, height: 340,
          quality: { blurBp: basisPoints(0), perspectiveBp: basisPoints(0), glareBp: basisPoints(0), cropRiskBp: basisPoints(0), estimatedStaffSpacePixels: 20, status: "pass", reasons: [] },
        }),
      });
      const preflight = await service.getProviderPreflight();
      const handle = await service.createJob({ sessionId, pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, consentCapabilitySnapshotDigest: preflight.capabilitySnapshotDigest, idempotencyKey: `create:${iteration}` });
      opaqueHandles.add(handle);
      await service.uploadPage(handle, { pageIndex: 0, pageDigest, mimeType: "image/png", idempotencyKey: `upload:${iteration}`, bytes: new Blob([pageBytes.slice().buffer as ArrayBuffer], { type: "image/png" }) });
      await service.start(handle);
      expect(await service.getStatus(handle)).toEqual({ kind: "completed" });
      const providerResult = await service.exportResult(handle);

      const prepared = await prepareVendorMusicXml(providerResult);
      expect(prepared.status).toBe("review-required");
      if (prepared.status !== "review-required") throw new Error("reference fixture importer unexpectedly blocked");
      const reviewedDraft = completeReview(prepared.draft);
      const analysis = await deriveQuickReview(reviewedDraft, versions);
      if (!analysis.state.readyForPlanning) throw new Error(JSON.stringify({ state: analysis.state, diagnostics: analysis.diagnostics }));
      const project = await createProjectFromQuickReview(reviewedDraft, analysis, "standard");
      const initial = await createInitialOmrReviewContext(project.source, providerResult);
      expect(initial.reviewRecord.reviewItems).toHaveLength(1);
      const item = initial.reviewRecord.reviewItems[0];
      const parsedChord = parseChord("Dm");
      if (parsedChord.status !== "ok") throw new Error("deterministic test chord failed to parse");
      const corrected = await manuallyCorrectOmrReviewItem({
        source: project.source,
        item,
        patch: { kind: "chord", parseResult: parsedChord },
        appliedAt: now.toISOString(),
      });
      const reviewRecord: OmrReviewRecord = { ...initial.reviewRecord, corrections: [corrected.correction], reviewItems: [corrected.item] };
      const source = await attachOmrReviewContext({ source: corrected.source, providerResult, reviewRecord });
      if (iteration === 0) {
        const integrated = await integrateReviewedOmrSource(project, source);
        const integrity = await validateHarmonyProject(integrated, await loadProductExecutionRegistry());
        if (integrity.status !== "complete") throw new Error(JSON.stringify(integrity.diagnostics));
        const generation = await generateProjectVariant(integrated, "standard");
        expect(generation.status).toBe("complete");
      }

      pageDigests.add(pageDigest);
      vendorResultDigests.add(providerResult.vendorResultDigest);
      providerBundleDigests.add(providerResult.evidence.providerBundleDigest);
      sourceEvidenceDigests.add(source.sourceEvidence?.bundleDigest ?? "missing");
      archiveDigests.add(source.importInfo?.omrEvidenceArchive?.archiveDigest ?? "missing");
      reviewResults.add(await semanticDigest({ projectionSchema: "hm-omr-101-review-result-v1", items: reviewRecord.reviewItems.map(({ id, alternatives, resolution }) => ({ id, alternativeIds: alternatives.map((alternative) => alternative.id), resolution })), corrections: reviewRecord.corrections.map(({ id, patch, source: correctionSource }) => ({ id, patch, correctionSource })) }));
      sourceResults.add(source.revisionDigest);
      identityResults.add(await semanticDigest({ projectionSchema: "hm-omr-101-canonical-identities-v1", sourceMeasureIds: source.sourceMeasures.map((measure) => measure.id), eventIds: source.sourceMeasures.flatMap((measure) => [...measure.leadEvents, ...measure.chordEvents].map((event) => event.id)), reviewItemIds: reviewRecord.reviewItems.map((reviewItem) => reviewItem.id), correctionIds: reviewRecord.corrections.map((correction) => correction.id) }));
      expect(await computeProviderBundleDigest(providerResult.evidence)).toBe(providerResult.evidence.providerBundleDigest);
    }

    expect(opaqueHandles.size).toBe(101);
    for (const results of [pageDigests, vendorResultDigests, providerBundleDigests, sourceEvidenceDigests, archiveDigests, reviewResults, sourceResults, identityResults]) expect(results.size).toBe(1);
  }, 30_000);
});
