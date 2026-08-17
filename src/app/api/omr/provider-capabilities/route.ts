import { type NextRequest, NextResponse } from "next/server";

import { mapApiFailure } from "../../../../server/http/api";
import { authorizeOmr } from "../../../../server/http/omr-api";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { application } = await authorizeOmr(request, false);
    return NextResponse.json({ ok: true, preflight: await application.getProviderPreflight() });
  } catch (error) { return mapApiFailure(error); }
}
