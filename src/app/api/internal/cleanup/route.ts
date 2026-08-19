import { type NextRequest, NextResponse } from "next/server";

import { authorizeScheduledCleanup, runScheduledCleanup } from "../../../../server/cleanup/scheduled-cleanup";
import { mapApiFailure } from "../../../../server/http/api";
import { getProductionOmrCleanupApplicationService } from "../../../../server/omr/production-service";
import { getProductionServices } from "../../../../server/substrate/services";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    authorizeScheduledCleanup(request);
    const services = await getProductionServices();
    const result = await runScheduledCleanup({
      generic: services.cleanup,
      omr: { cleanupExpiredJobs: async (limit) => (await getProductionOmrCleanupApplicationService()).cleanupExpiredJobs(limit) },
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 207 });
  } catch (error) { return mapApiFailure(error); }
}
