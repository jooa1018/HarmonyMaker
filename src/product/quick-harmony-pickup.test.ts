import { expect, it } from "vitest";
import { answerQuickHarmony, generateQuickHarmony, prepareQuickHarmony } from "./quick-harmony";
import { pickupRepeatExercise } from "./fixtures/pickup-repeat-exercise";
import { applyWorkspaceCommand, readVerifiedWorkspace, serializeScoreWorkspace } from "../import/workspace/journal";
import { inspectRepeatedPickup } from "./quick-harmony-pickup";
import { assessAutoDraft } from "../import/workspace/auto-draft";
import { quickHarmonyProjectId } from "./quick-harmony-identity";
import { materializeActiveArrangement } from "./render";
import { materializePracticeShare } from "./practice-share";
import { decodePracticeShare, encodePracticeShare } from "../domain/share";
import { materializeSharedPractice } from "./shared-practice";
import { exportHarmonyProject, importHarmonyProject } from "./project-transfer";
import { exportArrangementMusicXml } from "./musicxml-export";
import { generateAutoDraftProject } from "./auto-draft";
import { fraction } from "../domain/fraction";

const at = "2026-10-12T00:00:00.000Z";
const choice = { parts: ["alto", "tenor"], rightsConfirmed: true, confirmedAt: at } as const;
const answers = { pickupChord: "use-following-first-chord" } as const;
const prepare = (xml = pickupRepeatExercise()) => prepareQuickHarmony({ bytes: new TextEncoder().encode(xml), fileName: "pickup-exercise.musicxml" });

it.each(["outside", "inside", "volta"] as const)("asks once then journals a normal chord and round-trips %s", async mode => {
  const prep = await prepare(pickupRepeatExercise(mode)), before = await serializeScoreWorkspace(prep.workspace!);
  expect(prep.status).toBe("needs-input");
  expect(prep.questions.find(q => q.id === "pickup-chord")?.choices).toEqual([{ value: answers.pickupChord, labelKo: "C 코드 사용하기" }]);
  expect((await generateQuickHarmony(prep, choice)).status).toBe("needs-input");
  const preview = await answerQuickHarmony(prep, { confirmedAt: at, answers });
  expect(preview.status).toBe("ready");
  const ops = preview.workspace!.operations;
  expect(ops).toHaveLength(1);
  expect(ops[0]).toMatchObject({ actor: "user", at, command: { kind: "chord", text: "C", onset: fraction(0) } });
  expect((await readVerifiedWorkspace(preview.workspace!)).state.request.rights).toBeUndefined();
  const result = await generateQuickHarmony(prep, { ...choice, answers });
  if (result.status !== "complete" && result.status !== "partial") throw Error(JSON.stringify(result.status === "blocked" ? result.diagnostics : result.status));
  const replay = await generateQuickHarmony(preview, { ...choice, answers });
  if (replay.status !== "complete" && replay.status !== "partial") throw Error(replay.status);
  expect(await exportHarmonyProject(replay.project)).toBe(await exportHarmonyProject(result.project));
  const materialized = materializeActiveArrangement(result.project, "standard");
  expect(materialized.document.effectiveChordTimeline.resolutionPolicy.initialPickup).toBeUndefined();
  expect(materialized.document.effectiveChordTimeline.spans.some(s => s.origin.kind === "arrangement-policy")).toBe(false);
  const payload = materializePracticeShare({ project: result.project, presetId: "standard", materialized, workspaceShareConfirmedForThisExport: true });
  expect(payload.schemaVersion).toBe(4);
  expect(decodePracticeShare(encodePracticeShare(payload))).toEqual(payload);
  expect(materializeSharedPractice(payload).document.effectiveChordTimeline.spans).not.toHaveLength(0);
  const xml = exportArrangementMusicXml(materialized.document, materialized.trackRoles, { title: result.project.source.title, key: result.project.source.defaultKey, tempo: result.project.source.defaultTempo });
  expect(xml).toContain("<harmony>"); expect(xml).not.toContain("편곡 정책");
  const encoded = await exportHarmonyProject(result.project);
  expect(await exportHarmonyProject(await importHarmonyProject(encoded))).toBe(encoded);
  expect(await serializeScoreWorkspace(prep.workspace!)).toEqual(before);
  expect(await quickHarmonyProjectId(prep, { ...choice, answers })).not.toBe(await quickHarmonyProjectId(prep, choice));
});

