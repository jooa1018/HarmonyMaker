import { quickHarmonyProjectId } from "../quick-harmony-identity";
import type { HarmonyProject } from "../../domain/project";
import { isPracticeSharePayload } from "../../domain/share";
import { generateDeterministicAccompaniment } from "../../accompaniment/deterministic";
import { IndexedDbProjectStore } from "../local-project-store";
import { answerQuickHarmony, generateQuickHarmony, prepareQuickHarmony, validateQuickHarmonyChoice, type QuickHarmonyPreparation } from "../quick-harmony";
import { describeHarmonyProject, projectPracticeView } from "../project-view";
import { importHarmonyProject, exportHarmonyProject } from "../project-transfer";
import { materializeActiveArrangement } from "../render";
import { exportArrangementMusicXml } from "../musicxml-export";
import { confirmShareRights, materializePracticeShare } from "../practice-share";
import { materializeSharedPractice } from "../shared-practice";
import { arrangementRenderDocumentToAbc } from "../score-adapter";
import { buildPlaybackPlan } from "../playback-plan";
import { HarmonyWorkerError, type Request, type PreparationHandle, type ProjectHandle, type PreparationView, type ProjectView, type WorkerStage } from "./protocol";

export interface WorkerExecution {
  stage(stage: WorkerStage): void;
  beforeCommit(): Promise<void>;
}
type Store = Pick<IndexedDbProjectStore, "load" | "saveNew" | "list" | "delete">;
const MAX_HANDLES = 32;
function failure(code: string): never { throw new HarmonyWorkerError(code, "이 작업을 계속할 수 없어요. 악보나 프로젝트를 다시 열어 주세요."); }

