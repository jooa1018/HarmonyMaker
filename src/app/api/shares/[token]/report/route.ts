import { type NextRequest, type NextResponse } from "next/server";

import { createApiRequest, authorizeMutation, mapApiFailure, parseAbuseReportBody, readBoundedShareJson, SHARE_SMALL_REQUEST_MAX_BYTES } from "../../../../../server/http/api";
import { ABUSE_REPORT_PER_HOUR } from "../../../../../server/security/quota";

import { resolveClientIp } from "../../../../../server/security/client-ip";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const api = createApiRequest("/api/shares/[token]/report");
  try {
    const { services, record } = await authorizeMutation(request);
    const body = parseAbuseReportBody(await readBoundedShareJson(request, SHARE_SMALL_REQUEST_MAX_BYTES));
    const ip = resolveClientIp(request, api);
    if (!await services.quota.consumeClientIpHourly({ ipAddress: ip, policyKey: "share-report-v1", limit: ABUSE_REPORT_PER_HOUR, now: new Date() })) return api.json({ ok: false, error: { code: "QUOTA_EXCEEDED", messageKo: "신고 한도를 초과했습니다." } }, { status: 429 });
    const { token } = await context.params;
    await services.shares.report({ token, reporterSessionId: record.id, category: body.category, ...(body.detail ? { detail: body.detail } : {}) });
    return api.json({ ok: true, accepted: true }, { status: 202 });
  } catch (error) { return mapApiFailure(error, api); }
}
