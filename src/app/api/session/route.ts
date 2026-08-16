import { type NextRequest, NextResponse } from "next/server";

import { apiError, mapApiFailure } from "../../../server/http/api";
import { getProductionServices } from "../../../server/substrate/services";
import { SESSION_COOKIE_NAME } from "../../../server/security/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const origin = request.headers.get("origin");
    const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? request.headers.get("host");
    if (!origin || !host || new URL(origin).host.toLowerCase() !== host.toLowerCase()) return apiError("ORIGIN_INVALID", 403, "요청 출처를 확인할 수 없습니다.");
    const services = await getProductionServices();
    const existing = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (existing) {
      try {
        const record = await services.sessions.verify(existing);
        return NextResponse.json({ ok: true, csrfToken: services.sessions.csrfFor(record), expiresAt: record.expiresAt });
      } catch { /* Issue a fixation-resistant replacement below. */ }
    }
    const issued = await services.sessions.issue();
    const response = NextResponse.json({ ok: true, csrfToken: issued.csrfToken, expiresAt: issued.record.expiresAt }, { status: 201 });
    response.headers.append("Set-Cookie", issued.cookie);
    return response;
  } catch (error) { return mapApiFailure(error); }
}
