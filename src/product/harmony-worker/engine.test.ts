import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { createWorkerEngine, type WorkerExecution } from "./engine";
import type { Operation, Request, WorkerOperations } from "./protocol";
import { IndexedDbProjectStore } from "../local-project-store";
import { answerQuickHarmony, generateQuickHarmony, prepareQuickHarmony } from "../quick-harmony";
import { exportHarmonyProject, importHarmonyProject } from "../project-transfer";
import { projectPracticeView } from "../project-view";
import { projectMusicXml } from "../../app/_result/download";
import { quickProjectId } from "../../app/_quick/generate";
import { materializeActiveArrangement } from "../render";
import { materializePracticeShare } from "../practice-share";
import { tripletExercise } from "../fixtures/triplet-exercise";
import { readVerifiedWorkspace } from "../../import/workspace/journal";

const xml = readFileSync(new URL("../fixtures/wag11/4-4-1.musicxml", import.meta.url), "utf8");
const file = (score = xml) => ({ bytes: new TextEncoder().encode(score), fileName: "worker.musicxml" });
const choice = { parts: ["alto", "tenor"], rightsConfirmed: true, confirmedAt: "2026-10-10T00:00:00.000Z" } as const;
function harness() {
  const factory = new IDBFactory(), store = new IndexedDbProjectStore(factory), engine = createWorkerEngine(store);
  const stages: string[] = [], commits: string[] = [];
  const execution: WorkerExecution = { stage: stage => stages.push(stage), beforeCommit: async () => { commits.push("grant"); } };
  let id = 0;
  async function call<K extends Operation>(operation: K, input: WorkerOperations[K]["input"], custom = execution): Promise<WorkerOperations[K]["output"]> {
    return structuredClone(await engine.execute(structuredClone({ kind: "request", generation: 1, id: ++id, operation, input }) as Request, custom)) as WorkerOperations[K]["output"];
  }
  return { call, store, stages, commits, factory };
}

it.each([["v1.1", xml], ["v1.2", tripletExercise("eighth")]])("%s generates identical bytes, ABC, XML, share and every playback event", async (_, score) => {
  const h = harness(), input = file(score), directPrep = await prepareQuickHarmony(input);
  const direct = await generateQuickHarmony(directPrep, choice);
  if (direct.status !== "complete" && direct.status !== "partial") throw Error(direct.status);
  const prep = await h.call("prepare", input);
  expect(Object.keys(prep).sort()).toEqual(["handle","notes","questions","reasons","status","summary"]);
  expect(prep.summary).toEqual(directPrep.summary);
  const generated = await h.call("generate", { handle: prep.handle, choice });
  if (generated.status !== "saved") throw Error(generated.status);
  const { project } = generated;
  expect(project.projectId).toBe(await quickProjectId(directPrep, choice));
  expect(project.practice).toEqual(await projectPracticeView(direct.project));
  expect(await h.call("exportProject", { handle: project.handle })).toBe(await exportHarmonyProject(direct.project));
  expect(await h.call("exportMusicXml", { handle: project.handle })).toBe(projectMusicXml(direct.project));
  expect(await h.call("sharePayload", { handle: project.handle, confirmation: { rightsConfirmed: true, confirmedAt: choice.confirmedAt } })).toEqual(
    materializePracticeShare({ project: direct.project, presetId: "standard", materialized: materializeActiveArrangement(direct.project, "standard"), workspaceShareConfirmedForThisExport: true }));
  const duplicate = await h.call("generate", { handle: prep.handle, choice: { ...choice, parts: ["tenor","alto"] } });
  expect(duplicate.status).toBe("saved"); expect(h.commits).toHaveLength(1); expect(await h.call("list", null)).toHaveLength(1);
  expect(await h.call("open", { projectId: project.projectId! })).toMatchObject({ practice: project.practice });
});

it("answer previews do not grant rights, mutate the base or duplicate tempo journal entries", async () => {
  const h = harness(), prep = await h.call("prepare", file());
  const preview = await h.call("answer", { handle: prep.handle, answer: { confirmedAt: choice.confirmedAt, tempo: { bpm: 120 } } });
  expect(preview.handle).toBe(prep.handle); expect(preview.summary?.tempo.bpm).toBe(120);
  const directPrep = await prepareQuickHarmony(file());
  const rights = await answerQuickHarmony(directPrep, { confirmedAt: choice.confirmedAt, tempo: { bpm: 120 } });
  expect((await readVerifiedWorkspace(rights.workspace!)).state.request.rights).toBeUndefined();
  expect(rights.details.assessment?.findings.some(f => f.code === "RIGHTS_CONFIRMATION_REQUIRED")).toBe(true);
  for (const tempo of [undefined, { bpm: 100 }]) {
    const c = { ...choice, ...(tempo ? { tempo } : {}) }, generated = await h.call("generate", { handle: prep.handle, choice: c });
    const direct = await generateQuickHarmony(directPrep, c);
    if (generated.status !== "saved" || (direct.status !== "complete" && direct.status !== "partial")) throw Error("generation failed");
    expect(await h.call("exportProject", { handle: generated.project.handle })).toBe(await exportHarmonyProject(direct.project));
  }
  expect(await h.call("list", null)).toHaveLength(2);
});

