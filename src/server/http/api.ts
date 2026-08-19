import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { semanticDigest, type SemanticDigest } from "../../domain/digest/canonical";
import { isPracticeSharePayload } from "../../domain/share";
import type { RightsBasis } from "../../domain/source/model";
import { isShareCreateIdempotencyKey } from "../../product/share-create-key";
import { ProductionSubstrateConfigurationError } from "../substrate/config";
import { getProductionServices } from "../substrate/services";
import { SESSION_COOKIE_NAME, SessionSecurityError } from "../security/session";
import { readBoundedStructuredJson } from "./bounded-json";

const rights: readonly RightsBasis[] = ["self-authored", "public-domain", "licensed", "user-confirmed-rights"];
export const SHARE_REQUEST_MAX_BYTES = 384 * 1024;
export const SHARE_SMALL_REQUEST_MAX_BYTES = 8 * 1024;

export function apiError(code: string, status: number, messageKo: string): NextResponse {
  return NextResponse.json({ ok: false, error: { code, messageKo } }, { status });
}

export async function mapApiFailure(error: unknown): Promise<NextResponse> {
  if (error instanceof ProductionSubstrateConfigurationError) return apiError("PERSISTENCE_UNAVAILABLE", 503, "서버 저장 기능이 아직 구성되지 않았습니다.");
  if (error instanceof SessionSecurityError) return apiError(error.code, 403, "요청 보안 확인에 실패했습니다.");
  if (error instanceof RangeError) {
    if (error.message === "MIGRATION_REQUIRED" || error.message === "MIGRATION_HISTORY_DIVERGED") return apiError(error.message, 503, "데이터베이스 schema migration이 준비되지 않았습니다.");
    if (error.message === "INTERNAL_AUTHORITY_INVALID") return apiError(error.message, 403, "내부 작업 권한을 확인할 수 없습니다.");
    if (error.message === "CRON_AUTHORITY_INVALID") return apiError(error.message, 401, "예약 정리 작업 권한을 확인할 수 없습니다.");
    if (error.message === "MODERATION_CLAIM_CONFLICT") return apiError(error.message, 409, "신고 처리 권위가 만료되었거나 다른 작업자가 보유 중입니다.");
    if (error.message === "MODERATION_REQUEST_TOO_LARGE") return apiError(error.message, 413, "내부 요청 크기 한도를 초과했습니다.");
    if (error.message === "SHARE_REQUEST_TOO_LARGE" || error.message === "SHARE_PAYLOAD_TOO_LARGE") return apiError(error.message, 413, "공유 요청 크기 한도를 초과했습니다.");
    if (error.message === "SESSION_REQUEST_TOO_LARGE") return apiError(error.message, 413, "세션 생성 요청은 body를 허용하지 않습니다.");
    if (error.message === "SESSION_REQUEST_INVALID") return apiError(error.message, 400, "세션 생성 요청을 확인해 주세요.");
    if (error.message === "OMR_JOB_UNAVAILABLE" || error.message === "OMR_PAGE_UNAVAILABLE") return apiError("OMR_JOB_UNAVAILABLE", 404, "OMR 작업을 찾을 수 없습니다.");
    if (error.message === "OMR_QUOTA_EXCEEDED" || error.message === "OMR_GLOBAL_CREDIT_CEILING_EXCEEDED") return apiError(error.message, 429, "현재 OMR 사용 한도를 초과했습니다.");
    if (error.message === "OMR_CREATE_REPLAY_UNAVAILABLE") return apiError(error.message, 409, "이 생성 요청의 이전 OMR 작업은 더 이상 사용할 수 없습니다. 새 요청 키로 다시 시작해 주세요.");
    if (error.message.includes("CONFLICT") || error.message.includes("PENDING") || error.message === "OMR_RESULT_UNAVAILABLE") return apiError(error.message, 409, "OMR 작업 상태가 요청과 맞지 않습니다.");
    if (error.message === "OMR_IMAGE_RETAKE_REQUIRED" || error.message === "OMR_IMAGE_WARNING_ACK_REQUIRED") return apiError(error.message, 422, "페이지 품질 확인이 필요합니다.");
    if (error.message === "SHARE_UNAVAILABLE") return apiError("SHARE_UNAVAILABLE", 404, "공유를 열 수 없습니다.");
    if (error.message === "SHARE_RIGHTS_REQUIRED") return apiError("SHARE_RIGHTS_REQUIRED", 400, "공유 권리를 확인해 주세요.");
    return apiError(error.message, 400, "요청 내용을 확인해 주세요.");
  }
  return apiError("SERVER_OPERATION_FAILED", 500, "서버 작업을 완료하지 못했습니다.");
}

