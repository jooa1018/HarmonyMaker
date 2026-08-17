import { type NextRequest, NextResponse } from "next/server";

import { mapApiFailure } from "../../../../../server/http/api";
import { authorizeOmr, omrHandle } from "../../../../../server/http/omr-api";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { readonly params: Promise<{ readonly handle: string }> }): Promise<NextResponse> {
  try {
    const { handle } = await context.params;
    const { application } = await authorizeOmr(request, false);
    return NextResponse.json({ ok: true, status: await application.getStatus(omrHandle(handle)) });
  } catch (error) { return mapApiFailure(error); }
}

export async function DELETE(request: NextRequest, context: { readonly params: Promise<{ readonly handle: string }> }): Promise<NextResponse> {
  try {
    const { handle } = await context.params;
    const { application } = await authorizeOmr(request, true);
    return NextResponse.json({ ok: true, deletion: await application.delete(omrHandle(handle)) });
  } catch (error) { return mapApiFailure(error); }
}
