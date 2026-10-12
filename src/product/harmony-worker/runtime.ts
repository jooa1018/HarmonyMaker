import { HarmonyWorkerError, type ClientMessage, type Request, type WorkerMessage } from "./protocol";
import type { createWorkerEngine } from "./engine";
import { QuickHarmonyInputError } from "../quick-harmony";

export interface WorkerPort {
  postMessage(message: WorkerMessage): void;
  addEventListener(type: "message", listener: (event: { data: ClientMessage }) => void): void;
}

/** Serial execution, except the commit grant which must unblock the active job. */
export function runWorker(port: WorkerPort, engine: ReturnType<typeof createWorkerEngine>) {
  let queue = Promise.resolve(), grant: { generation: number; id: number; resolve: () => void } | undefined;
  const execute = async (request: Request) => {
    const identity = { generation: request.generation, id: request.id };
    try {
      const value = await engine.execute(request, {
        stage: stage => port.postMessage({ kind: "stage", ...identity, stage }),
        beforeCommit: () => new Promise<void>(resolve => {
          grant = { ...identity, resolve };
          port.postMessage({ kind: "commit-ready", ...identity });
        }),
      });
      port.postMessage({ kind: "result", ...identity, value });
    } catch (error) {
      const known = error instanceof HarmonyWorkerError || error instanceof QuickHarmonyInputError;
      const code = known ? error.code
        : error instanceof Error && /^[A-Z][A-Z0-9_:-]{0,120}$/u.test(error.message) ? error.message : "WORKER_OPERATION_FAILED";
      port.postMessage({ kind: "error", ...identity, code,
        ...(error instanceof HarmonyWorkerError && error.projectId ? { projectId: error.projectId } : {}),
        messageKo: known ? error.message : "악보 처리에 실패했어요. 입력이나 저장된 프로젝트를 확인해 주세요." });
    } finally { grant = undefined; }
  };
  port.addEventListener("message", ({ data }) => {
    if (data?.kind === "commit") {
      if (grant?.generation === data.generation && grant.id === data.id) { const resolve = grant.resolve; grant = undefined; resolve(); }
    } else if (data?.kind === "request" && Number.isSafeInteger(data.id) && Number.isSafeInteger(data.generation)) {
      queue = queue.then(() => execute(data));
    }
  });
  port.postMessage({ kind: "ready", protocol: 1 });
}