export async function authorizeMutation(request: NextRequest) {
  const services = await getProductionServices();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const record = await services.sessions.authorizeMutation({
    sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
    csrfToken: request.headers.get("x-csrf-token") ?? undefined,
    origin: request.headers.get("origin") ?? undefined,
    host: request.headers.get("host") ?? undefined,
    ...(forwardedHost ? { forwardedHost } : {}), now: new Date(),
  });
  return { services, record };
}

export async function parseShareCreateBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RangeError("SHARE_REQUEST_INVALID");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3 || !["payload", "rightsBasis", "idempotencyKey"].every((key) => Object.hasOwn(record, key))
    || !isPracticeSharePayload(record.payload) || !rights.includes(record.rightsBasis as RightsBasis)
    || typeof record.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/u.test(record.idempotencyKey)) throw new RangeError("SHARE_REQUEST_INVALID");
  return { payload: record.payload, rightsBasis: record.rightsBasis as RightsBasis, idempotencyKey: record.idempotencyKey, requestDigest: await semanticDigest({ payload: record.payload, rightsBasis: record.rightsBasis }) };
}

export function parseShareCreateRecoveryBody(value: unknown): { readonly idempotencyKey: string; readonly requestDigest: SemanticDigest } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RangeError("SHARE_CREATE_RECOVERY_INVALID");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2
    || !Object.hasOwn(record, "idempotencyKey") || !Object.hasOwn(record, "requestDigest")
    || !isShareCreateIdempotencyKey(record.idempotencyKey)
    || typeof record.requestDigest !== "string" || !/^[0-9a-f]{64}$/u.test(record.requestDigest)) {
    throw new RangeError("SHARE_CREATE_RECOVERY_INVALID");
  }
  return { idempotencyKey: record.idempotencyKey, requestDigest: record.requestDigest as SemanticDigest };
}

export function readBoundedShareJson(request: NextRequest, maxBytes = SHARE_REQUEST_MAX_BYTES): Promise<unknown> {
  return readBoundedStructuredJson(request, {
    maxBytes,
    invalidCode: "SHARE_REQUEST_INVALID",
    tooLargeCode: "SHARE_REQUEST_TOO_LARGE",
  });
}

export function parseShareDeleteBody(value: unknown): { readonly ownerDeleteSecret: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RangeError("SHARE_DELETE_INVALID");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.ownerDeleteSecret !== "string"
    || !/^[A-Za-z0-9_-]{22,256}$/u.test(record.ownerDeleteSecret)) throw new RangeError("SHARE_DELETE_INVALID");
  return { ownerDeleteSecret: record.ownerDeleteSecret };
}

export function parseShareOwnerReconcileBody(value: unknown): { readonly ownerDeleteSecret: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RangeError("SHARE_OWNER_RECONCILE_INVALID");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.ownerDeleteSecret !== "string"
    || !/^[A-Za-z0-9_-]{22,256}$/u.test(record.ownerDeleteSecret)) throw new RangeError("SHARE_OWNER_RECONCILE_INVALID");
  return { ownerDeleteSecret: record.ownerDeleteSecret };
}

export function parseAbuseReportBody(value: unknown): { readonly category: string; readonly detail?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RangeError("ABUSE_REPORT_INVALID");
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).every((key) => key === "category" || key === "detail")
    || typeof record.category !== "string" || !/^[a-z][a-z0-9-]{1,31}$/u.test(record.category)
    || (record.detail !== undefined && (typeof record.detail !== "string" || record.detail.length > 500))) {
    throw new RangeError("ABUSE_REPORT_INVALID");
  }
  return { category: record.category, ...(typeof record.detail === "string" && record.detail.length > 0 ? { detail: record.detail } : {}) };
}
