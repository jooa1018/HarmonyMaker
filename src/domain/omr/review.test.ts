import { describe, expect, it } from "vitest";

import { parseChord } from "../chord/parser";
import { digestMusicalSource } from "../digest/source";
import { fraction } from "../fraction";
import { COMMON_TIME } from "../meter";
import type { SongSourceDocument } from "../source/model";
import { computeRevisionHistoryDigest } from "../source/revision";
import { validateOmrReviewCompletion, validateOmrReviewRecord, type OmrReviewRecord } from "./foundation";
import {
  acceptOmrReviewAlternative, applyOmrCorrection, createOmrReviewItem,
  manuallyCorrectOmrReviewItem, proposeOmrAutoRepairs, rejectOmrReviewAlternatives,
  resolveOmrAutoRepair, validateOmrCorrectionHistory,
} from "./review";

async function sourceFixture(): Promise<SongSourceDocument> {
  const pending = "0".repeat(64) as SongSourceDocument["revisionDigest"];
  let source: SongSourceDocument = {
    schemaVersion: 9, documentId: "doc:omr:test", revisionOrdinal: 0, revisionDigest: pending,
    revisionHistory: [], revisionHistoryDigest: await computeRevisionHistoryDigest([]), title: "OMR Test",
    defaultKey: { tonic: { step: "C", alter: 0 }, mode: "major" }, defaultTempo: { beatUnit: 4, dotted: false, bpm: 100 },
    sourceMeasures: [{
      id: "sm:0", number: 1, implicit: false, time: COMMON_TIME, duration: fraction(4),
      leadEvents: [{ kind: "note", id: "le:0:0", sourceMeasureId: "sm:0", onset: fraction(0), duration: fraction(3), pitch: { step: "C", alter: 0, octave: 4 }, tieStart: false, tieStop: false, lyricTokenIds: [] }],
      chordEvents: [{ id: "ch:0:0", sourceMeasureId: "sm:0", onset: fraction(0), sourceText: "C", parseResult: parseChord("C"), source: "omr", confirmation: "unconfirmed" }],
      lyricTokens: [], textEvents: [{ id: "tx:0:0/1:section-label:0", sourceMeasureId: "sm:0", onset: fraction(0), kind: "section-label", text: "Verse" }], repeat: { startRepeat: false },
    }],
    performanceSequence: { expanderVersion: "repeat-v1", occurrences: [{ occurrenceId: "pm:0:0:0", sourceMeasureId: "sm:0", sourceMeasureNumber: 1, occurrenceIndexForSource: 0, performanceIndex: 0, time: COMMON_TIME, duration: fraction(4) }] },
    sectionDefinitions: [{ id: "sd:0:1:verse:0", type: "verse", label: "Verse", sourceMeasureIds: ["sm:0"], confirmation: "confirmed" }],
    sectionOccurrences: [{ id: "so:0:1:0", sectionDefinitionId: "sd:0:1:verse:0", occurrenceIndex: 0, variant: "base", lyricVerseIndex: 1, startPerformanceMeasureIndex: 0, endPerformanceMeasureIndexExclusive: 1 }],
    phraseRegions: [], rights: { basis: "self-authored", allowedUses: ["generation", "provider-transfer"] },
    importInfo: { sourceKind: "omr", importerVersion: "omr-normalizer-v1" },
  };
  source = { ...source, revisionDigest: await digestMusicalSource(source) };
  return source;
}

