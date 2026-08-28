import { type NextRequest, NextResponse } from "next/server";

import { mapApiFailure } from "../../../../../../../server/http/api";
import { authorizeInternalRequest, moderationReportId, parseModerationResolution, readInternalJson } from "../../../../../../../server/http/internal-api";
import { getProductionServices } from "../../../../../../../server/substrate/services";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ reportId: string }> }): Promise<NextResponse> {
  try {
    const authorization = authorizeInternalRequest(request);
    const services = await getProductionServices();
    const { reportId } = await context.params;
    const body = parseModerationResolution(await readInternalJson(request));
    const report = await services.shares.resolveModerationReport({
      authorization, reportId: moderationReportId(reportId), claimToken: body.claimToken, resolution: body.resolution,
    });
    return NextResponse.json({ ok: true, report });
  } catch (error) { return mapApiFailure(error); }
}
