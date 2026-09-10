import { beforeEach, describe, expect, it } from "vitest";
import { indexedDB } from "fake-indexeddb";
import { fraction as f } from "../../domain/fraction";
import { createImportRecovery } from "./recovery";
import { applyStructuralEdit, attestStructuralMeasure, createStructuralRecovery, inspectStructuralNote, redoStructuralEdit, replayStructuralRecovery, structuralCandidateXml, structuralDigest, undoStructuralEdit, validateStructuralRecovery, verifiedStructuralCandidate, type StructuralEdit, type StructuralRecovery } from "./structural-recovery";
import { loadStructuralRecoveries, saveStructuralRecovery } from "./structural-recovery-store";
import { recoveryXmlRoot } from "./recovery";
import { xmlChildren as children, xmlChild as child } from "../musicxml/xml";
import { importStructuralBundle } from "./structural-recovery-bundle";
import { binaryDigest } from "../../domain/digest/canonical";

const stamp = "2026-01-02T03:04:05Z";
const note = (step: string, duration: number, voice = "1") => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><voice>${voice}</voice><type>quarter</type></note>`;
const score = (notes: string, divisions = 4, context = true) => `<score-partwise><part-list><score-part id="P1"><part-name>Lead</part-name></score-part></part-list><part id="P1"><measure number="a"><attributes><divisions>${divisions}</divisions><clef><sign>G</sign><line>2</line></clef>${context ? "<key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>" : ""}</attributes>${notes}</measure></part></score-partwise>`;
const pitchless = { kind: "rhythm" as const, type: "quarter" as const, dots: 0 as const, tieStart: false, tieStop: false };
async function seed(xmls = [score(note("C", 4) + note("D", 4))]): Promise<StructuralRecovery> {
  return createStructuralRecovery("workspace", await Promise.all(xmls.map(async (s, i) => ({ id: `d${i}`, recovery: await createImportRecovery(new TextEncoder().encode(s), `fragment${i}.musicxml`), failureReason: "incomplete" }))));
}
async function apply(v: StructuralRecovery, edit: StructuralEdit) {
  return applyStructuralEdit(v, await structuralDigest(await replayStructuralRecovery(v)), edit, "Original page 1 system 2, confirmed boundary and event", `op${v.operations.length}`, stamp);
}
const context = (measureId: string, extent = 4, label = "1"): StructuralEdit => ({ kind: "context", measureId, numerator: 4, denominator: 4, fifths: 0, extent: f(extent), implicit: extent !== 4, label });

describe("explicit structural recovery", () => {
  it("keeps event identity through inserts, splits, moves and reload; refuses stale views", async () => {
    let v = await seed(); const oldDigest = await structuralDigest(await replayStructuralRecovery(v));
    v = await apply(v, { kind: "note", measureId: "d0:m0", onset: f(0), voice: "2", value: pitchless });
    const inserted = (await replayStructuralRecovery(v)).measures[0].notes[2].id;
    v = await apply(v, { kind: "split", measureId: "d0:m0", rightEventIds: ["d0:m0:n1"], rebase: f(1), rightLabel: "2" });
    let s = await replayStructuralRecovery(v); const right = s.measures[1].id;
    expect(s.measures[0].notes.map((n) => n.id)).toEqual(["d0:m0:n0", inserted]);
    expect(s.measures[1].notes[0].id).toBe("d0:m0:n1");
    await expect(applyStructuralEdit(v, oldDigest, { kind: "remove", measureId: "d0:m0", eventId: "d0:m0:n0" }, "source", "stale", stamp)).rejects.toThrow("STALE");
    await expect(apply(v, { kind: "remove", measureId: "d0:m0", eventId: "d0:m0:n1" })).rejects.toThrow("STABLE_TARGET");
    v = await apply(v, { kind: "move", measureId: right, eventId: "d0:m0:n1", destinationId: "d0:m0", onset: f(1), voice: "1" });
    s = await replayStructuralRecovery(JSON.parse(JSON.stringify(v)));
    expect(s.measures[0].notes.find((n) => n.id === "d0:m0:n1")?.onset).toEqual(f(1));
    expect(await replayStructuralRecovery(await redoStructuralEdit(undoStructuralEdit(v)))).toEqual(s);
    expect(v.operations[1].affectedIds).toEqual(["d0:m0", right]);
    expect(v.documents[0].recovery.originalXml).toContain(note("D", 4));
  });
  it("preserves separate rhythm and pitched voices, using positive backup duration and no synthesized pitch", async () => {
    let v = await seed([score(note("G", 16))]);
    v = await apply(v, { kind: "note", measureId: "d0:m0", value: { ...pitchless, type: "whole" }, onset: f(0), voice: "2" });
    const s = await replayStructuralRecovery(v), xml = structuralCandidateXml(s);
    const m = children(children(recoveryXmlRoot(xml), "part")[0], "measure")[0], ns = children(m, "note");
    expect(ns).toHaveLength(2); expect(child(ns[0], "pitch")).toBeDefined();
    expect(child(ns[1], "unpitched")).toBeDefined(); expect(child(ns[1], "pitch")).toBeUndefined(); expect(child(ns[1], "rest")).toBeUndefined();
    expect(xml).toContain("<backup><duration>256</duration></backup>");
    expect(inspectStructuralNote(s.measures[0], s.measures[0].notes[1]).kind).toBe("rhythm");
    const fake = { ...pitchless, pitch: { step: "C" as const, octave: 4, alter: 0 as const } };
    await expect(apply(v, { kind: "note", measureId: "d0:m0", onset: f(0), voice: "2", value: fake })).rejects.toThrow();
  });
  it("joins parsed timelines only after part, voice and context checks, converts divisions and retains both originals", async () => {
    let v = await seed([score(note("C", 16)), score(note("D", 32), 8, false)]);
    const join: StructuralEdit = { kind: "join", leftDocumentId: "d0", rightDocumentId: "d1", partRole: "same melody staff", voiceMap: { "1": "1" } };
    await expect(apply(v, join)).rejects.toThrow("CONTEXT_UNRESOLVED");
    v = await apply(v, context("d1:m0"));
    await expect(apply(v, { ...join, voiceMap: {} })).rejects.toThrow("VOICE_MAPPING");
    await expect(apply(v, { ...join, leftDocumentId: "d1", rightDocumentId: "d0" })).rejects.toThrow("ORDER");
    v = await apply(v, join); const s = await replayStructuralRecovery(v);
    expect(inspectStructuralNote(s.measures[1], s.measures[1].notes[0]).duration).toBe("4");
    expect(s.joins).toEqual(["d0>d1"]); expect(v.documents).toHaveLength(2);
    await expect(apply(v, join)).rejects.toThrow("DUPLICATE_JOIN");
  });
  it("requires complete revision-bound source coverage, and invalidates all confirmations after every edit", async () => {
    let v = await seed([score(note("C", 16))]);
    v = await apply(v, context("d0:m0"));
    v = await apply(v, { kind: "inventory", systems: [{ page: 1, system: 1, labels: ["pickup-label"] }] });
    expect((await validateStructuralRecovery(v)).overfull).toBe(0);
    await expect(verifiedStructuralCandidate(v)).rejects.toThrow("STRUCTURE_UNRESOLVED");
    const coverage = { measureId: "d0:m0", page: 1, system: 1, printedLabel: "pickup-label", voiceCounts: { "1": 1 }, chordCount: 0, sourceLocation: "Original, all events and harmony checked", revisionDigest: await structuralDigest(await replayStructuralRecovery(v)) };
    v = await attestStructuralMeasure(v, coverage);
    expect((await validateStructuralRecovery(v)).issues).toEqual([]); expect((await verifiedStructuralCandidate(v)).proof).toContain("originalDigests");
    v = await apply(v, { kind: "chord", measureId: "d0:m0", symbol: "Dm7", onset: f(0) });
    expect(v.coverage).toEqual([]);
    await expect(attestStructuralMeasure(v, coverage)).rejects.toThrow("COVERAGE");
    v = await apply(v, { kind: "split", measureId: "d0:m0", rightEventIds: [], rebase: f(4), rightLabel: "missing original bar" });
    expect((await validateStructuralRecovery(v)).issues.some((i) => i.includes("이벤트 없음"))).toBe(true);
  });
  it("does not infer ambiguous curves or clear incomplete guards from zero overfull", async () => {
    let v = await seed([score(note("C", 16))]); v = await apply(v, context("d0:m0"));
    v = await apply(v, { kind: "uncertainty", measureId: "d0:m0", detail: "curve leads from pitched voice to pitchless notation; meaning unconfirmed" });
    const check = await validateStructuralRecovery(v);
    expect(check.overfull).toBe(0); expect(check.issues.some((i) => i.includes("원본 의미 미확정"))).toBe(true);
    await expect(verifiedStructuralCandidate(v)).rejects.toThrow();
  });
  it("requires an explicit evidenced resolution and still requires full review again", async () => {
    let v = await seed([score(note("C", 16))]);
    await expect(apply(v, { kind: "resolve-uncertainty", measureId: "d0:m0", detail: "No pending question" })).rejects.toThrow("UNCERTAINTY_MISSING");
    v = await apply(v, { kind: "uncertainty", measureId: "d0:m0", detail: "Unclear annotation" });
    v = await apply(v, { kind: "resolve-uncertainty", measureId: "d0:m0", detail: "Original writer confirmed an editorial mark without playback meaning; image retained" });
    expect(v.operations[0].edit).toMatchObject({ kind: "uncertainty", detail: "Unclear annotation" });
    const state = await replayStructuralRecovery(JSON.parse(JSON.stringify(v)));
    expect(state.uncertainties).toEqual({}); expect(state.resolvedUncertainties?.["d0:m0"]).toContain("Original writer");
    expect(v.coverage).toEqual([]); await expect(verifiedStructuralCandidate(v)).rejects.toThrow("UNRESOLVED");
    expect((await replayStructuralRecovery(undoStructuralEdit(v))).uncertainties["d0:m0"]).toBe("Unclear annotation");
  });
  it("detects forged histories and cached object mutation, and preserves cancelled operations for redo", async () => {
    let v = await seed(); v = await apply(v, { kind: "remove", measureId: "d0:m0", eventId: "d0:m0:n1" });
    const tampered = JSON.parse(JSON.stringify(v)); tampered.operations[0].after = "[]";
    await expect(replayStructuralRecovery(tampered)).rejects.toThrow("HISTORY");
    const cached = JSON.parse(JSON.stringify(v)); await replayStructuralRecovery(cached); cached.documents[0].recovery.originalXml += "x";
    await expect(replayStructuralRecovery(cached)).rejects.toThrow();
    const undone = undoStructuralEdit(v); expect(undone.redo).toHaveLength(1);
    const corruptedRedo = JSON.parse(JSON.stringify(undone)); corruptedRedo.redo[0].afterDigest = "forged";
    await expect(redoStructuralEdit(corruptedRedo)).rejects.toThrow("HISTORY");
    expect((await replayStructuralRecovery(undone)).measures[0].notes).toHaveLength(2);
  });
  it("rejects unrepresentable rhythmic grids and multipart flattening before editing", async () => {
    await expect(seed([score(note("C", 1), 3)])).rejects.toThrow("GRID");
    await expect(seed([score(note("C", 4)).replace("</score-partwise>", '<part id="P2"><measure number="1"/></part></score-partwise>')])).rejects.toThrow("PART_MAPPING");
    await expect(seed([score(note("C", 4) + "<attributes><divisions>8</divisions></attributes>" + note("D", 4))])).rejects.toThrow("MID_MEASURE");
  });
  it("preserves original title and chord identity when relocating harmony, and validates cross-fragment slurs", async () => {
    const start = note("C", 16).replace('</note>', '<notations><slur number="1" type="start"/></notations></note>');
    const stop = note("D", 16).replace('</note>', '<notations><slur number="1" type="stop"/></notations></note>');
    const first = score(start).replace('<part-list>', '<work><work-title>Original title</work-title></work><part-list>');
    let v = await seed([first, score(stop)]);
    v = await apply(v, { kind: "chord", measureId: "d0:m0", symbol: "F", onset: f(0) });
    const chordId = (await replayStructuralRecovery(v)).measures[0].chords[0].id;
    v = await apply(v, { kind: "move", measureId: "d0:m0", eventId: chordId, destinationId: "d1:m0", onset: f(1), voice: "unused" });
    let state = await replayStructuralRecovery(v);
    expect(state.measures[0].chords).toHaveLength(0); expect(state.measures[1].chords[0]).toMatchObject({ id: chordId, onset: f(1) });
    v = await apply(v, { kind: "join", leftDocumentId: "d0", rightDocumentId: "d1", partRole: "same original staff", voiceMap: { "1": "1" } });
    expect((await validateStructuralRecovery(v)).issues.some((issue) => issue.includes("프레이즈선"))).toBe(false);
    v = await apply(v, { kind: "note", measureId: "d1:m0", eventId: "d1:m0:n0", value: { ...pitchless, kind: "note", pitch: { step: "D", octave: 4, alter: 0 }, type: "whole" }, onset: f(0), voice: "1", removeNotations: ["slur"] });
    expect((await validateStructuralRecovery(v)).issues.some((issue) => issue.includes("프레이즈선 미연결"))).toBe(true);
    state = await replayStructuralRecovery(v);
    expect(structuralCandidateXml(state, v.documents[0].recovery.originalXml)).toContain('<work-title>Original title</work-title>');
    expect((await replayStructuralRecovery(await redoStructuralEdit(undoStructuralEdit(v))))).toEqual(state);
  });
});
describe("structural recovery durable revisions", () => {
  beforeEach(() => { Object.assign(globalThis, { indexedDB }); });
  it("saves undo/redo across reload, rejects concurrent writes and retains the original failed documents", async () => {
    const workspace = await seed(); const initial = { id: workspace.id, workspace, pages: [], storageRevision: 0, updatedAt: stamp };
    await saveStructuralRecovery(initial);
    const edited = await apply(workspace, { kind: "note", measureId: "d0:m0", onset: f(2), voice: "1", value: pitchless });
    await saveStructuralRecovery({ ...initial, workspace: edited, storageRevision: 1 }, 0);
    await expect(saveStructuralRecovery({ ...initial, workspace: edited, storageRevision: 1 }, 0)).rejects.toThrow("CONCURRENT");
    const restored = (await loadStructuralRecoveries()).find((r) => r.id === workspace.id)!;
    expect(await replayStructuralRecovery(restored.workspace)).toEqual(await replayStructuralRecovery(edited));
    expect(restored.workspace.documents[0].failureReason).toBe("incomplete");
  });
  it("reopens only verified originals and operations, ignores injected candidate XML, and binds original pages", async () => {
    const workspace = await seed(), bytes = new Uint8Array([137, 80, 78, 71]);
    const digest = await binaryDigest(bytes);
    const value = { version: "hm-structural-recovery-bundle-v1", workspace, pages: [{ pageIndex: 0, mimeType: "image/png", rawDigest: digest, canonicalPageDigest: digest, dataUrl: "data:image/png;base64,iVBORw==" }], candidate: { xml: score(note("A", 16)), status: "complete" } };
    const file = (v: unknown) => new File([JSON.stringify(v)], "recovery.json", { type: "application/json" });
    const reopened = await importStructuralBundle(file(value));
    expect(reopened.id).not.toBe(workspace.id); expect(reopened.workspace.coverage).toEqual([]);
    expect((await replayStructuralRecovery(reopened.workspace)).measures[0].notes).toHaveLength(2);
    expect(reopened.workspace.documents[0].failureReason).toBe("incomplete");
    expect(structuralCandidateXml(await replayStructuralRecovery(reopened.workspace))).not.toContain("<step>A</step>");
    await expect(importStructuralBundle(file({ ...value, pages: [] }))).rejects.toThrow("BUNDLE_INVALID");
    await expect(importStructuralBundle(file({ ...value, pages: [{ ...value.pages[0], rawDigest: "0".repeat(64) }] }))).rejects.toThrow("PAGE_BINDING");
    const forged = structuredClone(value); Object.assign(forged.workspace.documents[0].recovery, { originalXml: score(note("A", 16)) });
    await expect(importStructuralBundle(file(forged))).rejects.toThrow();
  });
});
