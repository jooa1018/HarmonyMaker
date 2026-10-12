import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { createWorkerEngine, type WorkerExecution } from "./engine";
import type { Operation, Request, WorkerOperations } from "./protocol";
import { IndexedDbProjectStore } from "../local-project-store";
import { ScoreWorkspaceStore } from "../../import/workspace/store";
import { serializeScoreWorkspace, parseScoreWorkspace, createScoreWorkspace, applyWorkspaceCommand } from "../../import/workspace/journal";
import { prepareQuickHarmony, prepareQuickHarmonyWorkspace, generateQuickHarmony } from "../quick-harmony";
import { exportHarmonyProject } from "../project-transfer";
import { describeHarmonyProject } from "../project-view";
import * as views from "../project-view";
import { materializePracticeShare } from "../practice-share";
import { materializeActiveArrangement } from "../render";
import { materializeSharedPractice } from "../shared-practice";
import { arrangementRenderDocumentToAbc } from "../score-adapter";
import { buildPlaybackPlan } from "../playback-plan";
import { generateDeterministicAccompaniment } from "../../accompaniment/deterministic";
import type { HarmonyProject } from "../../domain/project";

// The pre-Worker screen calculation is kept here as an independent reference.
async function referencePreparation(project: HarmonyProject) {
  const info = project.source.importInfo;
  if (info?.sourceKind !== "score-workspace") throw Error("workspace origin required");
  return prepareQuickHarmonyWorkspace(await parseScoreWorkspace(info.workspaceMetadata.proof));
}

