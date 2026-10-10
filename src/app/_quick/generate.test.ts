import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { beforeAll, expect, it, vi } from "vitest";
import { prepareQuickHarmony, generateQuickHarmony, type QuickHarmonyPreparation, type QuickHarmonyChoice, type QuickHarmonyResult } from "../../product/quick-harmony";
import { IndexedDbProjectStore } from "../../product/local-project-store";
import { generateAndSave, quickProjectId } from "./generate";
import { reprepareProject } from "../_result/reprepare";
import { scoreVoiceRoles, voiceColorVars } from "../_ui/score-colors";
import { materializeActiveArrangement } from "../../product/render";
import { projectPracticeView } from "../../product/project-view";
import { projectMusicXml } from "../_result/download";

let prep: QuickHarmonyPreparation;
let result: Extract<QuickHarmonyResult, { status: "complete" | "partial" }>;
const choice: QuickHarmonyChoice = { parts: ["alto", "tenor"], rightsConfirmed: true, confirmedAt: "2026-10-10T00:00:00.000Z" };
beforeAll(async () => {
  prep = await prepareQuickHarmony({ bytes: readFileSync(new URL("../../product/fixtures/wag11/4-4-1.musicxml", import.meta.url)), fileName: "4-4-1.musicxml" });
  const made = await generateQuickHarmony(prep, choice);
  if (made.status !== "complete" && made.status !== "partial") throw new Error(made.status);
  result = made;
});
it("normalizes part order and reopens an existing choice without generating or saving twice", async () => {
  expect(await quickProjectId(prep, choice)).toBe(await quickProjectId(prep, { ...choice, parts: ["tenor", "alto"] }));
  expect(await quickProjectId(prep, choice)).not.toBe(await quickProjectId(prep, { ...choice, parts: ["alto"] }));
  const store = new IndexedDbProjectStore(new IDBFactory());
  const generate = vi.fn(async () => result);
  const first = await generateAndSave(prep, choice, { store, generate });
  expect(await generateAndSave(prep, choice, { store, generate })).toEqual(first);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(await store.list()).toHaveLength(1);
});
it.each(["blocked", "needs-input", "unsupported"] as const)("never saves %s output", async status => {
  const saveNew = vi.fn();
  const returned: QuickHarmonyResult = status === "blocked" ? { status, preparation: prep, project: result.project, parts: result.parts, diagnostics: [] } : { status, preparation: prep };
  expect(await generateAndSave(prep, choice, { store: { load: async () => undefined, saveNew }, generate: async () => returned })).toEqual({ status: "returned", result: returned });
  expect(saveNew).not.toHaveBeenCalled();
});
it("coalesces concurrent saves without replacing the first record", async () => {
  const store = new IndexedDbProjectStore(new IDBFactory());
  const results = await Promise.all([1, 2].map(() => generateAndSave(prep, choice, { store, generate: async () => result })));
  expect(results[0]).toEqual(results[1]);
  expect(await store.list()).toHaveLength(1);
});
it("does not save a generation abandoned by route navigation", async () => {
  let current = true;
  const saveNew = vi.fn();
  expect(await generateAndSave(prep, choice, { store: { load: async () => undefined, saveNew }, isCurrent: () => current, generate: async () => { current = false; return result; } })).toEqual({ status: "cancelled" });
  expect(saveNew).not.toHaveBeenCalled();
});
it("reprepares the recorded workspace and exports real three-part MusicXML", async () => {
  const prepared = await reprepareProject(result.project);
  expect(prepared?.preparation.status).toBe("ready");
  expect(prepared?.preparation.summary?.measureCount).toBe(prep.summary?.measureCount);
  const xml = projectMusicXml(result.project);
  expect(xml).toContain("<score-partwise");
  expect(xml).toContain("알토");
  expect(xml).toContain("테너");
  expect(xml).toContain("<clef-octave-change>-1</clef-octave-change>");
});

it("colors the engine h1/h2 voices from public placement metadata", async () => {
  const view = await projectPracticeView(result.project);
  if (view.status !== "available") throw new Error(view.code);
  const registry = materializeActiveArrangement(result.project, "standard").trackRoles;
  const roles = scoreVoiceRoles(registry);
  expect(voiceColorVars(view.abc, roles)).toEqual({ "--hm-v0": "var(--hm-melody)", "--hm-v1": "var(--hm-alto)", "--hm-v2": "var(--hm-tenor)" });
  const mixed = { ...registry, generatedTracks: registry.generatedTracks.map(track => ({ ...track, placements: [{ phraseId: "one", placementRole: "upper" as const }, { phraseId: "two", placementRole: "lower" as const }] })) };
  expect(voiceColorVars(view.abc, scoreVoiceRoles(mixed))["--hm-v1"]).toBe("currentColor");
});
