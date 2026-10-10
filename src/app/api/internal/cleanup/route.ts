import { type NextRequest, type NextResponse } from "next/server";

import { authorizeScheduledCleanup, runScheduledCleanup, scheduledCleanupHttpStatus } from "../../../../server/cleanup/scheduled-cleanup";
import { createApiRequest, mapApiFailure } from "../../../../server/http/api";
import { getProductionServices } from "../../../../server/substrate/services";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const api = createApiRequest("/api/internal/cleanup");
  try {
    authorizeScheduledCleanup(request);
    const services = await getProductionServices();
    const result = await runScheduledCleanup({
      generic: services.cleanup,
      requestContext: api,
    });
    return api.json(result, { status: scheduledCleanupHttpStatus(result) });
  } catch (error) { return mapApiFailure(error, api); }
}
