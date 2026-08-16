import { type NextRequest, NextResponse } from "next/server";

import { authorizeMutation, mapApiFailure } from "../../../../../server/http/api";
import { ABUSE_REPORT_PER_HOUR } from "../../../../../server/security/quota";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  try {
    const { services, record } = await authorizeMutation(request);
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!await services.quota.consumeHourly({ ownerKind: "ip-hmac", owner: ip, policyKey: "share-report-v1", limit: ABUSE_REPORT_PER_HOUR, now: new Date() })) return NextResponse.json({ ok: false, error: { code: "QUOTA_EXCEEDED", messageKo: "신고 한도를 초과했습니다." } }, { status: 429 });
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || typeof (body as Record<string, unknown>).category !== "string") throw new RangeError("ABUSE_REPORT_INVALID");
    const { token } = await context.params;
    const value = body as { category: string; detail?: unknown };
    await services.shares.report({ token, reporterSessionId: record.id, category: value.category, ...(typeof value.detail === "string" ? { detail: value.detail } : {}) });
    return NextResponse.json({ ok: true, accepted: true }, { status: 202 });
  } catch (error) { return mapApiFailure(error); }
}
