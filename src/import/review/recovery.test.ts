import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { fraction } from "../../domain/fraction";
import { importMusicXml } from "../musicxml/parser";
import { applyRecoveryEdit, createImportRecovery, inspectRecoveryXml, replayImportRecovery, undoRecoveryEdit } from "./recovery";
import { loadImportRecoveries, retainImportRecovery, saveImportRecovery } from "./recovery-store";

const xml = '<score-partwise><part-list><score-part id="P"><part-name>Lead</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>D</step><octave>4</octave></pitch><duration>6</duration><type>quarter</type><dot/></note><note><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration><type>half</type><dot/></note></measure></part></score-partwise>';
const versions = { performanceExpanderVersion: "repeat-v1", chordTimelineResolverVersion: "chord-timeline-v1", sourceLeadAtomizerVersion: "source-lead-atomizer-v1" } as const;
const reference = "Original page 1, system 1, measure 1";
const appliedAt = "2026-09-09T15:00:00.000Z";
describe("quarantined import corrections", () => {
  it("keeps raw bytes and the validator while explicitly repairing an overfull measure", async () => {
    const initial = await createImportRecovery(new TextEncoder().encode(xml), "original.musicxml");
    const before = await importMusicXml(new TextEncoder().encode(xml), { algorithmVersions: versions });
    expect(before.status).toBe("blocked");
    let edited = await applyRecoveryEdit(initial, { kind: "note", part: 0, measure: 0, event: 0, value: { kind: "note", pitch: { step: "F", alter: 0, octave: 4 }, type: "16th", dots: 0, tieStart: false, tieStop: false } }, reference, appliedAt);
    edited = await applyRecoveryEdit(edited, { kind: "note", part: 0, measure: 0, event: 1, value: { kind: "note", pitch: { step: "D", alter: 0, octave: 4 }, type: "eighth", dots: 1, tieStart: false, tieStop: false } }, reference, appliedAt);
    const corrected = await replayImportRecovery(edited);
    expect(initial.operations).toHaveLength(0);
    expect(edited.originalXml).toBe(xml);
    expect(inspectRecoveryXml(corrected)[0].notes.map((note) => [note.onset, note.duration])).toEqual([["0", "0.25"], ["0.25", "0.75"], ["1", "3"]]);
    expect((await importMusicXml(new TextEncoder().encode(corrected), { algorithmVersions: versions })).status).toBe("review-required");
    expect(JSON.parse(edited.operations[0].before).duration).toBe("1");
    expect(JSON.parse(edited.operations[0].after).duration).toBe("0.25");
    expect(await replayImportRecovery(undoRecoveryEdit(undoRecoveryEdit(edited)))).toBe(xml);
    await expect(replayImportRecovery({ ...edited, originalXml: xml.replace("<step>F", "<step>G") })).rejects.toThrow("RECOVERY_HISTORY_INVALID");
    await expect(replayImportRecovery({ ...edited, operations: [{ ...edited.operations[0], after: "forged" }] })).rejects.toThrow("RECOVERY_HISTORY_INVALID");
  });
  it("adds rhythm-only notation with no hidden pitch and retains edits over IndexedDB reload", async () => {
    Object.defineProperty(globalThis, "indexedDB", { value: new IDBFactory(), configurable: true });
    const initial = await createImportRecovery(new TextEncoder().encode(xml), "rhythm.musicxml");
    const edited = await applyRecoveryEdit(initial, { kind: "note", part: 0, measure: 0, event: 0, value: { kind: "rhythm", type: "16th", dots: 0, tieStart: false, tieStop: false } }, reference, appliedAt);
    const entry = { id: "recovery-test", updatedAt: appliedAt, pages: [], recovery: edited };
    await saveImportRecovery(entry);
    const loaded = (await loadImportRecoveries())[0];
    expect(loaded.recovery).toEqual(edited);
    const first = inspectRecoveryXml(await replayImportRecovery(loaded.recovery))[0].notes[0];
    expect(first.kind).toBe("rhythm");
    expect(first).not.toHaveProperty("pitch");
    await expect(applyRecoveryEdit(initial, { kind: "note", part: 0, measure: 0, event: 0, value: { kind: "rhythm", pitch: { step: "C", alter: 0, octave: 4 }, type: "quarter", dots: 0, tieStart: false, tieStop: false } }, reference, appliedAt)).rejects.toThrow("RECOVERY_NOTE_INVALID");
  });
  it("requires a source reference and never rounds a duration that divisions cannot represent", async () => {
    const initial = await createImportRecovery(new TextEncoder().encode(xml.replace("<divisions>4", "<divisions>1")), "one.musicxml");
    const edit = { kind: "note", part: 0, measure: 0, event: 0, value: { kind: "rhythm", type: "16th", dots: 0, tieStart: false, tieStop: false } } as const;
    await expect(applyRecoveryEdit(initial, edit, "", appliedAt)).rejects.toThrow("RECOVERY_REFERENCE_REQUIRED");
    await expect(applyRecoveryEdit(initial, edit, reference, appliedAt)).rejects.toThrow("RECOVERY_DURATION_UNREPRESENTABLE");
  });
  it("corrects a meter and inserts an explicit chord at its specified onset", async () => {
    let edited = await createImportRecovery(new TextEncoder().encode(xml), "chord.musicxml");
    edited = await applyRecoveryEdit(edited, { kind: "meter", part: 0, measure: 0, numerator: 6, denominator: 8 }, reference, appliedAt);
    edited = await applyRecoveryEdit(edited, { kind: "chord", part: 0, measure: 0, event: 0, symbol: "Dm7/A", onset: fraction(3, 2) }, reference, appliedAt);
    const measure = inspectRecoveryXml(await replayImportRecovery(edited))[0];
    expect(measure.meter).toEqual({ numerator: 6, denominator: 8 });
    expect(measure.chords).toEqual([{ event: 0, text: "Dm7/A", onset: "1.5" }]);
    expect(measure.notes).toEqual(inspectRecoveryXml(xml)[0].notes);
  });
  it("does not turn malformed or unsafe XML into an editable score", async () => {
    await expect(createImportRecovery(new TextEncoder().encode('<!DOCTYPE x><score-partwise/>'), "bad.xml")).rejects.toThrow();
    await expect(createImportRecovery(new TextEncoder().encode('<score-partwise>'), "bad.xml")).rejects.toThrow();
  });
  it("retains existing corrections when the same rejected server artifact is retrieved again", async () => {
    Object.defineProperty(globalThis, "indexedDB", { value: new IDBFactory(), configurable: true });
    const original = await createImportRecovery(new TextEncoder().encode(xml), "rejected.musicxml");
    const entry = { id: "same-job:fragment-1", updatedAt: appliedAt, pages: [], recovery: original, incompleteReason: "Unresolved movement continuity" };
    await retainImportRecovery(entry);
    const edited = await applyRecoveryEdit(original, { kind: "meter", part: 0, measure: 0, numerator: 6, denominator: 8 }, reference, appliedAt);
    await saveImportRecovery({ ...entry, recovery: edited });
    await retainImportRecovery(entry);
    expect((await loadImportRecoveries())[0].recovery).toEqual(edited);
    const different = await createImportRecovery(new TextEncoder().encode(xml.replace("<step>F", "<step>G")), "different.musicxml");
    await expect(retainImportRecovery({ ...entry, recovery: different })).rejects.toThrow("RECOVERY_ORIGINAL_BINDING_CONFLICT");
    expect((await loadImportRecoveries())[0].recovery).toEqual(edited);
  });
  it("preserves a mid-measure divisions change without applying an unsafe edit", async () => {
    const changing = xml.replace("</note><note>", "</note><attributes><divisions>8</divisions></attributes><note>");
    const original = await createImportRecovery(new TextEncoder().encode(changing), "divisions.musicxml");
    await expect(applyRecoveryEdit(original, { kind: "note", part: 0, measure: 0, event: 0, value: { kind: "rhythm", type: "quarter", dots: 0, tieStart: false, tieStop: false } }, reference, appliedAt)).rejects.toThrow("RECOVERY_DIVISIONS_CHANGE_UNSUPPORTED");
    expect(await replayImportRecovery(original)).toBe(changing);
  });
});
