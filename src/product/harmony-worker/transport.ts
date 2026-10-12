import { HarmonyWorkerError, type ClientMessage, type Operation, type WorkerOperations, type WorkerStage } from "./protocol";

export interface WorkerLike {
  postMessage(message: ClientMessage): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { preventDefault(): void }) => void) | null;
  onmessageerror: (() => void) | null;
}
export interface WorkerRequestOptions {
  readonly signal?: AbortSignal;
  readonly onStage?: (stage: WorkerStage) => void;
}
interface Pending {
  id: number; operation: Operation; input: unknown; options: WorkerRequestOptions; sent: boolean;
  resolve(value: unknown): void; reject(error: unknown): void; detach(): void;
}
const abortError = () => new DOMException("작업을 취소했어요. 악보를 다시 열어 주세요.", "AbortError");
const stages = new Set<unknown>(["loading", "preparing", "generating", "verifying", "committing", "view"]);
const object = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
function validResult(operation: Operation, value: unknown): boolean {
  if (["ping", "delete", "release"].includes(operation)) return value === null;
  if (["exportProject", "exportMusicXml"].includes(operation)) return typeof value === "string";
  if (operation === "list" || operation === "listSummaries") return Array.isArray(value) && value.every(v => object(v) && typeof v.projectId === "string" && typeof v.updatedAt === "string");
  if ((operation === "open" || operation === "prepareFromProject") && value === null) return true;
  if (!object(value)) return false;
  if (operation === "prepare" || operation === "answer" || operation === "prepareFromProject") return typeof value.handle === "string" && ["ready","needs-input","unsupported"].includes(String(value.status)) && ["questions","reasons","notes"].every(k => Array.isArray(value[k]));
  if (operation === "saveEditableWorkspace") return typeof value.workspaceId === "string";
  if (operation === "open" || operation === "importProject" || operation === "saveProject") return typeof value.handle === "string" && object(value.description) && object(value.practice);
  if (operation === "generate") return value.status === "saved" ? validResult("importProject", value.project)
    : ["needs-input","unsupported","blocked"].includes(String(value.status)) && validResult("prepare", value.preparation) && Array.isArray(value.parts);
  if (operation === "openShare") return value.status === "available" && typeof value.abc === "string" && object(value.plan) && object(value.tempo);
  return operation === "sharePayload" && Number.isInteger(value.schemaVersion) && object(value.arrangement);
}