describe("typed OMR correction and Source revision", () => {
  it("applies a compatible patch, preserves target IDs, and creates canonical revision/remap/history", async () => {
    const source = await sourceFixture();
    const result = await applyOmrCorrection({
      source,
      target: { sourceRevision: { documentId: source.documentId, revisionOrdinal: source.revisionOrdinal, revisionDigest: source.revisionDigest }, target: { kind: "voice-event", eventId: "le:0:0" } },
      patch: { kind: "duration", duration: fraction(4) }, correctionSource: "manual", appliedAt: "2026-01-01T00:00:00.000Z", reviewItemId: "review:0",
    });
    expect(result.source.revisionOrdinal).toBe(1);
    expect(result.source.sourceMeasures[0].leadEvents[0]).toMatchObject({ id: "le:0:0", duration: fraction(4) });
    expect(result.idRemap.entries.find((entry) => entry.fromId === "le:0:0")).toMatchObject({ status: "mapped-one", toIds: ["le:0:0"] });
    expect(result.source.revisionHistory).toHaveLength(1);
    expect(result.correction).toMatchObject({ reviewItemId: "review:0", source: "manual", target: { target: { eventId: "le:0:0" } } });
  });

  it("supports note-to-rest replacement without accepting injected identity", async () => {
    const source = await sourceFixture();
    const result = await applyOmrCorrection({
      source, target: { sourceRevision: { documentId: source.documentId, revisionOrdinal: 0, revisionDigest: source.revisionDigest }, target: { kind: "voice-event", eventId: "le:0:0" } },
      patch: { kind: "replace-event", event: { kind: "rest", onset: fraction(0), duration: fraction(4) } }, correctionSource: "manual", appliedAt: "2026-01-01T00:00:00.000Z", reviewItemId: "review:0",
    });
    expect(result.source.sourceMeasures[0].leadEvents[0]).toEqual({ kind: "rest", id: "le:0:0", sourceMeasureId: "sm:0", onset: fraction(0), duration: fraction(4) });
  });

  it("applies typed musical corrections and explicitly defers structural barline split/merge", async () => {
    const source = await sourceFixture();
    const at = "2026-01-01T00:00:00.000Z";
    const revision = { documentId: source.documentId, revisionOrdinal: source.revisionOrdinal, revisionDigest: source.revisionDigest };
    const voice = (patch: Parameters<typeof applyOmrCorrection>[0]["patch"]) => applyOmrCorrection({ source, target: { sourceRevision: revision, target: { kind: "voice-event", eventId: "le:0:0" } }, patch, correctionSource: "manual", appliedAt: at });

    expect((await voice({ kind: "pitch", pitch: { step: "D", alter: -1, octave: 5 } })).source.sourceMeasures[0].leadEvents[0]).toMatchObject({ pitch: { step: "D", alter: -1, octave: 5 } });
    expect((await voice({ kind: "accidental", alter: 1 })).source.sourceMeasures[0].leadEvents[0]).toMatchObject({ pitch: { alter: 1 } });
    const tiePending = { ...source, sourceMeasures: [{ ...source.sourceMeasures[0], leadEvents: [
      { kind: "note" as const, id: "le:0:0", sourceMeasureId: "sm:0", onset: fraction(0), duration: fraction(2), pitch: { step: "C" as const, alter: 0 as const, octave: 4 }, tieStart: false, tieStop: false, lyricTokenIds: [] },
      { kind: "note" as const, id: "le:0:1", sourceMeasureId: "sm:0", onset: fraction(2), duration: fraction(2), pitch: { step: "C" as const, alter: 0 as const, octave: 4 }, tieStart: false, tieStop: true, lyricTokenIds: [] },
    ] }] };
    const tieSource = { ...tiePending, revisionDigest: await digestMusicalSource(tiePending) };
    const tied = await applyOmrCorrection({ source: tieSource, target: { sourceRevision: { documentId: tieSource.documentId, revisionOrdinal: 0, revisionDigest: tieSource.revisionDigest }, target: { kind: "voice-event", eventId: "le:0:0" } }, patch: { kind: "tie", tieStart: true, tieStop: false }, correctionSource: "manual", appliedAt: at });
    expect(tied.source.sourceMeasures[0].leadEvents[0]).toMatchObject({ tieStart: true, tieStop: false });
    await expect(voice({ kind: "tie", tieStart: true, tieStop: false })).rejects.toThrow("OMR_TIE_INVALID");

    const chord = await applyOmrCorrection({ source, target: { sourceRevision: revision, target: { kind: "chord-event", chordEventId: "ch:0:0" } }, patch: { kind: "chord", parseResult: parseChord("Dm7") as Extract<ReturnType<typeof parseChord>, { status: "ok" | "no-chord" }> }, correctionSource: "manual", appliedAt: at });
    expect(chord.source.sourceMeasures[0].chordEvents[0]).toMatchObject({ sourceText: "Dm7", source: "manual", confirmation: "confirmed" });

    const time = { numerator: 3, denominator: 4, beatGroups: [1, 1, 1] } as const;
    const meter = await applyOmrCorrection({ source, target: { sourceRevision: revision, target: { kind: "measure-start", sourceMeasureId: "sm:0" } }, patch: { kind: "time-signature", value: time }, correctionSource: "manual", appliedAt: at });
    expect(meter.source.sourceMeasures[0].time).toEqual(time);
    expect(meter.source.performanceSequence.occurrences[0].time).toEqual(time);
    const key = await applyOmrCorrection({ source, target: { sourceRevision: revision, target: { kind: "measure-start", sourceMeasureId: "sm:0" } }, patch: { kind: "key-signature", value: { tonic: { step: "E", alter: -1 }, mode: "minor" } }, correctionSource: "manual", appliedAt: at });
    expect(key.source.sourceMeasures[0].key).toEqual({ tonic: { step: "E", alter: -1 }, mode: "minor" });

    const text = await applyOmrCorrection({ source, target: { sourceRevision: revision, target: { kind: "section-text", sourceTextId: "tx:0:0/1:section-label:0" } }, patch: { kind: "replace-source-text", text: "Chorus" }, correctionSource: "manual", appliedAt: at });
    expect(text.source.sourceMeasures[0].textEvents[0].text).toBe("Chorus");

    await expect(applyOmrCorrection({ source, target: { sourceRevision: revision, target: { kind: "measure-end", sourceMeasureId: "sm:0" } }, patch: { kind: "delete-barline" }, correctionSource: "manual", appliedAt: at })).rejects.toThrow("OMR_CORRECTION_TARGET_INCOMPATIBLE");
    const implicitPending = { ...source, sourceMeasures: [{ ...source.sourceMeasures[0], implicit: true }] };
    const implicitSource = { ...implicitPending, revisionDigest: await digestMusicalSource(implicitPending) };
    await expect(applyOmrCorrection({ source: implicitSource, target: { sourceRevision: { documentId: implicitSource.documentId, revisionOrdinal: 0, revisionDigest: implicitSource.revisionDigest }, target: { kind: "measure-end", sourceMeasureId: "sm:0" } }, patch: { kind: "insert-barline" }, correctionSource: "manual", appliedAt: at })).rejects.toThrow("OMR_CORRECTION_TARGET_INCOMPATIBLE");
    expect(implicitSource.sourceMeasures[0].implicit).toBe(true);

    const rest = await applyOmrCorrection({ source, target: { sourceRevision: revision, target: { kind: "voice-event", eventId: "le:0:0" } }, patch: { kind: "replace-event", event: { kind: "rest", onset: fraction(0), duration: fraction(4) } }, correctionSource: "manual", appliedAt: at });
    const restored = await applyOmrCorrection({ source: rest.source, target: { sourceRevision: { documentId: rest.source.documentId, revisionOrdinal: rest.source.revisionOrdinal, revisionDigest: rest.source.revisionDigest }, target: { kind: "voice-event", eventId: "le:0:0" } }, patch: { kind: "replace-event", event: { kind: "note", onset: fraction(0), duration: fraction(4), pitch: { step: "F", alter: 0, octave: 4 }, tieStart: false, tieStop: false } }, correctionSource: "manual", appliedAt: at });
    expect(restored.source.sourceMeasures[0].leadEvents[0]).toMatchObject({ kind: "note", id: "le:0:0", pitch: { step: "F", alter: 0, octave: 4 } });
  });

  it("creates deterministic review-required repair proposals without mutating Source", async () => {
    const source = await sourceFixture();
    const first = await proposeOmrAutoRepairs(source);
    const second = await proposeOmrAutoRepairs(source);
    expect(first).toEqual(second);
    expect(first[0]).toMatchObject({ reason: "MEASURE_DURATION", confidence: "medium", resolution: { status: "pending" }, patch: { kind: "duration", duration: fraction(4) } });
    expect(source.sourceMeasures[0].leadEvents[0]).toMatchObject({ duration: fraction(3) });
  });

  it("creates stable alternatives and preserves accepted, rejected, manual, and auto-repair linkage", async () => {
    const source = await sourceFixture();
    const target = { sourceRevision: { documentId: source.documentId, revisionOrdinal: source.revisionOrdinal, revisionDigest: source.revisionDigest }, target: { kind: "voice-event" as const, eventId: "le:0:0" } };
    const item = await createOmrReviewItem({ target, reasonCode: "OMR_MEASURE_DURATION_INVALID", alternatives: [{ labelKo: "4박", patch: { kind: "duration", duration: fraction(4) } }], evidenceIds: ["e:0"] });
    expect(await createOmrReviewItem({ target, reasonCode: "OMR_MEASURE_DURATION_INVALID", alternatives: [{ labelKo: "다른 UI 문구", patch: { kind: "duration", duration: fraction(4) } }], evidenceIds: ["e:0"] })).toMatchObject({ id: item.id, alternatives: [{ id: item.alternatives[0].id }] });
    const accepted = await acceptOmrReviewAlternative({ source, item, alternativeId: item.alternatives[0].id, appliedAt: "2026-01-01T00:00:00.000Z" });
    expect(accepted.item.resolution).toEqual({ status: "accepted", selectedAlternativeId: item.alternatives[0].id, correctionRecordId: accepted.correction.id });
    expect(accepted.correction).toMatchObject({ source: "review-alternative", reviewItemId: item.id });
    expect(rejectOmrReviewAlternatives(item, [item.alternatives[0].id]).resolution).toEqual({ status: "rejected", rejectedAlternativeIds: [item.alternatives[0].id] });
    const manual = await manuallyCorrectOmrReviewItem({ source, item, patch: { kind: "duration", duration: fraction(2) }, appliedAt: "2026-01-01T00:00:00.000Z" });
    expect(manual.item.resolution).toMatchObject({ status: "manually-corrected", correctionRecordId: manual.correction.id });
    const proposal = (await proposeOmrAutoRepairs(source))[0];
    const rejectedRepair = await resolveOmrAutoRepair({ source, proposal, resolution: "rejected", appliedAt: "2026-01-01T00:00:00.000Z" });
    expect(rejectedRepair.proposal.resolution).toEqual({ status: "rejected" });
    const acceptedRepair = await resolveOmrAutoRepair({ source, proposal, resolution: "accepted", appliedAt: "2026-01-01T00:00:00.000Z" });
    expect(acceptedRepair.correction).toMatchObject({ source: "auto-accepted", autoRepairProposalId: proposal.id });
  });

  it("keeps mixed-target, rejected, and unseen review items independently unresolved until each has authority", async () => {
    const original = await sourceFixture();
    const sourceRevision = { documentId: original.documentId, revisionOrdinal: original.revisionOrdinal, revisionDigest: original.revisionDigest };
    const voice = await createOmrReviewItem({ target: { sourceRevision, target: { kind: "voice-event", eventId: "le:0:0" } }, reasonCode: "OMR_REVIEW_REQUIRED", alternatives: [{ labelKo: "인식 pitch", patch: { kind: "pitch", pitch: { step: "C", alter: 0, octave: 4 } } }], evidenceIds: ["e:voice"] });
    const chord = await createOmrReviewItem({ target: { sourceRevision, target: { kind: "chord-event", chordEventId: "ch:0:0" } }, reasonCode: "OMR_REVIEW_REQUIRED", alternatives: [{ labelKo: "인식 chord", patch: { kind: "chord", parseResult: parseChord("C") as Extract<ReturnType<typeof parseChord>, { status: "ok" | "no-chord" }> } }], evidenceIds: ["e:chord"] });
    const section = await createOmrReviewItem({ target: { sourceRevision, target: { kind: "section-text", sourceTextId: "tx:0:0/1:section-label:0" } }, reasonCode: "OMR_REVIEW_REQUIRED", alternatives: [{ labelKo: "인식 section", patch: { kind: "replace-source-text", text: "Verse" } }], evidenceIds: ["e:section"] });
    const rejectedVoice = rejectOmrReviewAlternatives(voice, [voice.alternatives[0].id]);
    const initial: OmrReviewRecord = { vendorId: "hm-reference", vendorResultDigest: "1".repeat(64) as OmrReviewRecord["vendorResultDigest"], autoRepairs: [], corrections: [], reviewItems: [rejectedVoice, chord, section] };
    expect(validateOmrReviewCompletion(initial)).toHaveLength(3);

    const voiceManual = await manuallyCorrectOmrReviewItem({ source: original, item: rejectedVoice, patch: { kind: "pitch", pitch: { step: "D", alter: 0, octave: 4 } }, appliedAt: "2026-01-01T00:00:00.000Z" });
    const chordAccepted = await acceptOmrReviewAlternative({ source: voiceManual.source, item: chord, alternativeId: chord.alternatives[0].id, appliedAt: "2026-01-01T00:00:01.000Z", remaps: [voiceManual.idRemap] });
    const partial: OmrReviewRecord = { ...initial, corrections: [voiceManual.correction, chordAccepted.correction], reviewItems: [voiceManual.item, chordAccepted.item, section] };
    expect(validateOmrReviewRecord(partial)).toEqual([]);
    expect(validateOmrReviewCompletion(partial)).toEqual([expect.stringContaining(section.id)]);

    const sectionManual = await manuallyCorrectOmrReviewItem({ source: chordAccepted.source, item: section, patch: { kind: "replace-source-text", text: "Chorus" }, appliedAt: "2026-01-01T00:00:02.000Z", remaps: [voiceManual.idRemap, chordAccepted.idRemap] });
    const complete: OmrReviewRecord = { ...partial, corrections: [...partial.corrections, sectionManual.correction], reviewItems: [voiceManual.item, chordAccepted.item, sectionManual.item] };
    expect(validateOmrReviewRecord(complete)).toEqual([]);
    expect(validateOmrReviewCompletion(complete)).toEqual([]);
    expect(complete.corrections.map((correction) => correction.target.sourceRevision.revisionOrdinal)).toEqual([0, 1, 2]);
    expect(complete.corrections.map((correction) => correction.reviewItemTarget?.sourceRevision.revisionOrdinal)).toEqual([0, 0, 0]);
    expect(await validateOmrCorrectionHistory(sectionManual.source, complete)).toEqual([]);
    const reloadedSource = JSON.parse(JSON.stringify(sectionManual.source)) as SongSourceDocument;
    const reloadedRecord = JSON.parse(JSON.stringify(complete)) as OmrReviewRecord;
    expect(validateOmrReviewRecord(reloadedRecord)).toEqual([]);
    expect(await validateOmrCorrectionHistory(reloadedSource, reloadedRecord)).toEqual([]);
    const tampered = { ...reloadedRecord, corrections: reloadedRecord.corrections.map((correction, index) => index === 1 ? { ...correction, beforeProjection: "{}" } : correction) };
    expect(await validateOmrCorrectionHistory(reloadedSource, tampered)).toContain(`${"OMR_REVIEW_RESOLUTION_INVALID"}:${reloadedRecord.corrections[1].id}:before-projection`);
    expect(sectionManual.source.sourceMeasures[0]).toMatchObject({ leadEvents: [expect.objectContaining({ pitch: { step: "D", alter: 0, octave: 4 } })], textEvents: [expect.objectContaining({ text: "Chorus" })] });
  });
});
