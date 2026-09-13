import { binaryDigest } from "../digest/canonical";
import { validateLocalCandidate, type LocalCandidateBundle } from "./local-candidate";

export const LOCAL_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
export const LOCAL_IMAGE_MAX_PIXELS = 20_000_000;
export const LOCAL_IMAGE_PIPELINE_VERSION = "hm-local-image-v1";
export type LocalImagePhase = "queued" | "recognizing" | "supplementing" | "packaging" | "candidate-ready" | "cancelled" | "failed" | "resource-stopped" | "interrupted";
export const LOCAL_IMAGE_PHASE_LABELS: Record<LocalImagePhase, string> = {
  queued: "실행 준비 중", recognizing: "로컬 악보 인식 중", supplementing: "원본 좌표·코드·가사·박자 근거 보완 중",
  packaging: "원본·후보·근거 묶음 검증 준비 중", "candidate-ready": "원본 대조와 교정이 필요한 후보 준비",
  cancelled: "취소됨 · 남은 원시 자료 보존", failed: "실행 실패 · 원본과 부분 출력 보존",
  "resource-stopped": "시간·메모리 제한으로 중단", interrupted: "실행 중단 확인 · 자동 재인식하지 않음",
};
export const localImageRunning = (phase: LocalImagePhase) => ["queued", "recognizing", "supplementing", "packaging"].includes(phase);
export interface LocalImageExecution {
  readonly schema: typeof LOCAL_IMAGE_PIPELINE_VERSION;
  readonly jobId: string;
  readonly inputSha256: string;
  readonly requestSha256: string;
  readonly applicationRevision: string;
  readonly runnerSha256: string;
  readonly modelsSha256: string;
  readonly homrRevision: string;
  readonly cacheReused: false;
  readonly actor: "user" | "ui-test";
}
export interface LocalImageJob {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: "image/png" | "image/jpeg";
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly language: "eng" | "eng+kor";
  readonly createdAt: string;
  readonly phase: LocalImagePhase;
  readonly updatedAt: string;
  readonly sequence: number;
  readonly errorCode?: string;
  readonly resultSha256?: string;
  readonly execution: LocalImageExecution;
}
export function validLocalImageId(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value); }

/** This binds a job to the actual image/bundle, not to a musical approval. */
export async function validateLocalImageResult(job: LocalImageJob, text: string): Promise<LocalCandidateBundle> {
  if (job.phase !== "candidate-ready" || !validLocalImageId(job.id) || text.length > 64_000_000
    || await binaryDigest(new TextEncoder().encode(text)) !== job.resultSha256) throw new RangeError("LOCAL_IMAGE_RESULT_MISMATCH");
  const bundle = JSON.parse(text) as LocalCandidateBundle;
  await validateLocalCandidate(bundle);
  const execution = JSON.parse(bundle.artifacts.evidence.text).execution as LocalImageExecution;
  if (bundle.image.sha256 !== job.execution.inputSha256 || !execution
    || Object.keys(job.execution).some(key => execution[key as keyof LocalImageExecution] !== job.execution[key as keyof LocalImageExecution])
    || execution.cacheReused !== false || execution.jobId !== job.id) throw new RangeError("LOCAL_IMAGE_RESULT_MISMATCH");
  return bundle;
}
