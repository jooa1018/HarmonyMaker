import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { generateQuickHarmony, prepareQuickHarmony } from "./quick-harmony";
import { importHarmonyProject, exportHarmonyProject } from "./project-transfer";
import { validateHarmonyProject, type HarmonyProject } from "../domain/project";
import { loadProductExecutionRegistry } from "./registry";
import { tripletExercise } from "./fixtures/triplet-exercise";
import { materializeEditedArrangement } from "./edited-arrangement";
import { wagInputFromProject } from "./workspace";
import { outputEditId } from "../domain/ids";

const ordinary = readFileSync(new URL("./fixtures/wag11/4-4-1.musicxml", import.meta.url), "utf8");
const at = "2026-10-12T00:00:00.000Z";
function pickup(repeat: boolean) {
  const attributes = /<attributes>[\s\S]*?<\/attributes>/u.exec(ordinary)![0];
  const first = `<measure number="0" implicit="yes">${attributes}${repeat ? '<barline location="left"><repeat direction="forward"/></barline>' : ''}<harmony><root><root-step>C</root-step></root><kind>major</kind></harmony><note><rest/><duration>1</duration><type>eighth</type></note><note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><lyric><text>라</text></lyric></note></measure>`;
  const xml = ordinary.replace('<part id="P1">', `<part id="P1">${first}`);
  return repeat ? xml.replace('</measure></part>', '<barline location="right"><repeat direction="backward"/></barline></measure></part>') : xml;
}
async function generate(xml: string) {
  const r = await generateQuickHarmony(await prepareQuickHarmony({ bytes: new TextEncoder().encode(xml), fileName: "ordinal-exercise.musicxml" }), { parts: ["alto"], rightsConfirmed: true, confirmedAt: at });
  if (r.status !== "complete" && r.status !== "partial") throw Error(r.status);
  return r.project;
}
async function edited(project: HarmonyProject) {
  const v = project.variants.standard;
  if (v?.lifecycle !== "generation-attempted") throw Error("missing generation");
  const candidate = v.generationResult.candidates[0], note = Object.values(candidate.generatedEventsByTrack).flat().find(e => e.kind === "note");
  if (!note || note.kind !== "note") throw Error("missing note");
  const edits = [{ kind: "replace-pitch" as const, id: outputEditId("standard", candidate.contentDigest, 0), presetId: "standard" as const,
    baseCandidateId: candidate.id, baseCandidateDigest: candidate.contentDigest, editOrdinal: 0, eventId: note.id, pitch: note.pitch }];
  const result = await materializeEditedArrangement({ lifecycleInput: await wagInputFromProject(project, "standard"), intentPlan: v.intentPlan,
    activityPlan: v.activityPlan, anchorPlan: v.anchorPlan, candidate, edits });
  if (result.status !== "complete") throw Error(result.status);
  return { ...project, variants: { ...project.variants, standard: { ...v, outputEdits: edits, editedSnapshots: [result.snapshot],
    activeArrangement: { kind: "edited-snapshot" as const, snapshotId: result.snapshot.id } } } };
}
it("preserves validation, bytes and embedded digests of old versions and edited snapshots", async () => {
  const projects: Record<string, HarmonyProject> = {};
  for (const name of ["auto", "alto", "tenor", "edited"]) projects[`v1-${name}`] = await importHarmonyProject(readFileSync(new URL(`./fixtures/auto-draft-v1-${name}.json`, import.meta.url), "utf8"));
  projects["v1.1"] = await generate(ordinary); projects["v1.2-triplet"] = await generate(tripletExercise("eighth"));
  projects["v1.1-edited"] = await edited(projects["v1.1"]); projects["v1.2-edited"] = await edited(projects["v1.2-triplet"]);
  projects.pickup = await generate(pickup(false));
  const observed: Record<string, unknown> = {};
  for (const [name, project] of Object.entries(projects)) {
    const validation = await validateHarmonyProject(project, await loadProductExecutionRegistry());
    expect(validation.status, name).toBe("complete");
    const encoded = await exportHarmonyProject(project);
    observed[name] = { status: validation.status, sha256: createHash("sha256").update(encoded).digest("hex") };
    expect(await exportHarmonyProject(await importHarmonyProject(encoded))).toBe(encoded);
  }
  // Captured on develop a286016 before the verification-order fix.
  expect(observed).toEqual(JSON.parse(readFileSync(new URL("./fixtures/ordinal-compatibility.json", import.meta.url), "utf8")));
}, 30000);

it("validates chronological plan ordinals while leaving the normalized Source array untouched", async () => {
  const project = await generate(pickup(true));
  const before = JSON.stringify(project);
  expect(project.source.sectionOccurrences.map(s => s.startPerformanceMeasureIndex)).toEqual([5, 0]);
  expect((await validateHarmonyProject(project, await loadProductExecutionRegistry())).status).toBe("complete");
  const encoded = await exportHarmonyProject(project);
  expect(await exportHarmonyProject(await importHarmonyProject(encoded))).toBe(encoded);
  expect(JSON.stringify(project)).toBe(before);
  const withEdit = await edited(project);
  expect(await exportHarmonyProject(await importHarmonyProject(await exportHarmonyProject(withEdit)))).toBe(await exportHarmonyProject(withEdit));
  for (const mutation of ["order", "range", "digest"] as const) {
    const bad = structuredClone(project);
    if (mutation === "order") (bad.source.sectionOccurrences as unknown[]).reverse();
    else if (mutation === "range") Object.assign(bad.source.phraseRegions[0], { range: bad.source.phraseRegions[1].range });
    else if (bad.variants.standard?.lifecycle === "generation-attempted") Object.assign(bad.variants.standard.intentPlan, { intentPlanDigest: "0".repeat(64) });
    expect((await validateHarmonyProject(bad, await loadProductExecutionRegistry())).status, mutation).toBe("blocked");
  }
}, 30000);
