import { type NextRequest, NextResponse } from "next/server";

import { mapApiFailure } from "../../../../../../../server/http/api";
import { authorizeInternalRequest, moderationReportId, parseModerationClaim, readInternalJson } from "../../../../../../../server/http/internal-api";
import { getProductionServices } from "../../../../../../../server/substrate/services";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ reportId: string }> }): Promise<NextResponse> {
  try {
    const authorization = authorizeInternalRequest(request);
    const services = await getProductionServices();
    const { reportId } = await context.params;
    const body = parseModerationClaim(await readInternalJson(request));
    const result = await services.shares.claimModerationReport({
      authorization, reportId: moderationReportId(reportId), moderatorId: body.moderatorId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) { return mapApiFailure(error); }
}
