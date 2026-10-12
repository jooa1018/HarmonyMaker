import { expect, it } from "vitest";
import { answerQuickHarmony, generateQuickHarmony, prepareQuickHarmony } from "./quick-harmony";
import { printedPickupExercise, pickupRepeatExercise } from "./fixtures/pickup-repeat-exercise";
import { applyWorkspaceCommand, readVerifiedWorkspace, serializeScoreWorkspace } from "../import/workspace/journal";
import { fraction } from "../domain/fraction";
import { quickHarmonyProjectId } from "./quick-harmony-identity";
import { exportHarmonyProject, importHarmonyProject } from "./project-transfer";
import { materializeActiveArrangement } from "./render";
import { materializePracticeShare } from "./practice-share";
import { materializeSharedPractice } from "./shared-practice";
import { decodePracticeShare, encodePracticeShare } from "../domain/share";
import { generateAutoDraftProject } from "./auto-draft";
import { inspectPrintedPickup } from "./quick-harmony-pickup";
import { assessAutoDraft } from "../import/workspace/auto-draft";

const at = "2026-10-12T00:00:00.000Z";
const choice = { parts: ["alto", "tenor"], rightsConfirmed: true, confirmedAt: at } as const;
const answers = { pickupChord: "move-printed-to-start" } as const;
const prepare = (xml = printedPickupExercise()) => prepareQuickHarmony({ bytes: new TextEncoder().encode(xml), fileName: "printed-pickup.musicxml" });

it.each(["none", "outside", "inside", "volta"] as const)("moves the one printed chord through the existing journal and round-trips %s", async mode => {
  const prep = await prepare(printedPickupExercise(mode)), before = await serializeScoreWorkspace(prep.workspace!);
  const original = (await readVerifiedWorkspace(prep.workspace!)).state.music!.parts[0].measures[0];
  expect(original.chords[0].onset).toEqual(fraction(1, 2));
  expect(prep.status).toBe("needs-input");
  expect(prep.questions.find(q => q.id === "pickup-chord")?.choices).toEqual([{ value: answers.pickupChord, labelKo: "C 코드를 마디 시작으로 옮기기" }]);
  expect((await generateQuickHarmony({ ...prep, status: "ready", questions: [] }, choice)).status).toBe("needs-input");
  const preview = await answerQuickHarmony(prep, { confirmedAt: at, answers });
  expect(preview.status).toBe("ready");
  expect(preview.workspace!.operations).toHaveLength(1);
  expect(preview.workspace!.operations[0]).toMatchObject({ actor: "user", at,
    command: { kind: "move-chord", chordId: original.chords[0].key, measureId: original.workspaceMeasureId, onset: fraction(0) } });
  const state = (await readVerifiedWorkspace(preview.workspace!)).state, moved = state.music!.parts[0].measures[0];
  expect(state.request.rights).toBeUndefined();
  expect(moved.leadEvents).toEqual(original.leadEvents);
  expect(moved.chords).toEqual([{ ...original.chords[0], onset: fraction(0), source: "manual", confirmation: "unconfirmed" }]);
  const result = await generateQuickHarmony(prep, { ...choice, answers });
  const replay = await generateQuickHarmony(preview, { ...choice, answers });
  if (result.status !== "complete" || replay.status !== "complete") throw Error(JSON.stringify(result.status === "blocked" ? result.diagnostics : result.status));
  const encoded = await exportHarmonyProject(result.project);
  expect(await exportHarmonyProject(replay.project)).toBe(encoded);
  expect(await exportHarmonyProject(await importHarmonyProject(encoded))).toBe(encoded);
  const materialized = materializeActiveArrangement(result.project, "standard");
  expect(materialized.document.effectiveChordTimeline.resolutionPolicy.initialPickup).toBeUndefined();
  const payload = materializePracticeShare({ project: result.project, presetId: "standard", materialized, workspaceShareConfirmedForThisExport: true });
  expect(payload.schemaVersion).toBe(4);
  expect(decodePracticeShare(encodePracticeShare(payload))).toEqual(payload);
  expect(materializeSharedPractice(payload).document.effectiveChordTimeline.spans.length).toBeGreaterThan(0);
  expect(await quickHarmonyProjectId(prep, { ...choice, answers })).not.toBe(await quickHarmonyProjectId(prep, choice));
  expect(await quickHarmonyProjectId(prep, { ...choice, answers })).not.toBe(await quickHarmonyProjectId(prep, { ...choice, answers: { pickupChord: "use-following-first-chord" } }));
  expect(await serializeScoreWorkspace(prep.workspace!)).toEqual(before);
  // Unanswered input still has precisely the same legacy policy/block, without a journal edit.
  const legacy = await generateAutoDraftProject(prep.workspace!, { harmonyParts: choice.parts,
    rights: { basis: "user-confirmed-rights", allowedUses: ["generation"], confirmedAt: at } });
  expect(legacy.status).toBe("source-blocked");
  if (legacy.status === "source-blocked") expect(legacy.diagnostics).toContainEqual(expect.objectContaining({
    details: { issue: "initial-pickup-policy-ineligible", reason: mode === "none" ? "pickup-has-explicit-chord" : "repeated-pickup-or-anchor" },
  }));
});

it.each(["multiple", "unknown", "nc", "percent"] as const)("does not move an ambiguous printed pickup: %s", async kind => {
  const xml = printedPickupExercise().replace(/<harmony>[\s\S]*?<\/harmony>/u, chord => kind === "multiple" ? chord + chord
    : kind === "nc" ? "<harmony><kind>none</kind></harmony>"
    : `<harmony><kind text="${kind === "percent" ? "%" : "???"}">other</kind></harmony>`);
  const prep = await prepare(xml);
  expect(prep.status).toBe("unsupported");
  expect(prep.questions.some(q => q.id === "pickup-chord")).toBe(false);
  expect(prep.reasons.some(r => r.id === "pickup-chord-unavailable" && r.actionKo.includes("MuseScore"))).toBe(true);
  await expect(answerQuickHarmony(prep, { confirmedAt: at, answers })).rejects.toMatchObject({ code: "QUICK_HARMONY_CHOICE_INVALID" });
});

it("rejects unconfirmed evidence, the other pickup answer, and an arbitrary manual move", async () => {
  const prep = await prepare(), { state } = await readVerifiedWorkspace(prep.workspace!);
  const assessment = await assessAutoDraft(prep.workspace!);
  expect(inspectPrintedPickup(state.music!.parts[0], assessment.request!.lead!).kind).toBe("unavailable");
  await expect(answerQuickHarmony(prep, { confirmedAt: at, answers: { pickupChord: "use-following-first-chord" } })).rejects.toMatchObject({ code: "QUICK_HARMONY_CHOICE_INVALID" });
  const other = await prepare(pickupRepeatExercise());
  await expect(answerQuickHarmony(other, { confirmedAt: at, answers })).rejects.toMatchObject({ code: "QUICK_HARMONY_CHOICE_INVALID" });
  const first = state.music!.parts[0].measures[0];
  const workspace = await applyWorkspaceCommand(prep.workspace!, prep.workspace!, { kind: "move-chord", chordId: first.chords[0].key, measureId: first.workspaceMeasureId!, onset: fraction(0) },
    { id: "manual", actor: "user", at, note: "manual move" });
  await expect(answerQuickHarmony({ ...prep, workspace }, { confirmedAt: at, answers })).rejects.toMatchObject({ code: "QUICK_HARMONY_CHOICE_INVALID" });
});
