import { type NextRequest, NextResponse } from "next/server";

import { mapApiFailure } from "../../../../../../server/http/api";
import { authorizeOmr, omrHandle } from "../../../../../../server/http/omr-api";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { readonly params: Promise<{ readonly handle: string }> }): Promise<NextResponse> {
  try {
    const { handle } = await context.params;
    const { application } = await authorizeOmr(request, false);
    return NextResponse.json({ ok: true, result: await application.exportResult(omrHandle(handle)) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return mapApiFailure(error); }
}
