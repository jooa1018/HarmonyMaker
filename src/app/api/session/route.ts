import { type NextRequest, NextResponse } from "next/server";

import { apiError, mapApiFailure } from "../../../server/http/api";
import { getProductionServices } from "../../../server/substrate/services";
import { SESSION_COOKIE_NAME } from "../../../server/security/session";
import { assertBodylessRequest, hasExactRequestOrigin } from "../../../server/http/bounded-json";
import { admitAnonymousSession } from "../../../server/security/session-admission";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    if (!hasExactRequestOrigin(request)) return apiError("ORIGIN_INVALID", 403, "요청 출처를 확인할 수 없습니다.");
    await assertBodylessRequest(request);
    const services = await getProductionServices();
    const existing = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip")?.trim() ?? "unknown";
    const admission = await admitAnonymousSession({ sessions: services.sessions, quota: services.quota, ...(existing ? { existingToken: existing } : {}), ipAddress: ip, now: new Date() });
    if (admission.status === "quota-exceeded") {
      return apiError("QUOTA_EXCEEDED", 429, "새 세션 생성 한도를 초과했습니다.");
    }
    if (admission.status === "existing") return NextResponse.json({ ok: true, csrfToken: admission.csrfToken, sessionAuthority: admission.sessionAuthority, expiresAt: admission.expiresAt });
    const response = NextResponse.json({ ok: true, csrfToken: admission.issued.csrfToken, sessionAuthority: admission.sessionAuthority, expiresAt: admission.issued.record.expiresAt }, { status: 201 });
    response.headers.append("Set-Cookie", admission.issued.cookie);
    return response;
  } catch (error) { return mapApiFailure(error); }
}
