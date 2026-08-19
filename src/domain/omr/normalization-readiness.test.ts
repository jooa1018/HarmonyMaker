import { describe, expect, it } from "vitest";

import { binaryDigest } from "../digest/canonical";
import { digestMusicalSource } from "../digest/source";
import { fraction } from "../fraction";
import type { SpelledPitch } from "../pitch";
import { COMMON_TIME } from "../meter";
import type { SongSourceDocument } from "../source/model";
import { computeRevisionHistoryDigest } from "../source/revision";
import { computeProviderBundleDigest, coordinateMicrounit, validateOmrEvidenceArchive, validateOmrReviewRecord, validateSourceEvidenceIndex } from "./foundation";
import { computeVendorNormalizationMappingDigest, validateVendorNormalizationMappingArtifact, type VendorExportEvidenceMapping } from "./contracts";
import { attachOmrReviewContext, createInitialOmrReviewContext, prepareVendorMusicXml } from "./normalization";
import { validateRuntimeOmrReadiness } from "./readiness";
import { acceptOmrReviewAlternative, validateReviewEvidenceTargetBindings } from "./review";
import { parseChord } from "../chord/parser";
import { computeMusicXmlSourceTargetMapDigest } from "./import-identity";
import { computeSourceProvenanceDigest } from "../source/provenance";

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Lead</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`;

async function mappingArtifact(vendorResultDigest: Awaited<ReturnType<typeof binaryDigest>>, providerBundleDigest: Awaited<ReturnType<typeof computeProviderBundleDigest>>, mappings: readonly VendorExportEvidenceMapping[] = []) {
  const artifact = { version: "vendor-export-target-map-v2" as const, vendorResultDigest, providerBundleDigest, mappings };
  return { ...artifact, artifactDigest: await computeVendorNormalizationMappingDigest(artifact) };
}

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
    const providerBundleDigest = await computeProviderBundleDigest(evidencePayload);
    const result = await prepareVendorMusicXml({ vendorId: "hm-reference", vendorResultDigest, rawMusicXml: xml, evidence: { ...evidencePayload, providerBundleDigest }, normalizationMapping: await mappingArtifact(vendorResultDigest, providerBundleDigest), retentionInfo: { canDeleteImmediately: true } });
    expect(result.status).toBe("review-required");
    if (result.status === "review-required") {
      expect(result.draft.documentId).toBe(`doc:omr:${vendorResultDigest.slice(0, 32)}`);
      expect(result.draft.rawDigest).toBe(vendorResultDigest);
    }
  });

  it("rejects a mismatched raw Vendor result digest before parsing", async () => {
    const zero = "0".repeat(64) as Awaited<ReturnType<typeof binaryDigest>>;
    const semanticZero = "0".repeat(64) as Awaited<ReturnType<typeof computeProviderBundleDigest>>;
    await expect(prepareVendorMusicXml({ vendorId: "hm-reference", vendorResultDigest: zero, rawMusicXml: xml, evidence: { granularity: "page", frames: [], transforms: [], evidence: [], providerBundleDigest: semanticZero }, normalizationMapping: await mappingArtifact(zero, semanticZero), retentionInfo: { canDeleteImmediately: true } })).rejects.toThrow("OMR_RESULT_INTEGRITY_FAILED");
  });
});

async function readinessSource(): Promise<SongSourceDocument> {
  let source = {
    schemaVersion: 9, documentId: "doc:ready", revisionOrdinal: 0, revisionDigest: "0".repeat(64) as never,
    revisionHistory: [], revisionHistoryDigest: await computeRevisionHistoryDigest([]), title: "Ready",
    sourceProvenanceDigest: "0".repeat(64) as never,
    defaultKey: { tonic: { step: "C", alter: 0 }, mode: "major" }, defaultTempo: { beatUnit: 4, dotted: false, bpm: 100 },
    sourceMeasures: [{ id: "sm:0", number: 1, implicit: false, time: COMMON_TIME, duration: fraction(4), leadEvents: [{ kind: "note", id: "le:0:0", sourceMeasureId: "sm:0", onset: fraction(0), duration: fraction(4), pitch: { step: "C", alter: 0, octave: 4 }, tieStart: false, tieStop: false, lyricTokenIds: [] }], chordEvents: [], lyricTokens: [], textEvents: [], repeat: { startRepeat: false } }],
    performanceSequence: { expanderVersion: "repeat-v1", occurrences: [{ occurrenceId: "pm:0:0:0", sourceMeasureId: "sm:0", sourceMeasureNumber: 1, occurrenceIndexForSource: 0, performanceIndex: 0, time: COMMON_TIME, duration: fraction(4) }] },
    sectionDefinitions: [{ id: "sd:0:1:other:0", type: "other", label: "Song", sourceMeasureIds: ["sm:0"], confirmation: "confirmed" }],
    sectionOccurrences: [{ id: "so:0:1:0", sectionDefinitionId: "sd:0:1:other:0", occurrenceIndex: 0, variant: "base", lyricVerseIndex: 1, startPerformanceMeasureIndex: 0, endPerformanceMeasureIndexExclusive: 1 }],
    phraseRegions: [], rights: { basis: "self-authored", allowedUses: ["generation"] }, importInfo: { sourceKind: "omr", importerVersion: "omr-normalizer-v1" },
  } as unknown as SongSourceDocument;
  source = { ...source, revisionDigest: await digestMusicalSource(source) };
  const sourceRevision = { documentId: source.documentId, revisionOrdinal: source.revisionOrdinal, revisionDigest: source.revisionDigest };
  const entries = [
    { selector: { kind: "measure" as const, musicXmlPartOrdinal: 0, measureOrdinal: 0 }, status: "mapped-one" as const, targets: [{ kind: "measure" as const, sourceMeasureId: "sm:0" }] as const },
    { selector: { kind: "measure-start" as const, musicXmlPartOrdinal: 0, measureOrdinal: 0 }, status: "mapped-one" as const, targets: [{ kind: "measure-start" as const, sourceMeasureId: "sm:0" }] as const },
    { selector: { kind: "measure-end" as const, musicXmlPartOrdinal: 0, measureOrdinal: 0 }, status: "mapped-one" as const, targets: [{ kind: "measure-end" as const, sourceMeasureId: "sm:0" }] as const },
    { selector: { kind: "voice-event" as const, musicXmlPartOrdinal: 0, musicXmlStaffNumber: 1, musicXmlVoiceKey: "1", measureOrdinal: 0, eventOrdinal: 0 }, status: "mapped-one" as const, targets: [{ kind: "voice-event" as const, eventId: "le:0:0" }] as const },
  ];
  const map = { version: "musicxml-source-target-map-v1" as const, sourceRevision, entries };
  source = { ...source, importInfo: { ...source.importInfo!, musicXmlSourceTargetMap: { ...map, mapDigest: await computeMusicXmlSourceTargetMapDigest(map) } } } as unknown as SongSourceDocument;
  source = { ...source, sourceProvenanceDigest: await computeSourceProvenanceDigest(source) };
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

  it("validates spelled-pitch ties on one Source-order timeline across measures, pickups, and same-measure events", async () => {
    const base = await readinessSource();
    const note = (id: string, sourceMeasureId: string, onset: number, duration: number, tieStart: boolean, tieStop: boolean, pitch: SpelledPitch = { step: "C", alter: 0, octave: 4 }) => ({ kind: "note" as const, id, sourceMeasureId, onset: fraction(onset), duration: fraction(duration), pitch, tieStart, tieStop, lyricTokenIds: [] });
    const twoMeasures = (firstDuration: number, firstImplicit: boolean, secondPitch: SpelledPitch = { step: "C", alter: 0, octave: 4 }) => ({
      ...base,
      sourceMeasures: [
        { ...base.sourceMeasures[0], id: "sm:tie:0", implicit: firstImplicit, duration: fraction(firstDuration), leadEvents: [note("le:tie:0", "sm:tie:0", 0, firstDuration, true, false)] },
        { ...base.sourceMeasures[0], id: "sm:tie:1", number: 2, leadEvents: [note("le:tie:1", "sm:tie:1", 0, 4, false, true, secondPitch)] },
      ],
    } as SongSourceDocument);
    expect((await validateRuntimeOmrReadiness(twoMeasures(4, false))).diagnostics.map((item) => item.code)).not.toContain("OMR_TIE_INVALID");
    expect((await validateRuntimeOmrReadiness(twoMeasures(1, true))).diagnostics.map((item) => item.code)).not.toContain("OMR_TIE_INVALID");
    const enharmonicButDifferentlySpelled = await validateRuntimeOmrReadiness(twoMeasures(4, false, { step: "B", alter: 1, octave: 3 }));
    expect(enharmonicButDifferentlySpelled.diagnostics.map((item) => item.code)).toContain("OMR_TIE_INVALID");
    const sameMeasure = { ...base, sourceMeasures: [{ ...base.sourceMeasures[0], leadEvents: [note("le:same:0", "sm:0", 0, 2, true, false), note("le:same:1", "sm:0", 2, 2, false, true)] }] } as SongSourceDocument;
    expect((await validateRuntimeOmrReadiness(sameMeasure)).diagnostics.map((item) => item.code)).not.toContain("OMR_TIE_INVALID");
    const gap = { ...sameMeasure, sourceMeasures: [{ ...sameMeasure.sourceMeasures[0], leadEvents: [note("le:gap:0", "sm:0", 0, 1, true, false), note("le:gap:1", "sm:0", 2, 2, false, true)] }] } as SongSourceDocument;
    expect((await validateRuntimeOmrReadiness(gap)).diagnostics.map((item) => item.code)).toContain("OMR_TIE_INVALID");
  });

  it("maps noncanonical Vendor target IDs through the explicit normalization artifact and requires item resolution", async () => {
    const source = await readinessSource();
    const vendorResultDigest = await binaryDigest(new TextEncoder().encode(xml));
    const payload = {
      granularity: "measure" as const,
      frames: [{ id: "frame:0", pageIndex: 0, coordinateSpace: "normalized-original" as const, widthPixels: 100, heightPixels: 100, imageDigest: vendorResultDigest }],
      transforms: [],
      evidence: [{ id: "evidence:lead", vendorTargetId: "symbol_abc", granularity: "measure" as const, box: { frameId: "frame:0", xMu: coordinateMicrounit(0), yMu: coordinateMicrounit(0), widthMu: coordinateMicrounit(1_000_000), heightMu: coordinateMicrounit(1_000_000) }, vendorId: "hm-reference" }],
    };
    const providerBundleDigest = await computeProviderBundleDigest(payload);
    const providerResult = { vendorId: "hm-reference", vendorResultDigest, rawMusicXml: xml, evidence: { ...payload, providerBundleDigest }, normalizationMapping: await mappingArtifact(vendorResultDigest, providerBundleDigest, [{ vendorTargetId: "symbol_abc", target: { kind: "voice-event", musicXmlPartOrdinal: 0, musicXmlStaffNumber: 1, musicXmlVoiceKey: "1", measureOrdinal: 0, eventOrdinal: 0 } }]), retentionInfo: { canDeleteImmediately: true } };
    const selection = { partOrdinal: 0, staffNumber: 1, voiceKey: "1", chordAuthorityPartOrdinal: 0 };
    const context = await createInitialOmrReviewContext(source, providerResult, selection);
    expect(context.sourceEvidence.targetMappings).toHaveLength(1);
    expect(context.evidenceArchive.unmappedEvidence).toHaveLength(0);
    expect(context.reviewRecord.reviewItems).toHaveLength(1);
    expect(validateSourceEvidenceIndex(context.sourceEvidence)).toBe(true);
    expect(validateOmrEvidenceArchive(context.evidenceArchive)).toBe(true);
    expect(validateOmrReviewRecord(context.reviewRecord)).toEqual([]);
    await expect(attachOmrReviewContext({ source, providerResult, reviewRecord: context.reviewRecord, selection })).rejects.toThrow("OMR_REVIEW_REQUIRED");
    const item = context.reviewRecord.reviewItems[0];
    const accepted = await acceptOmrReviewAlternative({ source, item, alternativeId: item.alternatives[0].id, appliedAt: "2026-01-01T00:00:00.000Z" });
    const reviewRecord = { ...context.reviewRecord, corrections: [accepted.correction], reviewItems: [accepted.item] };
    const attached = await attachOmrReviewContext({ source: accepted.source, providerResult, reviewRecord, selection });
    expect(attached.revisionOrdinal).toBe(1);
    expect(attached.importInfo).toMatchObject({ sourceKind: "omr", rawDigest: vendorResultDigest, omrReviewRecord: { vendorId: "hm-reference" } });
    expect(attached.sourceEvidence?.providerBundleDigest).toBe(providerResult.evidence.providerBundleDigest);
  });

  it("preserves real-style IDs and bridges only the selected MusicXML part/staff/voice identity", async () => {
    const base = await readinessSource();
    const chordEntry = { selector: { kind: "chord-event" as const, musicXmlPartOrdinal: 0, measureOrdinal: 0, eventOrdinal: 0 }, status: "mapped-one" as const, targets: [{ kind: "chord-event" as const, chordEventId: "ch:0:0" }] as const };
    const entries = [...base.importInfo!.musicXmlSourceTargetMap!.entries, chordEntry];
    const map = { version: "musicxml-source-target-map-v1" as const, sourceRevision: base.importInfo!.musicXmlSourceTargetMap!.sourceRevision, entries };
    const source = { ...base, sourceMeasures: [{ ...base.sourceMeasures[0], chordEvents: [{ id: "ch:0:0", sourceMeasureId: "sm:0", onset: fraction(0), sourceText: "C", parseResult: parseChord("C"), source: "omr" as const, confirmation: "unconfirmed" as const }] }], importInfo: { ...base.importInfo!, musicXmlSourceTargetMap: { ...map, mapDigest: await computeMusicXmlSourceTargetMapDigest(map) } } } as SongSourceDocument;
    const vendorResultDigest = await binaryDigest(new TextEncoder().encode(xml));
    const frame = { id: "frame:vendor", pageIndex: 0, coordinateSpace: "normalized-original" as const, widthPixels: 100, heightPixels: 100, imageDigest: vendorResultDigest };
    const evidence = ["page_1", "staff_main", "measure_42", "symbol_abc", "symbol_other_part", "symbol_other_staff"].map((vendorTargetId, index) => ({ id: `evidence:vendor:${index}`, vendorTargetId, granularity: (["page", "staff", "measure", "symbol", "symbol", "symbol"] as const)[index], box: { frameId: frame.id, xMu: coordinateMicrounit(index * 10_000), yMu: coordinateMicrounit(index * 10_000), widthMu: coordinateMicrounit(100_000), heightMu: coordinateMicrounit(100_000) }, vendorId: "hm-reference" }));
    const payload = { granularity: "symbol" as const, frames: [frame], transforms: [], evidence };
    const providerBundleDigest = await computeProviderBundleDigest(payload);
    const providerResult = {
      vendorId: "hm-reference", vendorResultDigest, rawMusicXml: xml,
      evidence: { ...payload, providerBundleDigest },
      normalizationMapping: await mappingArtifact(vendorResultDigest, providerBundleDigest, [
        { vendorTargetId: "page_1", target: { kind: "measure", musicXmlPartOrdinal: 0, measureOrdinal: 0 } },
        { vendorTargetId: "staff_main", target: { kind: "voice-event", musicXmlPartOrdinal: 0, musicXmlStaffNumber: 1, musicXmlVoiceKey: "1", measureOrdinal: 0, eventOrdinal: 0 } },
        { vendorTargetId: "measure_42", target: { kind: "measure-start", musicXmlPartOrdinal: 0, measureOrdinal: 0 } },
        { vendorTargetId: "symbol_abc", target: { kind: "chord-event", musicXmlPartOrdinal: 0, measureOrdinal: 0, eventOrdinal: 0 } },
        { vendorTargetId: "symbol_other_part", target: { kind: "voice-event", musicXmlPartOrdinal: 1, musicXmlStaffNumber: 1, musicXmlVoiceKey: "1", measureOrdinal: 0, eventOrdinal: 0 } },
        { vendorTargetId: "symbol_other_staff", target: { kind: "voice-event", musicXmlPartOrdinal: 0, musicXmlStaffNumber: 2, musicXmlVoiceKey: "2", measureOrdinal: 0, eventOrdinal: 0 } },
      ]),
      retentionInfo: { canDeleteImmediately: true },
    };
    const context = await createInitialOmrReviewContext(source, providerResult, { partOrdinal: 0, staffNumber: 1, voiceKey: "1", chordAuthorityPartOrdinal: 0 });
    expect(context.sourceEvidence.targetMappings.map((mapping) => mapping.vendorTargetId).sort()).toEqual(["measure_42", "page_1", "staff_main", "symbol_abc"]);
    expect(context.sourceEvidence.targetMappings.map((mapping) => mapping.target.target.kind).sort()).toEqual(["chord-event", "measure", "measure-start", "voice-event"]);
    expect(context.reviewRecord.reviewItems.map((item) => item.target.target.kind).sort()).toEqual(["chord-event", "measure-start", "voice-event"]);
    expect(context.evidenceArchive.unmappedEvidence.map((item) => item.vendorTargetId).sort()).toEqual(["symbol_other_part", "symbol_other_staff"]);
    const swappable = context.reviewRecord.reviewItems.filter((item) => item.evidenceIds.length === 1).slice(0, 2);
    const swappedRecord = {
      ...context.reviewRecord,
      reviewItems: context.reviewRecord.reviewItems.map((item) => item.id === swappable[0].id
        ? { ...item, evidenceIds: swappable[1].evidenceIds }
        : item.id === swappable[1].id ? { ...item, evidenceIds: swappable[0].evidenceIds } : item),
    };
    expect(validateReviewEvidenceTargetBindings(source, swappedRecord, context.sourceEvidence, context.evidenceArchive)).toHaveLength(2);
  });

  it("rejects stale result and provider-bundle bindings in the normalization mapping artifact", async () => {
    const vendorResultDigest = await binaryDigest(new TextEncoder().encode(xml));
    const payload = { granularity: "page" as const, frames: [], transforms: [], evidence: [] };
    const providerBundleDigest = await computeProviderBundleDigest(payload);
    const staleResult = await mappingArtifact("f".repeat(64) as typeof vendorResultDigest, providerBundleDigest);
    await expect(prepareVendorMusicXml({ vendorId: "hm-reference", vendorResultDigest, rawMusicXml: xml, evidence: { ...payload, providerBundleDigest }, normalizationMapping: staleResult, retentionInfo: { canDeleteImmediately: true } })).rejects.toThrow("OMR_RESULT_INTEGRITY_FAILED");
    const staleBundle = await mappingArtifact(vendorResultDigest, "e".repeat(64) as typeof providerBundleDigest);
    await expect(prepareVendorMusicXml({ vendorId: "hm-reference", vendorResultDigest, rawMusicXml: xml, evidence: { ...payload, providerBundleDigest }, normalizationMapping: staleBundle, retentionInfo: { canDeleteImmediately: true } })).rejects.toThrow("OMR_RESULT_INTEGRITY_FAILED");
    const invalidArtifactInput = { version: "vendor-export-target-map-v2" as const, vendorResultDigest, providerBundleDigest, mappings: [{ vendorTargetId: "symbol_abc", target: { kind: "vendor-private-kind", musicXmlPartOrdinal: 0, measureOrdinal: 0 } }] as unknown as readonly VendorExportEvidenceMapping[] };
    const invalidArtifact = { ...invalidArtifactInput, artifactDigest: await computeVendorNormalizationMappingDigest(invalidArtifactInput) };
    await expect(validateVendorNormalizationMappingArtifact(invalidArtifact)).rejects.toThrow("OMR_EVIDENCE_TARGET_UNMAPPED");
  });
});
