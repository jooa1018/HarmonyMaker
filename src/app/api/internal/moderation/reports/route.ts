import { type NextRequest, NextResponse } from "next/server";

import { mapApiFailure } from "../../../../../server/http/api";
import { authorizeInternalRequest, moderationStatus } from "../../../../../server/http/internal-api";
import { getProductionServices } from "../../../../../server/substrate/services";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const authorization = authorizeInternalRequest(request);
    const services = await getProductionServices();
    const status = moderationStatus(request.nextUrl.searchParams.get("status"));
    const rawLimit = request.nextUrl.searchParams.get("limit") ?? "50";
    if (!/^[1-9][0-9]{0,2}$/u.test(rawLimit)) throw new RangeError("MODERATION_REQUEST_INVALID");
    const reports = await services.shares.listModerationReports({
      authorization,
      ...(status ? { status } : {}),
      limit: Number(rawLimit),
    });
    return NextResponse.json({ ok: true, reports });
  } catch (error) { return mapApiFailure(error); }
}
