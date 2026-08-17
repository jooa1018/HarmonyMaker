import { describe, expect, it } from "vitest";

import { binaryDigest } from "../digest/canonical";
import { digestMusicalSource } from "../digest/source";
import { fraction } from "../fraction";
import { COMMON_TIME } from "../meter";
import type { SongSourceDocument } from "../source/model";
import { computeRevisionHistoryDigest } from "../source/revision";
import { computeProviderBundleDigest, coordinateMicrounit, validateOmrEvidenceArchive, validateOmrReviewRecord, validateSourceEvidenceIndex } from "./foundation";
import { attachOmrReviewContext, createInitialOmrReviewContext, prepareVendorMusicXml } from "./normalization";
import { validateRuntimeOmrReadiness } from "./readiness";

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Lead</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`;

describe("Vendor MusicXML normalization boundary", () => {
  it("verifies the raw digest and routes bytes through the accepted safe importer", async () => {
    const raw = new TextEncoder().encode(xml);
    const vendorResultDigest = await binaryDigest(raw);
    const evidencePayload = {
      granularity: "page" as const,
      frames: [{ id: "frame:0", pageIndex: 0, coordinateSpace: "normalized-original" as const, widthPixels: 100, heightPixels: 100, imageDigest: vendorResultDigest }],
      transforms: [],
      evidence: [{ id: "evidence:0", granularity: "page" as const, box: { frameId: "frame:0", xMu: coordinateMicrounit(0), yMu: coordinateMicrounit(0), widthMu: coordinateMicrounit(1_000_000), heightMu: coordinateMicrounit(1_000_000) }, vendorId: "hm-reference" }],
    };
    const result = await prepareVendorMusicXml({ vendorId: "hm-reference", vendorResultDigest, rawMusicXml: xml, evidence: { ...evidencePayload, providerBundleDigest: await computeProviderBundleDigest(evidencePayload) }, retentionInfo: { canDeleteImmediately: true } });
    expect(result.status).toBe("review-required");
    if (result.status === "review-required") {
      expect(result.draft.documentId).toBe(`doc:omr:${vendorResultDigest.slice(0, 32)}`);
      expect(result.draft.rawDigest).toBe(vendorResultDigest);
    }
  });

  it("rejects a mismatched raw Vendor result digest before parsing", async () => {
    await expect(prepareVendorMusicXml({ vendorId: "hm-reference", vendorResultDigest: "0".repeat(64) as never, rawMusicXml: xml, evidence: { granularity: "page", frames: [], transforms: [], evidence: [], providerBundleDigest: "0".repeat(64) as never }, retentionInfo: { canDeleteImmediately: true } })).rejects.toThrow("OMR_RESULT_INTEGRITY_FAILED");
  });
});

async function readinessSource(): Promise<SongSourceDocument> {
  let source: SongSourceDocument = {
    schemaVersion: 9, documentId: "doc:ready", revisionOrdinal: 0, revisionDigest: "0".repeat(64) as never,
    revisionHistory: [], revisionHistoryDigest: await computeRevisionHistoryDigest([]), title: "Ready",
    defaultKey: { tonic: { step: "C", alter: 0 }, mode: "major" }, defaultTempo: { beatUnit: 4, dotted: false, bpm: 100 },
    sourceMeasures: [{ id: "sm:0", number: 1, implicit: false, time: COMMON_TIME, duration: fraction(4), leadEvents: [{ kind: "note", id: "le:0:0", sourceMeasureId: "sm:0", onset: fraction(0), duration: fraction(4), pitch: { step: "C", alter: 0, octave: 4 }, tieStart: false, tieStop: false, lyricTokenIds: [] }], chordEvents: [], lyricTokens: [], textEvents: [], repeat: { startRepeat: false } }],
    performanceSequence: { expanderVersion: "repeat-v1", occurrences: [{ occurrenceId: "pm:0:0:0", sourceMeasureId: "sm:0", sourceMeasureNumber: 1, occurrenceIndexForSource: 0, performanceIndex: 0, time: COMMON_TIME, duration: fraction(4) }] },
    sectionDefinitions: [{ id: "sd:0:1:other:0", type: "other", label: "Song", sourceMeasureIds: ["sm:0"], confirmation: "confirmed" }],
    sectionOccurrences: [{ id: "so:0:1:0", sectionDefinitionId: "sd:0:1:other:0", occurrenceIndex: 0, variant: "base", lyricVerseIndex: 1, startPerformanceMeasureIndex: 0, endPerformanceMeasureIndexExclusive: 1 }],
    phraseRegions: [], rights: { basis: "self-authored", allowedUses: ["generation"] }, importInfo: { sourceKind: "omr", importerVersion: "omr-normalizer-v1" },
  };
  source = { ...source, revisionDigest: await digestMusicalSource(source) };
  return source;
}

describe("runtime OMR semantic readiness", () => {
  it("marks a plausible canonical Source validator-ready", async () => {
    expect(await validateRuntimeOmrReadiness(await readinessSource())).toEqual({ readiness: "validator-ready", diagnostics: [] });
  });

  it("never auto-readies blocking measure/tie failures", async () => {
    const source = await readinessSource();
    const broken = { ...source, sourceMeasures: [{ ...source.sourceMeasures[0], duration: fraction(3), leadEvents: [{ ...source.sourceMeasures[0].leadEvents[0], tieStart: true }] }] } as SongSourceDocument;
    const result = await validateRuntimeOmrReadiness(broken);
    expect(result.readiness).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["OMR_MEASURE_DURATION_INVALID", "OMR_TIE_INVALID"]));
  });

  it("maps explicit canonical target IDs and attaches review/evidence metadata without changing the musical digest", async () => {
    const source = await readinessSource();
    const vendorResultDigest = await binaryDigest(new TextEncoder().encode(xml));
    const payload = {
      granularity: "measure" as const,
      frames: [{ id: "frame:0", pageIndex: 0, coordinateSpace: "normalized-original" as const, widthPixels: 100, heightPixels: 100, imageDigest: vendorResultDigest }],
      transforms: [],
      evidence: [{ id: "evidence:lead", vendorTargetId: "le:0:0", granularity: "measure" as const, box: { frameId: "frame:0", xMu: coordinateMicrounit(0), yMu: coordinateMicrounit(0), widthMu: coordinateMicrounit(1_000_000), heightMu: coordinateMicrounit(1_000_000) }, vendorId: "hm-reference" }],
    };
    const providerResult = { vendorId: "hm-reference", vendorResultDigest, rawMusicXml: xml, evidence: { ...payload, providerBundleDigest: await computeProviderBundleDigest(payload) }, retentionInfo: { canDeleteImmediately: true } };
    const context = await createInitialOmrReviewContext(source, providerResult);
    expect(context.sourceEvidence.targetMappings).toHaveLength(1);
    expect(context.evidenceArchive.unmappedEvidence).toHaveLength(0);
    expect(context.reviewRecord.reviewItems).toHaveLength(1);
    expect(validateSourceEvidenceIndex(context.sourceEvidence)).toBe(true);
    expect(validateOmrEvidenceArchive(context.evidenceArchive)).toBe(true);
    expect(validateOmrReviewRecord(context.reviewRecord)).toEqual([]);
    const attached = await attachOmrReviewContext({ source, providerResult, reviewRecord: context.reviewRecord });
    expect(attached.revisionDigest).toBe(source.revisionDigest);
    expect(attached.importInfo).toMatchObject({ sourceKind: "omr", rawDigest: vendorResultDigest, omrReviewRecord: { vendorId: "hm-reference" } });
    expect(attached.sourceEvidence?.providerBundleDigest).toBe(providerResult.evidence.providerBundleDigest);
  });
});
