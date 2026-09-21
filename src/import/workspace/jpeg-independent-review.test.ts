import { describe, expect, it, vi } from "vitest";
import { gunzipSync } from "node:zlib";
import { APPLICATION_ALGORITHM_VERSION_REGISTRY as V } from "../../app/algorithm-version-registry";
import { binaryDigest, canonicalJson, semanticDigest } from "../../domain/digest/canonical";
import { digestMusicalSource } from "../../domain/digest/source";
import { computeSourceProvenanceDigest } from "../../domain/source/provenance";
import { validateSongSourceDocumentIntegrity } from "../../domain/source/validation";
import { deriveQuickReview } from "..";
import { createProjectFromQuickReview } from "../../product/workspace";
import { exportHarmonyProject, importHarmonyProject } from "../../product/project-transfer";
import { originFromMusicXml, workspaceEvidenceDigest } from "./input";
import { applyWorkspaceCommand, createScoreWorkspace, exportScoreWorkspace, parseScoreWorkspace, replayScoreWorkspace } from "./journal";
import { attestationCurrent, deriveWorkspaceCapabilities } from "./review";
import { exactJson } from "./encoding";
import { projectScoreWorkspace } from "./projection";
import { validateWorkspaceSourceIntegrity } from "./source-integrity";
import type { ScoreWorkspace, WorkspaceCommand } from "./model";

// Independently authored synthetic music only. No JPEG, private oracle or old
// correction operation is used in these contract counterexamples.
function xml({ extraVoice = false, importedSlur = false } = {}) {
  const note = (m: number, n: number, voice: number) => {
    const slur = importedSlur && voice === 1 && (m === 1 && n === 0 || m === 3 && n === 1)
      ? `<notations><slur number="1" type="${m === 1 ? "start" : "stop"}"/></notations>` : "";
    return `<note><pitch><step>${voice === 1 ? ["D", "F"][n] : "A"}</step><octave>4</octave></pitch><duration>2</duration><voice>${voice}</voice><type>half</type>${slur}<lyric number="1"><syllabic>single</syllabic><text>syllable-${m}-${n}</text></lyric></note>`;
  };
  return `<score-partwise><work><work-title>Independent notation contract</work-title></work><part-list><score-part id="P1"><part-name>Lead</part-name></score-part></part-list><part id="P1">${Array.from({ length: 5 }, (_, m) => `<measure number="${m + 1}">${m === 0 ? '<attributes><divisions>1</divisions><key><fifths>-1</fifths><mode>minor</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' : ""}<harmony><root><root-step>D</root-step></root><kind>minor</kind></harmony>${note(m, 0, 1)}${note(m, 1, 1)}${extraVoice ? `<backup><duration>4</duration></backup>${note(m, 0, 2)}${note(m, 1, 2)}` : ""}</measure>`).join("")}</part></score-partwise>`;
}
async function start(options: Parameters<typeof xml>[0] = {}) {
  return createScoreWorkspace(await originFromMusicXml(new TextEncoder().encode(xml(options)), "independent-contract.xml"), V, "workspace:independent-notation");
}
async function act(w: ScoreWorkspace, command: WorkspaceCommand) {
  return applyWorkspaceCommand(w, w, command, { id: `independent:${w.revision}`, note: "Independent synthetic contract decision", actor: "ui-test", at: "2026-09-13T04:00:00.000Z" });
}
async function review(w: ScoreWorkspace) {
  let s = await replayScoreWorkspace(w);
  if (!s.request.lead) {
    w = await act(w, { kind: "lead", lead: s.music!.leadCandidates[0].key, rhythmVoices: [] });
    s = await replayScoreWorkspace(w);
  }
  for (const m of s.music!.parts[0].measures) w = await act(w, { kind: "attest", purpose: "music", scope: { kind: "measure", measureId: m.workspaceMeasureId!, voiceKey: s.request.lead! } });
  return w;
}
async function current(w: ScoreWorkspace) {
  return (await deriveWorkspaceCapabilities(await replayScoreWorkspace(w), await workspaceEvidenceDigest(w.origin))).musicReviews.map(m => m.current);
}
async function event(w: ScoreWorkspace, measure: number, index: number, voice = 1) {
  const s = await replayScoreWorkspace(w);
  return s.music!.parts[0].measures[measure].leadEvents.filter(e => e.candidateKey.endsWith(`:${voice}`))[index];
}
async function ready(w: ScoreWorkspace) {
  const pitch = (octave: number) => ({ step: "C" as const, alter: 0 as const, octave });
  w = await act(w, { kind: "tempo", tempo: { beatUnit: 4, dotted: false, bpm: 96 } });
  w = await act(w, { kind: "performers", count: 1, slots: [{ id: "pf:0", displayName: "Synthetic singer", profile: { id: "pf:0", displayName: "Synthetic singer", hardRange: { low: pitch(3), high: pitch(6) }, comfortableRange: { low: pitch(3), high: pitch(6) } } }] });
  w = await act(w, { kind: "rights", rights: { basis: "self-authored", allowedUses: ["generation"] } });
  const s = await replayScoreWorkspace(w);
  w = await act(w, { kind: "sections", sections: s.request.sections.map(section => ({ ...section, type: "verse", confirmation: "confirmed" })), lyricVerses: {} });
  return review(w);
}
async function explicitSlur(w: ScoreWorkspace, number = 1, voice = 1) {
  w = await act(w, { kind: "event-slurs", eventId: (await event(w, 1, 0, voice)).workspaceEventId!, slurs: [{ number, type: "start" }] });
  return act(w, { kind: "event-slurs", eventId: (await event(w, 3, 1, voice)).workspaceEventId!, slurs: [{ number, type: "stop" }] });
}
function soundingEvents(s: Awaited<ReturnType<typeof replayScoreWorkspace>>) {
  return s.music!.parts.flatMap(p => p.measures.flatMap(m => m.leadEvents.map(e => ({ kind: e.kind, onset: e.onset, duration: e.duration, ...(e.kind !== "rest" ? { tieStart: e.tieStart, tieStop: e.tieStop } : {}), ...(e.kind === "note" ? { pitch: e.pitch } : {}) }))));
}

