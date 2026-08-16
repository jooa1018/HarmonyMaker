import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { semanticDigest } from "../../domain/digest/canonical";
import { isPracticeSharePayload } from "../../domain/share";
import type { RightsBasis } from "../../domain/source/model";
import { ProductionSubstrateConfigurationError } from "../substrate/config";
import { getProductionServices } from "../substrate/services";
import { SESSION_COOKIE_NAME, SessionSecurityError } from "../security/session";

const rights: readonly RightsBasis[] = ["self-authored", "public-domain", "licensed", "user-confirmed-rights"];

export function apiError(code: string, status: number, messageKo: string): NextResponse {
  return NextResponse.json({ ok: false, error: { code, messageKo } }, { status });
}

export async function mapApiFailure(error: unknown): Promise<NextResponse> {
  if (error instanceof ProductionSubstrateConfigurationError) return apiError("PERSISTENCE_UNAVAILABLE", 503, "서버 저장 기능이 아직 구성되지 않았습니다.");
  if (error instanceof SessionSecurityError) return apiError(error.code, 403, "요청 보안 확인에 실패했습니다.");
  if (error instanceof RangeError) {
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
  if (!isPracticeSharePayload(record.payload) || !rights.includes(record.rightsBasis as RightsBasis) || typeof record.idempotencyKey !== "string") throw new RangeError("SHARE_REQUEST_INVALID");
  return { payload: record.payload, rightsBasis: record.rightsBasis as RightsBasis, idempotencyKey: record.idempotencyKey, requestDigest: await semanticDigest({ payload: record.payload, rightsBasis: record.rightsBasis }) };
}
