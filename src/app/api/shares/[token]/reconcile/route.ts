import { type NextRequest, NextResponse } from "next/server";

import { apiError, mapApiFailure, parseShareOwnerReconcileBody, readBoundedShareJson, SHARE_SMALL_REQUEST_MAX_BYTES } from "../../../../../server/http/api";
import { hasExactRequestOrigin } from "../../../../../server/http/bounded-json";
import { getProductionServices } from "../../../../../server/substrate/services";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  try {
    if (!hasExactRequestOrigin(request)) return apiError("ORIGIN_INVALID", 403, "요청 출처를 확인할 수 없습니다.");
    const body = parseShareOwnerReconcileBody(await readBoundedShareJson(request, SHARE_SMALL_REQUEST_MAX_BYTES));
    const { token } = await context.params;
    const services = await getProductionServices();
    const outcome = await services.shares.reconcileOwnerAuthority(token, body.ownerDeleteSecret, new Date());
    if (outcome.status === "active") return NextResponse.json({ ok: true, state: "active" });
    return NextResponse.json({ ok: false, error: {
      code: "SHARE_CREATE_REPLAY_RETIRED",
      reason: outcome.reason,
      messageKo: outcome.reason === "owner-deleted"
        ? "소유자가 삭제한 이전 공유 대신 새 요청을 시작할 수 있습니다."
        : "이전 공유가 만료되어 새 요청을 시작할 수 있습니다.",
    } }, { status: 409 });
  } catch (error) { return mapApiFailure(error); }
}
