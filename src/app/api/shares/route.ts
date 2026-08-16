import { type NextRequest, NextResponse } from "next/server";

import { authorizeMutation, mapApiFailure, parseShareCreateBody } from "../../../server/http/api";
import { createShareIdempotently } from "../../../server/share/idempotent-create";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { services, record } = await authorizeMutation(request);
    const body = await parseShareCreateBody(await request.json());
    const result = await createShareIdempotently({
      quota: services.quota, shares: services.shares, sessionId: record.id, sessionQuotaOwner: record.tokenHash,
      payload: body.payload, rightsBasis: body.rightsBasis, idempotencyKey: body.idempotencyKey,
      requestDigest: body.requestDigest, now: new Date(),
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) { return mapApiFailure(error); }
}
