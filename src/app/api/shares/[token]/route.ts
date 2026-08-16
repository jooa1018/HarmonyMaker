import { type NextRequest, NextResponse } from "next/server";

import { authorizeMutation, mapApiFailure } from "../../../../server/http/api";
import { readShareWithIpQuota } from "../../../../server/share/quota-read";
import { getProductionServices } from "../../../../server/substrate/services";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  try {
    const { token } = await context.params;
    const services = await getProductionServices();
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip")?.trim() ?? "unknown";
    const result = await readShareWithIpQuota({ quota: services.quota, shares: services.shares, token, ipAddress: ip, now: new Date() });
    if (result.status === "quota-exceeded") return NextResponse.json({ ok: false, error: { code: "QUOTA_EXCEEDED", messageKo: "공유 읽기 한도를 초과했습니다." } }, { status: 429 });
    return NextResponse.json({ ok: true, payload: result.payload });
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
