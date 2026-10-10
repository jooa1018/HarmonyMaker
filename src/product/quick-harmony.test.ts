import { describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { IDBFactory } from "fake-indexeddb";
import { replayScoreWorkspace } from "../import/workspace/journal";
import { HARMONY_PART_PRESETS } from "../domain/part-presets";
import { exportHarmonyProject } from "./project-transfer";
import { IndexedDbProjectStore } from "./local-project-store";
import { generateQuickHarmony, prepareQuickHarmony, prepareQuickHarmonyWorkspace, type QuickHarmonyChoice } from "./quick-harmony";
import * as autoDraft from "./auto-draft";

// Original test melody, written for this API; no user score or external data.
function score({ beats = 4, extra = false, voices = false } = {}) {
  const note = (step: string, voice = 1) => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><voice>${voice}</voice><type>quarter</type></note>`;
  const bars = [["C", "E", "D", "C", "E"], ["F", "F", "A", "G", "F"], ["G", "D", "G", "B", "D"], ["C", "C", "E", "C", "G"]];
  const measures = bars.map(([root, ...steps], index) => `<measure number="${index + 1}">${index === 0 ? `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>${beats}</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` : ""}<harmony><root><root-step>${root}</root-step></root><kind>major</kind></harmony>${steps.slice(0, beats).map(s => note(s)).join("")}${extra && index === 1 ? note("C") : ""}${voices ? `<backup><duration>4</duration></backup>${steps.map(s => note(s, 2)).join("")}` : ""}</measure>`).join("");
  return `<score-partwise><work><work-title>API 연습곡</work-title></work><part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}
const file = (xml = score(), fileName = "exercise.musicxml") => ({ bytes: strToU8(xml), fileName });
const choice = { parts: ["alto"], rightsConfirmed: true, confirmedAt: "2026-10-09T10:00:00.000Z" } as const satisfies QuickHarmonyChoice;

describe("quick harmony API draft", () => {
  it("prepares XML and MXL without granting rights or claiming human review", async () => {
    const xml = score();
    const mxl = zipSync({ "META-INF/container.xml": strToU8('<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>'), "score.xml": strToU8(xml) });
    for (const input of [file(xml), file(xml, "exercise.xml"), { bytes: mxl, fileName: "exercise.mxl" }]) {
      const prep = await prepareQuickHarmony(input);
      expect(prep.status).toBe("ready");
      expect(prep.questions).toEqual([]);
      expect(prep.notes.length).toBeGreaterThan(0);
      expect(prep.details.assessment?.findings.some(f => f.code === "RIGHTS_CONFIRMATION_REQUIRED")).toBe(true);
      const state = await replayScoreWorkspace(prep.workspace!);
      expect(state.request.rights).toBeUndefined();
      expect(state.attestations).toEqual([]);
      expect(await prepareQuickHarmonyWorkspace(prep.workspace!)).toEqual(prep);
    }
  });

  it("generates alto and tenor, records only generation rights and remains byte deterministic", async () => {
    const prep = await prepareQuickHarmony(file());
    for (const part of ["alto", "tenor"] as const) {
      const input = { ...choice, parts: [part] as readonly [typeof part] };
      const result = await generateQuickHarmony(prep, input);
      expect(result.status).toBe("complete");
      if (result.status !== "complete") throw new Error(result.status);
      expect(result.project.performers[1].hardRange).toEqual(HARMONY_PART_PRESETS[part].hardRange);
      expect(result.project.source.rights).toEqual({ basis: "user-confirmed-rights", allowedUses: ["generation"], confirmedAt: choice.confirmedAt });
      expect(autoDraft.projectSourceStatus(result.project)).toBe("auto-draft");
      const again = await generateQuickHarmony(await prepareQuickHarmony(file()), input);
      if (again.status !== "complete") throw new Error(again.status);
      expect(await exportHarmonyProject(again.project)).toBe(await exportHarmonyProject(result.project));
      const store = new IndexedDbProjectStore(new IDBFactory());
      await store.saveNew({ projectId: `quick-${part}`, updatedAt: choice.confirmedAt, project: result.project });
      expect((await store.load(`quick-${part}`))?.project).toEqual(result.project);
    }
    expect(prep.workspace!.revision).toBe(0);
    expect((await replayScoreWorkspace(prep.workspace!)).attestations).toEqual([]);
  }, 180_000);

  it("preserves the existing default part and generation result", async () => {
    const prep = await prepareQuickHarmony(file());
    const result = await generateQuickHarmony({...prep,summary:{...prep.summary!,measureCount:999,recommendedPart:prep.summary!.recommendedPart === "alto" ? "tenor" : "alto"}}, { ...choice, parts: "auto" });
    const existing = await autoDraft.generateAutoDraftProject(prep.workspace!, { rights: { basis: "user-confirmed-rights", allowedUses: ["generation"], confirmedAt: choice.confirmedAt } });
    if (result.status !== "complete" || existing.status !== "generated") throw new Error("generation failed");
    expect(result.preparation.summary).toEqual(prep.summary);
    expect(await exportHarmonyProject(result.project)).toBe(await exportHarmonyProject(existing.project));
  }, 180_000);

  it("accepts an explicit lead answer without writing a review attestation", async () => {
    const prep = await prepareQuickHarmony(file(score({ voices: true })));
    expect(prep.status).toBe("needs-input");
    expect(prep.summary).toBeUndefined();
    const candidates = prep.questions.find(q => q.id === "lead-selection")!.choices;
    expect(new Set(candidates.map(c => c.labelKo)).size).toBe(candidates.length);
    const lead = candidates[0].value;
    const result = await generateQuickHarmony(prep, { ...choice, answers: { lead } });
    expect(result.status).toBe("complete");
    const state = await replayScoreWorkspace(result.preparation.workspace!);
    expect(state.request.lead).toBe(lead);
    expect(result.preparation.summary?.measureCount).toBe(4);
    expect(state.attestations).toEqual([]);
    expect(result.preparation.details.assessment?.provenance.find(p => p.field === "lead")?.origin).toBe("user-edit");
    expect(prep.workspace!.revision).toBe(0);
    await expect(generateQuickHarmony(prep, { ...choice, answers: { lead: "missing" } })).rejects.toMatchObject({ code: "QUICK_HARMONY_LEAD_INVALID" });
  }, 180_000);

  it("recomputes unsupported and needs-input verdicts even if UI details were forged", async () => {
    for (const [xml, expected] of [[score({ beats: 5 }), "unsupported"], [score({ extra: true }), "needs-input"]] as const) {
      const prep = await prepareQuickHarmony(file(xml));
      expect(prep.status).toBe(expected);
      if (expected === "unsupported") expect(prep.reasons[0].messageKo).toContain("1마디");
      const forged = { ...prep, status: "ready" as const, reasons: [], questions: [], details: {} };
      const result = await generateQuickHarmony(forged, choice);
      expect(result.status).toBe(expected);
      expect("project" in result).toBe(false);
    }
  });

  it("rejects malformed, unsafe, oversized and non-MusicXML inputs with actionable messages", async () => {
    for (const input of [file("broken"), file('<!DOCTYPE score-partwise [<!ENTITY x SYSTEM "file:///unavailable">]><score-partwise/>'), file(score(), "score.pdf"), { bytes: new Uint8Array(4_000_001), fileName: "large.xml" }, { bytes: new Uint8Array([0x50, 0x4b, 0]), fileName: "bad.mxl" }]) {
      const prep = await prepareQuickHarmony(input);
      expect(prep.status).toBe("unsupported");
      expect(prep.summary).toBeUndefined();
      expect(prep.reasons[0].actionKo).toContain("MuseScore");
      expect((await generateQuickHarmony(prep, choice)).status).toBe("unsupported");
    }
  });

  it("requires explicit rights and rejects invalid choices and tampered workspace history", async () => {
    const prep = await prepareQuickHarmony(file());
    await expect(generateQuickHarmony(prep, { ...choice, rightsConfirmed: false } as unknown as QuickHarmonyChoice)).rejects.toMatchObject({ code: "QUICK_HARMONY_RIGHTS_REQUIRED" });
    for (const override of [{ confirmedAt: "" }, { parts: [] }, { parts: ["alto", "alto"] }, { parts: ["soprano"] }, { answers: null }, { answers: { lead: 5 } }]) {
      await expect(generateQuickHarmony(prep, { ...choice, ...override } as unknown as QuickHarmonyChoice)).rejects.toMatchObject({ code: "QUICK_HARMONY_CHOICE_INVALID" });
    }
    const tampered = structuredClone(prep);
    Object.assign(tampered.workspace!.origin, { fileName: "changed.xml" });
    await expect(generateQuickHarmony(tampered, choice)).rejects.toThrow();
  });

  it("accepts only canonical ISO UTC timestamps for the whole choice", async () => {
    const prep = await prepareQuickHarmony(file(score({ voices: true })));
    for (const confirmedAt of ["2026-10-09", "2026-10-09T19:00:00.000+09:00", "2026-10-09T10:00:00Z", "2026-10-09T10:00:00.0000Z", "2026-10-09T10:00:00.000+00:00", "invalid"]) {
      await expect(generateQuickHarmony(prep, { ...choice, confirmedAt })).rejects.toMatchObject({ code: "QUICK_HARMONY_CHOICE_INVALID" });
    }
    const lead = prep.questions.find(q => q.id === "lead-selection")!.choices[0].value;
    const result = await generateQuickHarmony(prep, { ...choice, answers: { lead } });
    if (result.status !== "complete") throw new Error(result.status);
    expect(result.project.source.rights.confirmedAt).toBe(choice.confirmedAt);
    expect(result.preparation.workspace!.operations.at(-1)?.at).toBe(choice.confirmedAt);
  }, 180_000);

  it("does not turn source-blocked or engine-blocked attempts into success", async () => {
    const prep = await prepareQuickHarmony(file());
    const spy = vi.spyOn(autoDraft, "generateAutoDraftProject");
    try {
      spy.mockResolvedValueOnce({ status: "source-blocked", assessment: prep.details.assessment!, diagnostics: [] });
      expect((await generateQuickHarmony(prep, choice)).status).toBe("blocked");
      const actual = await generateQuickHarmony(prep, choice);
      if (actual.status !== "complete") throw new Error(actual.status);
      spy.mockResolvedValueOnce({ status: "generated", assessment: actual.preparation.details.assessment!, project: actual.project,
        generation: { status: "blocked", stage: "solver", diagnostics: [], project: actual.project } });
      expect((await generateQuickHarmony(prep, choice)).status).toBe("blocked");
      spy.mockResolvedValueOnce({ status: "generated", assessment: actual.preparation.details.assessment!, project: actual.project,
        generation: { ...actual.generation, status: "partial" } });
      expect((await generateQuickHarmony(prep, choice)).status).toBe("partial");
    } finally { spy.mockRestore(); }
  }, 180_000);
});
