import { type NextRequest, type NextResponse } from "next/server";

import { createApiRequest, authorizeMutation, mapApiFailure, parseShareCreateBody, readBoundedShareJson } from "../../../server/http/api";
import { createShareIdempotently } from "../../../server/share/idempotent-create";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const api = createApiRequest("/api/shares");
  try {
    const { services, record } = await authorizeMutation(request);
    const body = await parseShareCreateBody(await readBoundedShareJson(request));
    const result = await createShareIdempotently({
      quota: services.quota, shares: services.shares, sessionId: record.id, sessionQuotaOwner: record.tokenHash,
      payload: body.payload, rightsBasis: body.rightsBasis, idempotencyKey: body.idempotencyKey,
      requestDigest: body.requestDigest, now: new Date(),
    });
    return api.json(result.body, { status: result.status });
  } catch (error) { return mapApiFailure(error, api); }
}
