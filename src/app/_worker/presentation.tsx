import Link from "next/link";
import type { WorkerStage } from "../../product/harmony-worker/client";
export function stageLabel(stage: WorkerStage, deleting = false) {
  return { loading: "불러오는 중", preparing: "악보 판정 중", generating: "화음 생성 중", verifying: "검증 중", committing: deleting ? "지우는 중" : "저장 마무리", view: "화면 준비 중" }[stage];
}
export function workerFailure(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const detail = error instanceof Error ? error.message : String(error);
  const message = code === "STORAGE_QUOTA_EXCEEDED" ? detail
    : code === "WORKER_SAVED_VIEW_FAILED" ? "저장은 됐어요. 내 악보에서 다시 열어 주세요."
    : code === "WORKER_COMMIT_OUTCOME_UNKNOWN" ? "저장됐는지 확인하지 못했어요. 내 악보에서 확인해 주세요."
    : "예상하지 못한 문제가 생겼어요. 다시 시도해 주세요.";
  return { code, detail, message };
}
export function WorkerFailure({ error }: { error: unknown }) {
  const failure = workerFailure(error);
  return <div className="hm-notice is-stop" role="alert"><p>{failure.message}</p><Link className="hm-btn hm-btn-secondary" href="/library">내 악보</Link><details><summary>자세히</summary><div className="hm-prompt"><pre tabIndex={0}>{[failure.code, failure.detail].filter(Boolean).join("\n")}</pre></div></details></div>;
}
export function isAbort(error: unknown) { return error instanceof Error && error.name === "AbortError"; }
