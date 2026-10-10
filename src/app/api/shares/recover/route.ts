import { type NextRequest, type NextResponse } from "next/server";

import { createApiRequest, authorizeMutation, mapApiFailure, parseShareCreateRecoveryBody, readBoundedShareJson, SHARE_SMALL_REQUEST_MAX_BYTES } from "../../../../server/http/api";
import { recoverShareCreateIdempotently } from "../../../../server/share/idempotent-create";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const api = createApiRequest("/api/shares/recover");
  try {
    const { services } = await authorizeMutation(request);
    const body = parseShareCreateRecoveryBody(await readBoundedShareJson(request, SHARE_SMALL_REQUEST_MAX_BYTES));
    const result = await recoverShareCreateIdempotently({
      quota: services.quota,
      shares: services.shares,
      idempotencyKey: body.idempotencyKey,
      requestDigest: body.requestDigest,
      now: new Date(),
    });
    return api.json(result.body, { status: result.status });
  } catch (error) { return mapApiFailure(error, api); }
}
