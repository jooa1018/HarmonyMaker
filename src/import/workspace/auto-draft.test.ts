import { describe, expect, it } from "vitest";
import { APPLICATION_ALGORITHM_VERSION_REGISTRY as V } from "../../app/algorithm-version-registry";
import { HARMONY_PART_PRESETS } from "../../domain/part-presets";
import { containsPitch } from "../../domain/pitch";
import { exportHarmonyProject, importHarmonyProject } from "../../product/project-transfer";
import { generateAutoDraftProject, projectSourceStatus } from "../../product/auto-draft";
import { materializeActiveArrangement } from "../../product/render";
import { exportArrangementMusicXml } from "../../product/musicxml-export";
import { assessAutoDraft, normalizeAutoDraftOptions, type AutoDraftOptions } from "./auto-draft";
import { originFromMusicXml, workspaceEvidenceDigest } from "./input";
import { applyWorkspaceCommand, createScoreWorkspace, replayScoreWorkspace } from "./journal";
import { deriveWorkspaceCapabilities } from "./review";
import { projectAutoDraftWorkspace } from "./projection";
import type { ScoreWorkspace, WorkspaceCommand } from "./model";

// Independently authored lead sheet (C major, printed chords, lyrics). No private score.
const E = new TextEncoder();
const n = (step: string, octave: number, lyric: string, duration = 1) => `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><voice>1</voice><type>quarter</type><lyric number="1"><syllabic>single</syllabic><text>${lyric}</text></lyric></note>`;
const h = (root: string) => `<harmony><root><root-step>${root}</root-step></root><kind>major</kind></harmony>`;
function leadSheet({ beats = 4, overfull = false }: { beats?: number; overfull?: boolean } = {}) {
  const bars = [[h("C"), n("E", 5, "주"), n("D", 5, "님"), n("C", 5, "의"), n("E", 5, "사")],
    [h("F"), n("F", 5, "랑"), n("A", 5, "이"), n("G", 5, "우"), n("F", 5, "리")],
    [h("G"), n("D", 5, "를"), n("G", 5, "감"), n("B", 4, "싸"), n("D", 5, "네")],
    [h("C"), n("C", 5, "영"), n("E", 5, "원"), n("C", 5, "히"), n("G", 4, "아")]];
  const measures = bars.map((b, i) => `<measure number="${i + 1}">${i === 0 ? `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>${beats}</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` : ""}${b.slice(0, 1 + beats).join("")}${overfull && i === 1 ? n("C", 5, "더") : ""}</measure>`).join("");
  return `<score-partwise><work><work-title>독립 자동 초안 fixture</work-title></work><part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}
const start = async (xml = leadSheet(), id = "workspace:auto-draft") => createScoreWorkspace(await originFromMusicXml(E.encode(xml), "auto.musicxml"), V, id);
const act = (w: ScoreWorkspace, command: WorkspaceCommand) => applyWorkspaceCommand(w, w, command, { id: `op-${w.revision}`, note: "독립 fixture 사용자 입력", actor: "ui-test", at: "2026-09-25T00:00:00.000Z" });
const rights = { rights: { basis: "self-authored", allowedUses: ["generation"] } } as const satisfies AutoDraftOptions;
const midi = (p: { step: string; alter: number; octave: number }) => (p.octave + 1) * 12 + ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>)[p.step] + p.alter;

describe("automatic practice draft contract", () => {
  it("isolates reused assessments from caller mutation, options, history and other documents", async () => {
    const w = await start();
    const first = await assessAutoDraft(w, rights);
    (first.findings as unknown[]).push({ code: "FORGED" });
    expect((await assessAutoDraft(w, rights)).findings.some(f => f.code === "FORGED")).toBe(false);
    expect((await assessAutoDraft(w)).status).toBe("needs-decision");
    const alto = await assessAutoDraft(w, { ...rights, harmonyParts: ["alto"] });
    const tenor = await assessAutoDraft(w, { ...rights, harmonyParts: ["tenor"] });
    expect(alto.request!.performers).not.toEqual(tenor.request!.performers);
    const other = await start(leadSheet({ overfull: true }), "workspace:other");
    expect((await assessAutoDraft(other, rights)).status).toBe("needs-decision");
    const edited = await act(w, { kind: "title", title: "Changed" });
    expect((await assessAutoDraft(edited, rights)).workspaceDigest).not.toBe(first.workspaceDigest);
    const undo = await act(edited, { kind: "undo" });
    expect((await assessAutoDraft(undo, rights)).workspaceRevision).toBe(undo.revision);
    const redo = await act(undo, { kind: "redo" });
    expect((await assessAutoDraft(redo, rights)).workspaceRevision).toBe(redo.revision);
    // Same object and advertised digest cannot hide modified provenance.
    Object.assign(w.origin, { fileName: "tampered.musicxml" });
    await expect(assessAutoDraft(w, rights)).rejects.toThrow();
  });

  it("asks only for rights on an untouched MusicXML lead sheet and records every default's origin", async () => {
    const w = await start();
    const a = await assessAutoDraft(w);
    expect(a.status).toBe("needs-decision");
    expect(a.findings.filter(f => f.category !== "warning").map(f => f.code)).toEqual(["RIGHTS_CONFIRMATION_REQUIRED"]);
    const b = await assessAutoDraft(w, rights);
    expect(b.status).toBe("ready-with-warnings");
    const origin = Object.fromEntries(b.provenance.map(p => [p.field, p.origin]));
    expect(origin).toMatchObject({ lead: "policy-default", "keys.p0m0:key": "source-inferred", tempo: "policy-default", "performers[0]": "policy-default", "performers[1]": "policy-default", rights: "user-choice", sections: "policy-default" });
    expect(b.request!.keys["p0m0:key"]).toEqual({ tonic: { step: "C", alter: 0 }, mode: "major" });
    expect(b.humanSourceReview).toBe("not-performed-by-this-contract");
    expect([b.workspaceRevision, b.workspaceDigest]).toEqual([w.revision, w.digest]);
  });

  it("generates from score + optional part only, without writing any review record", async () => {
    const w = await start();
    for (const part of ["alto", "tenor"] as const) {
      const result = await generateAutoDraftProject(w, { ...rights, harmonyParts: [part] });
      expect(result.status).toBe("generated");
      if (result.status !== "generated") continue;
      expect(result.generation.status).toBe("complete");
      expect(projectSourceStatus(result.project)).toBe("auto-draft");
      const info = result.project.source.importInfo, meta = info?.sourceKind === "score-workspace" ? info.workspaceMetadata : undefined;
      expect(meta?.version).toBe("hm-workspace-auto-draft-v1");
      expect(meta?.autoDraft?.humanSourceReview).toBe("not-performed-by-this-contract");
      // Lead track spans exactly the printed melody; the harmony uses the preset.
      expect(result.project.performers[0].hardRange).toEqual({ low: { step: "G", alter: 0, octave: 4 }, high: { step: "A", alter: 0, octave: 5 } });
      expect(result.project.performers[1].hardRange).toEqual(HARMONY_PART_PRESETS[part].hardRange);
      const variant = result.project.variants.standard;
      const events = variant?.lifecycle === "generation-attempted" ? variant.generationResult.candidates.find(c => c.candidateStatus === "complete")!.generatedEventsByTrack["track:h1"] ?? [] : [];
      const notes = events.flatMap(e => e.kind === "note" ? [e.pitch] : []);
      expect(notes.length).toBeGreaterThan(0);
      expect(notes.every(p => containsPitch(HARMONY_PART_PRESETS[part].hardRange, p))).toBe(true);
      // Round trip keeps the automatic-draft status and its provenance.
      const again = await importHarmonyProject(await exportHarmonyProject(result.project));
      expect(projectSourceStatus(again)).toBe("auto-draft");
      const materialized = materializeActiveArrangement(again, "standard");
      const xml = exportArrangementMusicXml(materialized.document, materialized.trackRoles, { title: again.source.title, key: again.source.defaultKey, tempo: again.source.defaultTempo, ...(again.source.importInfo?.sourceKind === "score-workspace" ? { workspaceProjection: again.source.importInfo.workspaceMetadata } : {}) });
      expect(xml).toContain("&quot;sourceStatus&quot;:&quot;auto-draft&quot;");
    }
    // No background attestation or request edit was written to the workspace.
    expect(w.revision).toBe(0);
    expect((await replayScoreWorkspace(w)).attestations).toEqual([]);
  }, 180_000);

  it("keeps an explicit Lead singer constraint and agrees with the reviewed gate", async () => {
    let w = await start();
    const pitch = (step: "C" | "G", octave: number) => ({ step, alter: 0 as const, octave });
    const narrow = { low: pitch("C", 4), high: pitch("C", 5) }; // printed Lead reaches A5
    w = await act(w, { kind: "performers", count: 2, slots: [0, 1].map(i => ({ id: `pf:${i}`, displayName: `Singer ${i}`, profile: { id: `pf:${i}`, displayName: `Singer ${i}`, hardRange: i ? { low: pitch("C", 3), high: pitch("G", 4) } : narrow, comfortableRange: i ? { low: pitch("C", 3), high: pitch("G", 4) } : narrow } })) });
    const a = await assessAutoDraft(w, rights);
    expect(a.status).toBe("needs-decision");
    expect(a.findings.find(f => f.id === "performers:lead-range")?.code).toBe("STRUCTURE_PERFORMERS");
    expect(a.provenance.find(p => p.field === "performers")?.origin).toBe("user-edit");
    // Same condition in the reviewed-Source gate (independent audit F-04).
    const s = await replayScoreWorkspace(await act(w, { kind: "lead", lead: (await replayScoreWorkspace(w)).music!.leadCandidates[0].key, rhythmVoices: [] }));
    const caps = await deriveWorkspaceCapabilities(s, await workspaceEvidenceDigest(w.origin));
    expect(caps.blockers.some(b => b.id === "performers:lead-range")).toBe(true);
    // Choosing a part preset replaces only the generated voice; the explicit
    // Lead constraint still applies and still blocks.
    const b = await assessAutoDraft(w, { ...rights, harmonyParts: ["tenor"] });
    expect(b.findings.some(f => f.id === "performers:lead-range")).toBe(true);
    await expect(projectAutoDraftWorkspace(w, { ...rights, harmonyParts: ["tenor"] })).rejects.toThrow("AUTO_DRAFT_NOT_READY");
  });

  it("reports unsupported meter and structural conflicts instead of passing them with warnings", async () => {
    const waltz = await assessAutoDraft(await start(leadSheet({ beats: 3 })), rights);
    expect(waltz.status).toBe("unsupported");
    expect(waltz.findings.some(f => f.code === "UNSUPPORTED_METER")).toBe(true);
    const over = await assessAutoDraft(await start(leadSheet({ overfull: true })), rights);
    expect(over.status).toBe("needs-decision");
    expect(over.findings.some(f => f.code === "STRUCTURE_OVERFULL" && f.category === "question")).toBe(true);
  });

  it("rejects altered automatic-draft projects and relabeling as reviewed", async () => {
    const result = await generateAutoDraftProject(await start(), { ...rights, harmonyParts: ["alto"] });
    if (result.status !== "generated") throw new Error(result.status);
    const text = await exportHarmonyProject(result.project);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberate raw-JSON tampering
    const mutate = async (edit: (p: any) => void) => { const p = JSON.parse(text); edit(p); return importHarmonyProject(JSON.stringify(p)); };
    await expect(mutate(p => { p.performers[1].hardRange.low.octave -= 1; })).rejects.toThrow("PROJECT_INTEGRITY_INVALID");
    await expect(mutate(p => { const m = p.source.importInfo.workspaceMetadata; m.autoDraft.marker = m.autoDraft.marker.replace("alto", "tenor"); })).rejects.toThrow("PROJECT_INTEGRITY_INVALID");
    await expect(mutate(p => { const m = p.source.importInfo.workspaceMetadata; m.version = "hm-workspace-projection-v1"; delete m.autoDraft; p.source.importInfo.importerVersion = "hm-workspace-projection-v1"; })).rejects.toThrow("PROJECT_INTEGRITY_INVALID");
    await expect(mutate(p => { p.source.importInfo.workspaceMetadata.autoDraft.humanSourceReview = "performed"; })).rejects.toThrow("PROJECT_INTEGRITY_INVALID");
    expect(() => normalizeAutoDraftOptions({ harmonyParts: ["soprano"] })).toThrow("AUTO_DRAFT_OPTIONS_INVALID");
    expect(() => normalizeAutoDraftOptions({ approved: true })).toThrow("AUTO_DRAFT_OPTIONS_INVALID");
    expect(() => normalizeAutoDraftOptions({ rights: { basis: "user-confirmed-rights", allowedUses: ["generation"] } })).toThrow("AUTO_DRAFT_RIGHTS_INVALID");
    // A different workspace revision is a different verdict; nothing is cached across it.
    const w = await start(), edited = await act(w, { kind: "title", title: "다른 revision" });
    expect((await assessAutoDraft(edited, rights)).workspaceDigest).not.toBe((await assessAutoDraft(w, rights)).workspaceDigest);
    expect(midi({ step: "C", alter: 0, octave: 4 })).toBe(60);
  }, 180_000);
});
