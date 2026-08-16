import { type NextRequest, NextResponse } from "next/server";

import { authorizeMutation, mapApiFailure } from "../../../../server/http/api";
import { getProductionServices } from "../../../../server/substrate/services";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  try {
    const { token } = await context.params;
    const payload = await (await getProductionServices()).shares.read(token);
    return NextResponse.json({ ok: true, payload });
  } catch (error) { return mapApiFailure(error); }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  try {
    const { services } = await authorizeMutation(request);
    const { token } = await context.params;
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || typeof (body as Record<string, unknown>).ownerDeleteSecret !== "string") throw new RangeError("SHARE_DELETE_INVALID");
    await services.shares.ownerDelete(token, (body as { ownerDeleteSecret: string }).ownerDeleteSecret);
    return NextResponse.json({ ok: true });
  } catch (error) { return mapApiFailure(error); }
}
