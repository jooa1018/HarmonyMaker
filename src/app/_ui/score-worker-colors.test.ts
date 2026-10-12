import { readFileSync } from "node:fs";
import { beforeAll, expect, it } from "vitest";
import { prepareQuickHarmony, generateQuickHarmony, type QuickHarmonyPreparation, type QuickHarmonyChoice, type QuickHarmonyResult } from "../../product/quick-harmony";
import { scoreVoiceRoles, voiceColorVars } from "./score-colors";
import { productTrackRoles } from "../../product/track-roles";
import { materializeActiveArrangement } from "../../product/render";
import { projectPracticeView } from "../../product/project-view";
let prep: QuickHarmonyPreparation;
let result: Extract<QuickHarmonyResult, { status: "complete" | "partial" }>;
const choice: QuickHarmonyChoice = { parts: ["alto", "tenor"], rightsConfirmed: true, confirmedAt: "2026-10-10T00:00:00.000Z" };
beforeAll(async () => {
  prep = await prepareQuickHarmony({ bytes: readFileSync(new URL("../../product/fixtures/wag11/4-4-1.musicxml", import.meta.url)), fileName: "4-4-1.musicxml" });
  const made = await generateQuickHarmony(prep, choice);
  if (made.status !== "complete" && made.status !== "partial") throw new Error(made.status);
  result = made;
});
it("colors the engine h1/h2 voices from public placement metadata", async () => {
  const view = await projectPracticeView(result.project);
  if (view.status !== "available") throw new Error(view.code);
  const registry = materializeActiveArrangement(result.project, "standard").trackRoles;
  const roles = scoreVoiceRoles(registry);
  expect(scoreVoiceRoles(productTrackRoles(result.project, "standard", view.plan.trackIds.filter(id => id !== "track:source-lead" && id !== "track:band")))).toEqual(roles);
  expect(voiceColorVars(view.abc, roles)).toEqual({ "--hm-v0": "var(--hm-melody)", "--hm-v1": "var(--hm-alto)", "--hm-v2": "var(--hm-tenor)" });
  const mixed = { ...registry, generatedTracks: registry.generatedTracks.map(track => ({ ...track, placements: [{ phraseId: "one", placementRole: "upper" as const }, { phraseId: "two", placementRole: "lower" as const }] })) };
  expect(voiceColorVars(view.abc, scoreVoiceRoles(mixed))["--hm-v1"]).toBe("currentColor");
});