// Frozen synthetic proof generated by the actual ba5a985 journal/edit/review
// implementations via git show, before notation editor changes. Keeping its
// bytes here prevents a current-code-generated fixture from hiding migration.
const OLD_PROOF_GZIP = "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";
const oldProof = () => gunzipSync(Buffer.from(OLD_PROOF_GZIP, "base64")).toString("utf8");
// A second actual ba5a985 proof: lead -> contained note edit -> legacy attest.
const OLD_EDITED_PROOF_GZIP = "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";

describe("independent JPEG editor boundary review (synthetic)", () => {
  it("reuses only the exact replay's old fingerprints during a v3 transition", async () => {
    // Frozen pre-v3 public fixture, not an answer generated by current code.
    const before=await parseScoreWorkspace(oldProof());
    const source=await replayScoreWorkspace(before),evidence=await workspaceEvidenceDigest(before.origin);
    const schemas:string[]=[];
    const digest=globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    const spy=vi.spyOn(globalThis.crypto.subtle,"digest").mockImplementation((algorithm,bytes)=>{
      const text=new TextDecoder().decode(bytes);
      if(text.startsWith("{")) {try {const value=JSON.parse(text);if(typeof value.schema==="string")schemas.push(value.schema);}catch { /* Non-JSON byte digests keep their original path. */ }}
      return digest(algorithm,bytes);
    });
    let after:ScoreWorkspace;
    try {after=await act(before,{kind:"title",title:"Display-only transition"});}finally {spy.mockRestore();}
    expect(schemas.filter(s=>s==="hm-workspace-review-dependency-v1"||s==="hm-workspace-review-dependency-v2")).toEqual([]);
    expect(schemas).toContain("hm-workspace-review-dependency-v3");
    const state=await replayScoreWorkspace(after!);
    expect(state.attestations[0].actor).toBe(source.attestations[0].actor);
    expect(state.attestations[0].at).toBe(source.attestations[0].at);
    expect(state.attestations[0].retainedReview?.previousFingerprint).toBe(source.attestations[0].dependencyFingerprint);
    expect(await attestationCurrent(state,state.attestations[0],evidence)).toBe(true);
    expect(await current(after!)).toEqual([false,true,false,false,false]);
    // Separate cold replay and subsequent affected edit/Undo/Redo must not
    // inherit a current flag merely because a prior state used the same scope.
    const cold=await parseScoreWorkspace(' '+await exportScoreWorkspace(after!));
    expect(await replayScoreWorkspace(cold)).toEqual(state);
    const changed=await act(cold,{kind:"event-lyrics",eventId:"p0m1n0",lyrics:[{verse:1,text:"changed fact",syllabic:"single",extend:false,musicXmlAccent:false}]});
    expect(await current(changed)).toEqual([false,false,false,false,false]);
    const undone=await act(changed,{kind:"undo"});
    expect(await current(undone)).toEqual([false,true,false,false,false]);
    expect(await current(await act(undone,{kind:"redo"}))).toEqual([false,false,false,false,false]);
    expect(await replayScoreWorkspace(before)).toEqual(source);
  });
  it("invalidates a later legacy attestation when a new undo removes an earlier legacy note edit", async () => {
    const encoded = gunzipSync(Buffer.from(OLD_EDITED_PROOF_GZIP, "base64")).toString("utf8");
    expect(await binaryDigest(new TextEncoder().encode(encoded))).toBe("d9f6c8a69368afc24110a0867a1be0787cca6313b738a5438efe069aabc2a8f0");
    let w = await parseScoreWorkspace(encoded);
    expect(await current(w)).toEqual([false, true, false, false, false]);
    w = await act(w, { kind: "undo" });
    expect(await current(w)).toEqual([false, false, false, false, false]);
    expect(await current(await parseScoreWorkspace(await exportScoreWorkspace(w)))).toEqual([false, false, false, false, false]);
    w = await act(w, { kind: "redo" });
    expect(await current(await parseScoreWorkspace(await exportScoreWorkspace(w)))).toEqual([false, true, false, false, false]);
  });
  it("replays frozen ba5a985 proof byte-for-byte with its original review fingerprint", async () => {
    const encoded = oldProof(), w = await parseScoreWorkspace(encoded);
    expect(await binaryDigest(new TextEncoder().encode(encoded))).toBe("5d9791cd648ec3348a41e0a1f3fa51c4784f9a679fb250237a8b78311cf17172");
    expect(w.digest).toBe("0fa67dc0941259267727394d7c678f4cbe75c6461295e98b0b35ea21190671c9");
    expect(w.historyDigest).toBe("ec60fe1a02c37616435d01f88994e9245fbc54c59ef45c56bf8c76ac578d4677");
    expect(await exportScoreWorkspace(w)).toBe(encoded);
    const state = await replayScoreWorkspace(w);
    expect(state.attestations[0].dependencyFingerprint).toBe("c331958632d8b71cb83120e1b81af4da6f11fa986c9894d3e397e0d7a528c01f");
    expect(state).not.toHaveProperty("slurReviewTracking");
    expect(await current(w)).toEqual([false, true, false, false, false]);
  });

  it("invalidates an affected frozen legacy attestation on a new contained-note edit and restores it on undo", async () => {
    let w = await parseScoreWorkspace(oldProof());
    const n = await event(w, 2, 0);
    w = await act(w, { kind: "note", eventId: n.workspaceEventId!, value: { kind: "note", pitch: { step: "E", alter: 0, octave: 4 }, onset: n.onset, duration: n.duration, tieStart: false, tieStop: false } });
    expect(await current(w)).toEqual([false, false, false, false, false]);
    w = await act(w, { kind: "undo" });
    expect(await current(w)).toEqual([false, true, false, false, false]);
    w = await act(w, { kind: "redo" });
    expect(await current(await parseScoreWorkspace(await exportScoreWorkspace(w)))).toEqual([false, false, false, false, false]);
  });

  it("rejects a substituted migration invalidation list even after the outer history seal is recomputed", async () => {
    let w = await parseScoreWorkspace(oldProof());
    const n = await event(w, 2, 0);
    w = await act(w, { kind: "note", eventId: n.workspaceEventId!, value: { kind: "note", pitch: { step: "E", alter: 0, octave: 4 }, onset: n.onset, duration: n.duration, tieStart: false, tieStop: false } });
    // The existing judgment now has a replay-derived v3 anchor. Its old
    // fingerprint and actor/time remain on retainedReview, not a new approval.
    expect(w.operations.at(-1)!.invalidatedLegacyReviewIds).toEqual([]);
    expect((await replayScoreWorkspace(w)).attestations[0].retainedReview?.previousVersion).toBe(1);
    const operations = w.operations.map(op => ({ ...op }));
    operations.at(-1)!.invalidatedLegacyReviewIds = ["review:independent:1"];
    const historyDigest = await binaryDigest(new TextEncoder().encode(exactJson({ schema: "hm-workspace-history-seal-v1", id: w.id, evidenceDigest: await workspaceEvidenceDigest(w.origin), algorithmVersions: w.algorithmVersions, operations })));
    await expect(parseScoreWorkspace(JSON.stringify({ ...w, operations, historyDigest }))).rejects.toThrow("WORKSPACE_REVIEW_MIGRATION_SUBSTITUTED");
  });

  it("keeps retained legacy and new v3 attestation anchors distinct through Undo, Redo and replay", async () => {
    let w = await parseScoreWorkspace(oldProof());
    const n = await event(w, 2, 0);
    w = await act(w, { kind: "note", eventId: n.workspaceEventId!, value: { kind: "note", pitch: { step: "E", alter: 0, octave: 4 }, onset: n.onset, duration: n.duration, tieStart: false, tieStop: false } });
    const scope = (await replayScoreWorkspace(w)).attestations[0].scope;
    w = await act(w, { kind: "attest", purpose: "music", scope });
    const check = async (workspace: ScoreWorkspace, expected: boolean[]) => {
      const state = await replayScoreWorkspace(workspace), evidence = await workspaceEvidenceDigest(workspace.origin);
      expect(state.attestations.map(a => a.dependencyVersion)).toEqual([3, 3]);
      expect(state.attestations[0].retainedReview?.previousVersion).toBe(1);
      expect(state.attestations[1]).not.toHaveProperty("retainedReview");
      expect(await Promise.all(state.attestations.map(a => attestationCurrent(state, a, evidence)))).toEqual(expected);
    };
    await check(w, [false, true]);
    w = await act(w, { kind: "undo" });
    await check(w, [true, false]);
    await check(await parseScoreWorkspace(await exportScoreWorkspace(w)), [true, false]);
    w = await act(w, { kind: "redo" });
    await check(await parseScoreWorkspace(await exportScoreWorkspace(w)), [false, true]);
  });

  it("does not invalidate a no-op imported slur save when no note or mark changes", async () => {
    let w = await review(await start({ importedSlur: true }));
    const e = await event(w, 1, 0);
    expect(e.kind).toBe("note");
    if (e.kind === "rest") throw new Error("synthetic note expected");
    w = await act(w, { kind: "event-slurs", eventId: e.workspaceEventId!, slurs: e.slurs! });
    expect(await current(w)).toEqual([true, true, true, true, true]);
  });
  it("preserves source semantics measured on ba5a985 and a workspace proof through replay/export", async () => {
    const w = await ready(await start({ importedSlur: true }));
    const before = await exportScoreWorkspace(w);
    const parsed = await parseScoreWorkspace(before);
    expect(await exportScoreWorkspace(parsed)).toBe(before);
    expect(parsed.digest).toBe(w.digest);
    expect(parsed.historyDigest).toBe(w.historyDigest);
    expect(await current(parsed)).toEqual([true, true, true, true, true]);
    expect(await replayScoreWorkspace(parsed)).not.toHaveProperty("slurReviewTracking");
    const source = (await deriveQuickReview(await projectScoreWorkspace(parsed), V)).source!;
    expect(source).toBeDefined();
    // These two digests were measured on the same independent score using the
    // actual ba5a985 implementations, not copied from current test output.
    expect(source.revisionDigest).toBe("99015c1530f420983e4163b198feb27a29f3080d227fbafd19502150bd397e55");
    expect(await semanticDigest(source.sourceMeasures)).toBe("dab796ed93d3f48ebaca647bef050cf2563d653c7d351f7051d3b16681c2b847");
    expect(await validateWorkspaceSourceIntegrity(source)).toBe(true);
  });

  it("explicitly rejects a lyric-body-only substituted project after provenance is recomputed", async () => {
    const w = await ready(await start());
    const draft = await projectScoreWorkspace(w), quick = await deriveQuickReview(draft, V);
    expect(quick.source).toBeDefined();
    const project = await createProjectFromQuickReview(draft, quick);
    const encoded = await exportHarmonyProject(project);
    const changed = structuredClone(project);
    (changed.source.sourceMeasures[2].lyricTokens[0] as { text: string }).text = "not reviewed in proof";
    const resealed = { ...changed, source: { ...changed.source, sourceProvenanceDigest: await computeSourceProvenanceDigest(changed.source) } };
    expect(await digestMusicalSource(resealed.source)).toBe(project.source.revisionDigest);
    expect(await validateWorkspaceSourceIntegrity(resealed.source)).toBe(false);
    expect(await validateSongSourceDocumentIntegrity(resealed.source, V.performanceExpanderVersion)).toBe(false);
    await expect(importHarmonyProject(JSON.stringify(resealed))).rejects.toThrow("PROJECT_INTEGRITY_INVALID");
    expect(await exportHarmonyProject(await importHarmonyProject(encoded))).toBe(encoded);
  });

  it.each(["section-label", "phrase-boundary-source"] as const)("rejects unreviewed %s substitution outside sourceMeasures", async kind => {
    const w = await ready(await start()), draft = await projectScoreWorkspace(w), quick = await deriveQuickReview(draft, V);
    const project = await createProjectFromQuickReview(draft, quick), changed = structuredClone(project);
    if (kind === "section-label") {
      expect(changed.source.sectionDefinitions.length).toBeGreaterThan(0);
      (changed.source.sectionDefinitions[0] as { label: string }).label = "not present in workspace request";
    } else {
      expect(changed.source.phraseRegions.length).toBeGreaterThan(0);
      expect(changed.source.phraseRegions[0].boundarySource).not.toBe("manual");
      (changed.source.phraseRegions[0] as { boundarySource: string }).boundarySource = "manual";
    }
    expect(await digestMusicalSource(changed.source)).toBe(project.source.revisionDigest);
    expect.soft(await validateSongSourceDocumentIntegrity(changed.source, V.performanceExpanderVersion)).toBe(false);
    expect(await importHarmonyProject(JSON.stringify(changed)).then(() => "accepted", e => e.message)).toBe("PROJECT_INTEGRITY_INVALID");
  });

  it("invalidates both ends and interior when only slur marks change; pitches, rhythm and ties stay identical", async () => {
    let w = await review(await explicitSlur(await start()));
    const before = await replayScoreWorkspace(w);
    w = await explicitSlur(w, 2);
    expect(soundingEvents(await replayScoreWorkspace(w))).toEqual(soundingEvents(before));
    expect(await current(w)).toEqual([true, false, false, false, true]);
    w = await act(await act(w, { kind: "undo" }), { kind: "undo" });
    expect(await current(w)).toEqual([true, true, true, true, true]);
    w = await act(await act(w, { kind: "redo" }), { kind: "redo" });
    expect(await current(await parseScoreWorkspace(await exportScoreWorkspace(w)))).toEqual([true, false, false, false, true]);
  });

  it("keeps unrelated bars reviewed for a slur contained entirely within one bar", async () => {
    let w = await review(await start());
    w = await act(w, { kind: "event-slurs", eventId: (await event(w, 2, 0)).workspaceEventId!, slurs: [{ number: 3, type: "start" }] });
    w = await act(w, { kind: "event-slurs", eventId: (await event(w, 2, 1)).workspaceEventId!, slurs: [{ number: 3, type: "stop" }] });
    expect(await current(w)).toEqual([true, true, false, true, true]);
  });

  it("does not invalidate selected Lead reviews for a separate unselected voice slur", async () => {
    let w = await review(await start({ extraVoice: true }));
    w = await explicitSlur(w, 2, 2);
    expect(await current(w)).toEqual([true, true, true, true, true]);
  });

  it("keeps title-only changes outside active slur musical dependencies", async () => {
    let w = await review(await explicitSlur(await start()));
    w = await act(w, { kind: "title", title: "Display metadata only" });
    expect(await current(w)).toEqual([true, true, true, true, true]);
    expect(canonicalJson(soundingEvents(await replayScoreWorkspace(w)))).toBe(canonicalJson(soundingEvents(await replayScoreWorkspace(await start()))));
  });

  it("invalidates imported-slur endpoints when a contained note is edited before any slur-editor action", async () => {
    let w = await review(await start({ importedSlur: true }));
    const n = await event(w, 2, 0);
    w = await act(w, { kind: "note", eventId: n.workspaceEventId!, value: { kind: "note", pitch: { step: "E", alter: 0, octave: 4 }, onset: n.onset, duration: n.duration, tieStart: false, tieStop: false } });
    expect(await current(w)).toEqual([true, false, false, false, true]);
  });

  it("does not make an untouched imported Lead slur stale when only another voice is edited", async () => {
    let w = await review(await start({ extraVoice: true, importedSlur: true }));
    w = await explicitSlur(w, 2, 2);
    expect(await current(w)).toEqual([true, true, true, true, true]);
  });
});
