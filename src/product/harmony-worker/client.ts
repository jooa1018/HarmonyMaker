"use client";
import { createWorkerTransport, type WorkerLike, type WorkerRequestOptions } from "./transport";
import type { PreparationHandle, ProjectHandle, WorkerOperations } from "./protocol";
export type { PreparationView, ProjectView, SharedPracticeView, ProjectListEntry, GenerationView, PreparationHandle, ProjectHandle, WorkerStage, ShareConfirmation } from "./protocol";
export { HarmonyWorkerError } from "./protocol";
export type { WorkerRequestOptions } from "./transport";

/** Lazy same-origin file worker; no blob URL and no main-thread fallback. */
export function createHarmonyWorkerClient() {
  const t = createWorkerTransport(() => new Worker(new URL("./entry.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike);
  return {
    start: t.start, cancel: t.cancel, dispose: t.dispose,
    prepare: (file: WorkerOperations["prepare"]["input"], options?: WorkerRequestOptions) => t.request("prepare", file, options),
    answer: (handle: PreparationHandle, answer: WorkerOperations["answer"]["input"]["answer"], options?: WorkerRequestOptions) => t.request("answer", { handle, answer }, options),
    generate: (handle: PreparationHandle, choice: WorkerOperations["generate"]["input"]["choice"], options?: WorkerRequestOptions) => t.request("generate", { handle, choice }, options),
    open: (projectId: string, options?: WorkerRequestOptions) => t.request("open", { projectId }, options),
    prepareFromProject: (handle: ProjectHandle, options?: WorkerRequestOptions) => t.request("prepareFromProject", { handle }, options),
    saveEditableWorkspace: (handle: PreparationHandle, options?: WorkerRequestOptions) => t.request("saveEditableWorkspace", { handle }, options),
    listSummaries: (options?: WorkerRequestOptions) => t.request("listSummaries", null, options),
    list: (options?: WorkerRequestOptions) => t.request("list", null, options),
    delete: (projectId: string, options?: WorkerRequestOptions) => t.request("delete", { projectId }, options),
    importProject: (encoded: string, options?: WorkerRequestOptions) => t.request("importProject", { encoded }, options),
    saveProject: (handle: ProjectHandle, record: { readonly projectId: string; readonly updatedAt: string }, options?: WorkerRequestOptions) => t.request("saveProject", { handle, ...record }, options),
    exportProject: (handle: ProjectHandle, options?: WorkerRequestOptions) => t.request("exportProject", { handle }, options),
    exportMusicXml: (handle: ProjectHandle, options?: WorkerRequestOptions) => t.request("exportMusicXml", { handle }, options),
    sharePayload: (handle: ProjectHandle, confirmation: WorkerOperations["sharePayload"]["input"]["confirmation"], options?: WorkerRequestOptions) => t.request("sharePayload", { handle, confirmation }, options),
    openShare: (payload: unknown, options?: WorkerRequestOptions) => t.request("openShare", { payload }, options),
    release: (handle: PreparationHandle | ProjectHandle, options?: WorkerRequestOptions) => t.request("release", { handle }, options),
  };
}
export type HarmonyWorkerClient = ReturnType<typeof createHarmonyWorkerClient>;