/** Instantiated only by the worker entry (and tests). No project leaves this realm. */
export function createWorkerEngine(store: Store = new IndexedDbProjectStore()) {
  const preparations = new Map<string, QuickHarmonyPreparation>();
  const projects = new Map<string, HarmonyProject>();
  function allocate<T extends string>(map: Map<string, unknown>, value: unknown): T {
    if (map.size >= MAX_HANDLES) map.delete(map.keys().next().value!);
    const handle = crypto.randomUUID() as T;
    map.set(handle, value);
    return handle;
  }
  function get<T>(map: Map<string, T>, handle: string): T {
    const value = map.get(handle);
    if (!value) failure("WORKER_HANDLE_EXPIRED");
    map.delete(handle); map.set(handle, value);
    return value;
  }
  function preparationView(prep: QuickHarmonyPreparation, handle?: PreparationHandle): PreparationView {
    return { handle: handle ?? allocate<PreparationHandle>(preparations, prep), status: prep.status,
      ...(prep.summary ? { summary: prep.summary } : {}), questions: prep.questions, reasons: prep.reasons, notes: prep.notes };
  }
  async function projectView(project: HarmonyProject, projectId: string | null, updatedAt: string | null, execution: WorkerExecution): Promise<ProjectView> {
    execution.stage("view");
    const description = describeHarmonyProject(project), practice = await projectPracticeView(project);
    return { handle: allocate<ProjectHandle>(projects, project), projectId, updatedAt, rightsBasis: project.source.rights.basis, description, practice };
  }
  async function savedProjectView(project: HarmonyProject, projectId: string, updatedAt: string, execution: WorkerExecution): Promise<ProjectView> {
    try { return await projectView(project, projectId, updatedAt, execution); }
    catch {
      throw new HarmonyWorkerError("WORKER_SAVED_VIEW_FAILED", "악보는 저장했지만 화면을 준비하지 못했어요. 내 악보에서 다시 열어 주세요.", projectId);
    }
  }
  function unsavedFailure(error: unknown): never {
    if (error instanceof Error && error.name === "QuotaExceededError")
      throw new HarmonyWorkerError("STORAGE_QUOTA_EXCEEDED", "기기 저장 공간이 부족해 저장하지 못했어요. 공간을 비운 뒤 다시 시도해 주세요.");
    throw error;
  }
  return {
    async execute(request: Request, execution: WorkerExecution): Promise<unknown> {
      switch (request.operation) {
        case "ping": return null;
        case "prepare": {
          execution.stage("preparing");
          return preparationView(await prepareQuickHarmony(request.input));
        }
        case "answer": {
          execution.stage("preparing");
          // The base stays unchanged. Final choice applies its journal once,
          // at the actual confirmedAt, exactly as the pre-worker API does.
          return preparationView(await answerQuickHarmony(get(preparations, request.input.handle), request.input.answer), request.input.handle);
        }
        case "generate": {
          const prep = get(preparations, request.input.handle), choice = validateQuickHarmonyChoice(request.input.choice);
          if (!prep.workspace) return { status: "unsupported", preparation: preparationView(prep, request.input.handle), parts: [] };
          const projectId = await quickHarmonyProjectId(prep, choice);
          execution.stage("verifying");
          const existing = await store.load(projectId);
          if (existing) return { status: "saved", project: await projectView(existing.project, projectId, existing.updatedAt, execution) };
          execution.stage("generating");
          const result = await generateQuickHarmony(prep, choice);
          if (result.status !== "complete" && result.status !== "partial") return {
            status: result.status, preparation: preparationView(result.preparation, request.input.handle), parts: "parts" in result ? result.parts : [],
          };
          execution.stage("verifying");
          let project = result.project, updatedAt = choice.confirmedAt;
          try { await store.saveNew({ projectId, updatedAt, project }, execution.beforeCommit); }
          catch (error) {
            // Another tab can have committed this same choice. Read and verify
            // the winning record, never replace it or display a different graph.
            const winner = await store.load(projectId);
            if (!winner) unsavedFailure(error);
            project = winner.project; updatedAt = winner.updatedAt;
          }
          return { status: "saved", project: await savedProjectView(project, projectId, updatedAt, execution) };
        }
        case "open": {
          execution.stage("verifying");
          const record = await store.load(request.input.projectId);
          return record ? projectView(record.project, record.projectId, record.updatedAt, execution) : null;
        }
        case "list": return store.list();
        case "delete": {
          await store.delete(request.input.projectId, execution.beforeCommit);
          return null;
        }
        case "importProject": {
          execution.stage("verifying");
          return projectView(await importHarmonyProject(request.input.encoded), null, null, execution);
        }
        case "saveProject": {
          const { handle, projectId, updatedAt } = request.input;
          if (typeof projectId !== "string" || !projectId.trim() || projectId.length > 512 || typeof updatedAt !== "string"
            || !Number.isFinite(Date.parse(updatedAt)) || new Date(updatedAt).toISOString() !== updatedAt) failure("WORKER_REQUEST_INVALID");
          const project = get(projects, handle);
          execution.stage("verifying");
          // Import saves are add-only, using an explicit UI library identity.
          try { await store.saveNew({ projectId, updatedAt, project }, execution.beforeCommit); }
          catch (error) {
            if (!await store.load(projectId)) unsavedFailure(error);
            throw error;
          }
          return savedProjectView(project, projectId, updatedAt, execution);
        }
        case "exportProject": {
          execution.stage("verifying");
          return exportHarmonyProject(get(projects, request.input.handle));
        }
        case "exportMusicXml": {
          const project = get(projects, request.input.handle);
          const m = materializeActiveArrangement(project, project.selectedPresetId ?? "standard");
          if (m.validity !== "valid") failure("INVALID_ARRANGEMENT_EXPORT_BLOCKED");
          return exportArrangementMusicXml(m.document, m.trackRoles, {
            title: project.source.title, key: project.source.defaultKey, tempo: project.source.defaultTempo,
            ...(project.source.composer ? { composer: project.source.composer } : {}),
            ...(project.source.importInfo?.sourceKind === "score-workspace" ? { workspaceProjection: project.source.importInfo.workspaceMetadata } : {}),
          });
        }
        case "sharePayload": {
          const c = request.input.confirmation;
          if (!c || c.rightsConfirmed !== true || typeof c.confirmedAt !== "string" || !Number.isFinite(Date.parse(c.confirmedAt)) || new Date(c.confirmedAt).toISOString() !== c.confirmedAt)
            failure("SHARE_RIGHTS_REQUIRED");
          const original = get(projects, request.input.handle), workspace = original.source.importInfo?.sourceKind === "score-workspace";
          const project = workspace ? original : confirmShareRights(original, c.confirmedAt), presetId = project.selectedPresetId ?? "standard";
          return materializePracticeShare({ project, presetId, materialized: materializeActiveArrangement(project, presetId),
            ...(c.playbackDefaults ? { playbackDefaults: c.playbackDefaults } : {}), ...(workspace ? { workspaceShareConfirmedForThisExport: true } : {}) });
        }
        case "openShare": {
          if (!isPracticeSharePayload(request.input.payload)) failure("SHARE_PAYLOAD_INVALID");
          const payload = request.input.payload, { document, trackRoles } = materializeSharedPractice(payload);
          const accompaniment = await generateDeterministicAccompaniment(document.effectiveChordTimeline);
          return { status: "available", abc: arrangementRenderDocumentToAbc(document, trackRoles, payload),
            plan: buildPlaybackPlan(document, trackRoles, accompaniment), tempo: payload.tempo, identity: `${payload.arrangementArtifactDigest}:full` };
        }
        case "release": {
          preparations.delete(request.input.handle); projects.delete(request.input.handle);
          return null;
        }
        default: return failure("WORKER_REQUEST_INVALID");
      }
    },
  };
}