it("writes at zero before an eighth rest, keeps the rest and generates", async () => {
  const prep = await prepare(pickupRepeatExercise("inside", true));
  const preview = await answerQuickHarmony(prep, { confirmedAt: at, answers });
  const { state } = await readVerifiedWorkspace(preview.workspace!);
  expect(state.music!.parts[0].measures[0]).toMatchObject({ chords: [{ onset: fraction(0), source: "manual" }],
    leadEvents: [{ kind: "rest", onset: fraction(0) }, { kind: "note", onset: fraction(1, 2) }] });
  expect(["complete", "partial"]).toContain((await generateQuickHarmony(prep, { ...choice, answers })).status);
});

it.each(["none", "nc", "percent", "unknown", "multiple", "late"])("refuses an unusable first anchor: %s", async mode => {
  const xml = pickupRepeatExercise().replace(/<measure number="1">[\s\S]*?<\/measure>/u, m => {
    const chord = /<harmony>[\s\S]*?<\/harmony>/u.exec(m)![0];
    return m.replace(chord, mode === "none" ? "" : mode === "nc" ? '<harmony><kind>none</kind></harmony>'
      : mode === "percent" ? '<harmony><kind text="%">other</kind></harmony>'
      : mode === "unknown" ? '<harmony><kind text="???">other</kind></harmony>'
      : mode === "multiple" ? chord + chord : chord.replace("</harmony>", "<offset>1</offset></harmony>"));
  });
  const prep = await prepare(xml);
  expect(prep.status).not.toBe("ready");
  expect(prep.questions.some(q => q.id === "pickup-chord")).toBe(false);
  expect(prep.reasons.some(r => r.actionKo.includes("MuseScore"))).toBe(true);
  await expect(answerQuickHarmony(prep, { confirmedAt: at, answers })).rejects.toMatchObject({ code: "QUICK_HARMONY_CHOICE_INVALID" });
  expect(["unsupported", "needs-input"]).toContain((await generateQuickHarmony(prep, choice)).status);
});

it("rejects an unconfirmed projected anchor and invalid answer values", async () => {
  const prep = await prepare(), { state } = await readVerifiedWorkspace(prep.workspace!);
  const assessment = await assessAutoDraft(prep.workspace!);
  // Raw imported chords are unconfirmed; the auto-draft projection normally confirms them.
  expect(inspectRepeatedPickup(state.music!.parts[0], assessment.request!.lead!, prep.workspace!.algorithmVersions.performanceExpanderVersion).kind).toBe("unavailable");
  await expect(generateQuickHarmony(prep, { ...choice, answers: { pickupChord: "C" as never } })).rejects.toMatchObject({ code: "QUICK_HARMONY_CHOICE_INVALID" });
});

it.each([["none", false], ["outside", true]] as const)("preserves pre-change project bytes: %s printed=%s", async (mode, printed) => {
  const prep = await prepare(pickupRepeatExercise(mode, false, printed));
  const before = await serializeScoreWorkspace(prep.workspace!);
  const baseline = await generateAutoDraftProject(prep.workspace!, { harmonyParts: choice.parts,
    rights: { basis: "user-confirmed-rights", allowedUses: ["generation"], confirmedAt: at } });
  const result = await generateQuickHarmony(prep, choice);
  if (baseline.status !== "generated" || (result.status !== "complete" && result.status !== "partial")) throw Error(JSON.stringify(result.status === "blocked" ? result.diagnostics : result.status));
  expect(await exportHarmonyProject(result.project)).toBe(await exportHarmonyProject(baseline.project));
  expect(await serializeScoreWorkspace(prep.workspace!)).toEqual(before);
});

it("does not silently answer from an arbitrary explicit chord", async () => {
  const prep = await prepare(), { state } = await readVerifiedWorkspace(prep.workspace!);
  const workspace = await applyWorkspaceCommand(prep.workspace!, prep.workspace!, { kind: "chord", measureId: state.music!.parts[0].measures[0].workspaceMeasureId!, text: "F", onset: fraction(0) }, { id: "manual", actor: "user", at, note: "manual" });
  await expect(generateQuickHarmony({ ...prep, workspace }, { ...choice, answers })).rejects.toMatchObject({ code: "QUICK_HARMONY_CHOICE_INVALID" });
});

it("rechecks pickup eligibility instead of trusting an edited presentation DTO", async () => {
  const prep = await prepare();
  expect((await generateQuickHarmony({ ...prep, status: "ready", questions: [], reasons: [] }, choice)).status).toBe("needs-input");
  const normal = await prepare(pickupRepeatExercise("none"));
  await expect(generateQuickHarmony({ ...normal, questions: prep.questions }, { ...choice, answers })).rejects.toMatchObject({ code: "QUICK_HARMONY_CHOICE_INVALID" });
});