const input = { bytes: new TextEncoder().encode(readFileSync(new URL("../fixtures/wag11/4-4-1.musicxml", import.meta.url), "utf8")), fileName: "screen.musicxml" };
const choice = { parts: ["alto","tenor"], rightsConfirmed: true, confirmedAt: "2026-10-10T00:00:00.000Z", tempo: { bpm: 92 } } as const;
async function fixture() {
  const preparation = await prepareQuickHarmony(input), result = await generateQuickHarmony(preparation, choice);
  if (result.status !== "complete" && result.status !== "partial") throw Error(result.status);
  return { preparation, project: result.project, encoded: await exportHarmonyProject(result.project) };
}
let data: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { data = await fixture(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function harness() {
  const factory = new IDBFactory(), projects = new IndexedDbProjectStore(factory), workspaces = new ScoreWorkspaceStore(factory);
  const engine = createWorkerEngine(projects, workspaces);
  let id = 0;
  const execution: WorkerExecution = { stage() {}, beforeCommit: async () => {} };
  async function call<K extends Operation>(operation: K, input: WorkerOperations[K]["input"], run = execution): Promise<WorkerOperations[K]["output"]> {
    return structuredClone(await engine.execute({ kind: "request", generation: 1, id: ++id, operation, input } as Request, run)) as WorkerOperations[K]["output"];
  }
  return { call, projects, workspaces, factory };
}

it("returns identical project display roles and re-preparation without altering saved bytes", async () => {
  const h = harness();
  await h.projects.saveNew({ projectId: "original", project: data.project, updatedAt: choice.confirmedAt });
  const opened = (await h.call("open", { projectId: "original" }))!;
  const materialized = materializeActiveArrangement(data.project, "standard");
  expect(opened.trackRoles).toEqual(materialized.trackRoles);
  expect(opened.trackRoles?.sourceLeadLabel).toBe("멜로디");
  expect(opened.trackRoles?.generatedTracks.map(track => ({ label: track.label, roles: [...new Set(track.placements.map(p => p.placementRole))] })))
    .toEqual([{ label: "알토", roles: ["lower"] }, { label: "테너", roles: ["upper"] }]);
  const old = await referencePreparation(data.project), prep = (await h.call("prepareFromProject", { handle: opened.handle }))!;
  expect({ ...prep, handle: undefined }).toEqual({ handle: undefined, status: old.status,
    summary: old.summary, questions: old.questions, notes: old.notes, reasons: old.reasons });
  expect(await h.call("exportProject", { handle: opened.handle })).toBe(data.encoded);
  const regenerated = await h.call("generate", { handle: prep.handle, choice });
  expect(regenerated.status).toBe("saved");
});

it("takes display roles from the render registry even when playback includes a separate rhythm track", async () => {
  const h = harness(), practice = await views.projectPracticeView(data.project);
  if (practice.status !== "available") throw Error(practice.code);
  vi.spyOn(views, "projectPracticeView").mockResolvedValue({ ...practice,
    plan: { ...practice.plan, trackIds: [...practice.plan.trackIds, "track:source-rhythm"] } });
  const opened = await h.call("importProject", { encoded: data.encoded });
  expect(opened.trackRoles).toEqual(materializeActiveArrangement(data.project, "standard").trackRoles);
});

it("returns null for a verified project without a workspace origin", async () => {
  const h = harness();
  // The store boundary supplies an already loaded project, as it does in production.
  vi.spyOn(h.projects, "load").mockResolvedValue({ projectId: "legacy", updatedAt: choice.confirmedAt,
    project: { ...data.project, source: { ...data.project.source, importInfo: undefined } } });
  vi.spyOn(views, "projectPracticeView").mockResolvedValue({ status: "unavailable", code: "ACTIVE_ARRANGEMENT_UNAVAILABLE" });
  const opened = (await h.call("open", { projectId: "legacy" }))!;
  expect(await h.call("prepareFromProject", { handle: opened.handle })).toBeNull();
  expect(opened.trackRoles).toBeUndefined();
});

it("copies the same journal as the current edit action into distinct UUID workspaces", async () => {
  const h = harness(), opened = await h.call("importProject", { encoded: data.encoded });
  const prep = (await h.call("prepareFromProject", { handle: opened.handle }))!;
  const source = (await referencePreparation(data.project)).workspace!;
  const before = await serializeScoreWorkspace(source);
  const a = await h.call("saveEditableWorkspace", { handle: prep.handle }), b = await h.call("saveEditableWorkspace", { handle: prep.handle });
  expect(a.workspaceId).not.toBe(b.workspaceId); expect(a.workspaceId).not.toMatch(/^quick:/);
  const copy = (await h.workspaces.load(a.workspaceId))!.workspace;
  expect(copy.origin).toEqual(source.origin); expect(copy.algorithmVersions).toEqual(source.algorithmVersions);
  expect(copy.operations.map(o => ({ command: o.command, id: o.id, note: o.note, actor: o.actor, at: o.at })))
    .toEqual(source.operations.map(o => ({ command: o.command, id: o.id, note: o.note, actor: o.actor, at: o.at })));
  expect(await serializeScoreWorkspace(source)).toEqual(before);
  expect(await h.workspaces.load(source.id)).toBeUndefined();
  // Replay the former edit action's journal-copy rule with the same UUID;
  // compare the entire serialized workspace, including digest and chain.
  let reference = await createScoreWorkspace(source.origin, source.algorithmVersions, a.workspaceId);
  for (const operation of source.operations) reference = await applyWorkspaceCommand(reference, reference, operation.command,
    { id: operation.id, note: operation.note, actor: operation.actor, at: operation.at });
  expect(await serializeScoreWorkspace(copy)).toEqual(await serializeScoreWorkspace(reference));
});

it("creates no editable record until commit grant, and leaves none after rejection", async () => {
  const h = harness(), prep = await h.call("prepare", input);
  let grant!: () => void, reached!: () => void;
  const ready = new Promise<void>(r => { reached = r; });
  const pending = h.call("saveEditableWorkspace", { handle: prep.handle }, { stage() {}, beforeCommit: () => { reached(); return new Promise<void>(r => { grant = r; }); } });
  await ready; expect(await h.workspaces.list()).toEqual([]);
  grant(); await pending; expect(await h.workspaces.list()).toHaveLength(1);
  await expect(h.call("saveEditableWorkspace", { handle: prep.handle }, { stage() {}, beforeCommit: async () => { throw new DOMException("cancel", "AbortError"); } })).rejects.toMatchObject({ name: "AbortError" });
  expect(await h.workspaces.list()).toHaveLength(1);
});

it("lists descriptions and per-record errors without practice rendering or consuming handles", async () => {
  const h = harness(), opened = await h.call("importProject", { encoded: data.encoded });
  const latest = "2026-10-12T00:00:00.000Z";
  await h.projects.saveNew({ projectId: "good", project: data.project, updatedAt: latest });
  const originalLoad = h.projects.load.bind(h.projects);
  vi.spyOn(h.projects, "list").mockResolvedValue(["good","corrupt","deleted"].map(projectId => ({ projectId, updatedAt: choice.confirmedAt })));
  vi.spyOn(h.projects, "load").mockImplementation(async id => { if (id === "corrupt") throw Error("PROJECT_AUTHORITY_STALE"); return originalLoad(id); });
  const render = vi.spyOn(views, "projectPracticeView");
  for (let i = 0; i < 34; i++) {
    const rows = await h.call("listSummaries", null);
    expect(rows).toEqual([
      { projectId: "good", updatedAt: latest, description: describeHarmonyProject(data.project) },
      { projectId: "corrupt", updatedAt: choice.confirmedAt, error: { code: "PROJECT_AUTHORITY_STALE", messageKo: expect.any(String) } },
    ]);
    expect(rows.every(row => !("handle" in row) && !("abc" in row) && !("plan" in row))).toBe(true);
  }
  expect(render).not.toHaveBeenCalled();
  expect(await h.call("exportProject", { handle: opened.handle })).toBe(data.encoded);
}, 30_000);

it("matches the existing shared screen's title, key, tempo, accompaniment plan and display roles", async () => {
  const h = harness(), payload = materializePracticeShare({ project: data.project, presetId: "standard",
    materialized: materializeActiveArrangement(data.project, "standard"), workspaceShareConfirmedForThisExport: true });
  const m = materializeSharedPractice(payload), band = await generateDeterministicAccompaniment(m.document.effectiveChordTimeline);
  const view = await h.call("openShare", { payload });
  expect(view).toEqual({ status: "available", trackRoles: m.trackRoles,
    abc: arrangementRenderDocumentToAbc(m.document, m.trackRoles, { title: payload.title, tempo: payload.tempo, key: payload.key }),
    plan: buildPlaybackPlan(m.document, m.trackRoles, band), tempo: payload.tempo, identity: `${payload.arrangementArtifactDigest}:full` });
  expect(view.trackRoles.sourceLeadLabel).toBe("멜로디");
  expect(view.trackRoles.generatedTracks.map(track => ({ harmonyRole: track.harmonyRole, label: track.label, roles: track.placements.map(p => p.placementRole) })))
    .toEqual([{ harmonyRole: "H1", label: "테너", roles: ["upper"] }, { harmonyRole: "H2", label: "알토", roles: ["lower"] }]);
});