/** One job at a time keeps queued cancellation away from an active commit. */
export function createWorkerTransport(factory: () => WorkerLike, loadTimeoutMs = 60_000) {
  let worker: WorkerLike | undefined, generation = 0, nextId = 0, ready = false, startupMs = 0, started = 0;
  let timer: ReturnType<typeof setTimeout> | undefined, active: Pending | undefined, committing = false, disposed = false;
  const queue: Pending[] = [], idleWaiters: Array<() => void> = [];
  function stage(p: Pending, value: WorkerStage) { try { p.options.onStage?.(value); } catch { /* UI callbacks cannot break commit acknowledgment. */ } }
  function stop(error: unknown) {
    clearTimeout(timer); timer = undefined;
    worker?.terminate(); worker = undefined; ready = false; generation++; committing = false;
    const pending = [...(active ? [active] : []), ...queue.splice(0)]; active = undefined;
    for (const p of pending) { p.detach(); p.reject(error); }
    for (const done of idleWaiters.splice(0)) done();
  }
  function fail(code: string) { stop(new HarmonyWorkerError(code, code === "WORKER_COMMIT_OUTCOME_UNKNOWN"
    ? "저장 결과를 확인하지 못했어요. 라이브러리를 다시 열어 확인해 주세요."
    : "화음 처리 작업을 시작하거나 이어갈 수 없어요. 악보를 다시 열어 주세요.")); }
  function finish(error: unknown, value?: unknown) {
    const p = active; active = undefined; committing = false;
    if (p) { p.detach(); if (error) p.reject(error); else p.resolve(value); }
    if (disposed) { stop(new HarmonyWorkerError("WORKER_DISPOSED", "작업이 종료됐어요.")); return; }
    pump();
  }
  function receive(data: unknown, current: number) {
    if (current !== generation) return;
    if (!object(data)) { fail("WORKER_RESPONSE_INVALID"); return; }
    if (data.kind === "ready") {
      if (ready || data.protocol !== 1) { fail("WORKER_RESPONSE_INVALID"); return; }
      clearTimeout(timer); ready = true; startupMs = performance.now() - started; pump(); return;
    }
    if (!Number.isSafeInteger(data.generation) || !Number.isSafeInteger(data.id)) { fail("WORKER_RESPONSE_INVALID"); return; }
    if (data.generation !== generation || data.id !== active?.id) return;
    const p = active;
    if (!p) return;
    if (data.kind === "stage" && stages.has(data.stage)) {
      // Commit remains uncancellable through post-commit view construction.
      if (!committing) stage(p, data.stage as WorkerStage);
    } else if (data.kind === "commit-ready") {
      if (committing || !["generate","delete","saveProject","saveEditableWorkspace"].includes(p.operation)) { fail("WORKER_RESPONSE_INVALID"); return; }
      committing = true; stage(p, "committing");
      try { worker?.postMessage({ kind: "commit", generation, id: p.id }); }
      catch { fail("WORKER_COMMIT_OUTCOME_UNKNOWN"); }
    } else if (data.kind === "result" && validResult(p.operation, data.value)) finish(undefined, data.value);
    else if (data.kind === "error" && typeof data.code === "string" && typeof data.messageKo === "string"
      && (data.projectId === undefined || typeof data.projectId === "string"))
      finish(new HarmonyWorkerError(data.code, data.messageKo, data.projectId));
    else fail(committing ? "WORKER_COMMIT_OUTCOME_UNKNOWN" : "WORKER_RESPONSE_INVALID");
  }
  function pump() {
    if (disposed) return;
    if (!active) active = queue.shift();
    if (!active) return;
    if (!worker) {
      const current = ++generation; started = performance.now(); stage(active, "loading");
      // A stage callback may cancel synchronously.
      if (!active || disposed || current !== generation) return;
      try {
        worker = factory(); worker.onmessage = e => receive(e.data, current);
        worker.onerror = e => { e.preventDefault(); if (current === generation) fail(committing ? "WORKER_COMMIT_OUTCOME_UNKNOWN" : "WORKER_FAILED"); };
        worker.onmessageerror = () => { if (current === generation) fail(committing ? "WORKER_COMMIT_OUTCOME_UNKNOWN" : "WORKER_RESPONSE_INVALID"); };
        timer = setTimeout(() => fail("WORKER_LOAD_TIMEOUT"), loadTimeoutMs);
      } catch { fail("WORKER_START_FAILED"); }
      return;
    }
    if (!ready || active.sent) return;
    active.sent = true;
    try { worker.postMessage({ kind: "request", generation, id: active.id, operation: active.operation, input: active.input } as ClientMessage); }
    catch { fail("WORKER_REQUEST_CLONE_FAILED"); }
  }
  function request<K extends Operation>(operation: K, input: WorkerOperations[K]["input"], options: WorkerRequestOptions = {}): Promise<WorkerOperations[K]["output"]> {
    if (disposed) return Promise.reject(new HarmonyWorkerError("WORKER_DISPOSED", "작업이 종료됐어요."));
    if (options.signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const p: Pending = { id: ++nextId, operation, input: structuredClone(input), options, sent: false,
        resolve: value => resolve(value as WorkerOperations[K]["output"]), reject, detach: () => options.signal?.removeEventListener("abort", abort) };
      const abort = () => {
        if (p === active) { if (!committing) stop(abortError()); }
        else { const i = queue.indexOf(p); if (i >= 0) { queue.splice(i, 1); p.detach(); reject(abortError()); } }
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      queue.push(p); if (!active) pump();
    });
  }
  return {
    request,
    async start(options?: WorkerRequestOptions) { await request("ping", null, options); return { startupMs }; },
    cancel(): "cancelled" | "committing" | "idle" {
      if (!active) return "idle";
      if (committing) return "committing";
      stop(abortError()); return "cancelled";
    },
    /** Wait for an acknowledged commit instead of terminating it mid-write. */
    async dispose(): Promise<void> {
      disposed = true;
      if (committing) {
        for (const p of queue.splice(0)) { p.detach(); p.reject(abortError()); }
        await new Promise<void>(resolve => idleWaiters.push(resolve));
      } else stop(abortError());
    },
  };
}
