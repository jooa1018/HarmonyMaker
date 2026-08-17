import { type NextRequest, NextResponse } from "next/server";

import { mapApiFailure } from "../../../../../../server/http/api";
import { authorizeOmr, omrHandle } from "../../../../../../server/http/omr-api";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { readonly params: Promise<{ readonly handle: string }> }): Promise<NextResponse> {
  try {
    const { handle } = await context.params;
    const { application } = await authorizeOmr(request, true);
    await application.cancel(omrHandle(handle));
    return NextResponse.json({ ok: true });
  } catch (error) { return mapApiFailure(error); }
}
