import { type NextRequest, NextResponse } from "next/server";

import { authorizeMutation, mapApiFailure, parseShareCreateRecoveryBody, readBoundedShareJson, SHARE_SMALL_REQUEST_MAX_BYTES } from "../../../../server/http/api";
import { recoverShareCreateIdempotently } from "../../../../server/share/idempotent-create";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
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
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) { return mapApiFailure(error); }
}