it.each(["auto-draft-v1-auto.json", "auto-draft-v1-tenor.json", "auto-draft-v1-edited.json"])("keeps old and edited project %s bytes and version", async name => {
  const h = harness(), encoded = readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
  const expected = await exportHarmonyProject(await importHarmonyProject(encoded));
  const imported = await h.call("importProject", { encoded });
  expect(await h.call("exportProject", { handle: imported.handle })).toBe(expected);
  const saved = await h.call("saveProject", { handle: imported.handle, projectId: name, updatedAt: choice.confirmedAt });
  expect(saved.projectId).toBe(name);
  const cold = createWorkerEngine(new IndexedDbProjectStore(h.factory));
  const reopened = await cold.execute({ kind: "request", generation: 2, id: 1, operation: "open", input: { projectId: name } }, { stage() {}, beforeCommit: async () => {} }) as WorkerOperations["open"]["output"];
  expect(reopened?.practice).toEqual(saved.practice);
  expect((await h.store.load(name))?.project.variants.standard).toEqual((await importHarmonyProject(expected)).variants.standard);
  expect(await h.call("exportProject", { handle: saved.handle })).toBe(expected);
});

it("rejects unknown versions and tampered bytes instead of reattesting display data", async () => {
  const h = harness(), encoded = readFileSync(new URL("../fixtures/auto-draft-v1-auto.json", import.meta.url), "utf8");
  await expect(h.call("importProject", { encoded: encoded.replaceAll("grammar-v1.0.1", "grammar-v999") })).rejects.toThrow();
  const project = JSON.parse(encoded); project.source.title = "tampered";
  await expect(h.call("importProject", { encoded: JSON.stringify(project) })).rejects.toThrow();
  await expect(h.call("openShare", { payload: { schemaVersion: 5, verified: true } })).rejects.toThrow();
});

it("validates even a duplicate choice before the existing record shortcut", async () => {
  const h = harness(), prep = await h.call("prepare", file());
  await h.call("generate", { handle: prep.handle, choice });
  await expect(h.call("generate", { handle: prep.handle, choice: { ...choice, rightsConfirmed: false as unknown as true } })).rejects.toThrow();
});

it("does not write before commit grant, and keeps the record absent on grant rejection", async () => {
  const h = harness(), prep = await h.call("prepare", file());
  let resolve!: () => void, reached!: () => void;
  const atCommit = new Promise<void>(r => { reached = r; });
  const result = h.call("generate", { handle: prep.handle, choice }, { stage() {}, beforeCommit: () => { reached(); return new Promise<void>(r => { resolve = r; }); } });
  await atCommit; expect(await h.store.list()).toEqual([]); resolve();
  const saved = await result; expect(saved.status).toBe("saved");
  await expect(h.call("delete", { projectId: (await h.store.list())[0].projectId }, { stage() {}, beforeCommit: async () => { throw Error("cancel"); } })).rejects.toThrow("cancel");
  expect(await h.store.list()).toHaveLength(1);
  const fresh = harness(), freshPrep = await fresh.call("prepare", file());
  await expect(fresh.call("generate", { handle: freshPrep.handle, choice }, { stage() {}, beforeCommit: async () => { throw Error("cancel"); } })).rejects.toThrow("cancel");
  expect(await fresh.store.list()).toHaveLength(0);
});

it("keeps another tab's duplicate record and deletes only after granting commit", async () => {
  const h = harness(), prep = await h.call("prepare", file());
  const result = await h.call("generate", { handle: prep.handle, choice });
  if (result.status !== "saved") throw Error(result.status);
  const id = result.project.projectId!;
  await h.call("delete", { projectId: id }); expect(await h.call("open", { projectId: id })).toBeNull();
  expect(h.commits).toHaveLength(2);
  await h.call("release", { handle: prep.handle });
  await expect(h.call("generate", { handle: prep.handle, choice })).rejects.toMatchObject({ code: "WORKER_HANDLE_EXPIRED" });
});
