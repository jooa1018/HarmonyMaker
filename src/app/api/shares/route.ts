import { type NextRequest, NextResponse } from "next/server";

import { authorizeMutation, mapApiFailure, parseShareCreateBody } from "../../../server/http/api";
import { SHARE_CREATE_PER_HOUR } from "../../../server/security/quota";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { services, record } = await authorizeMutation(request);
    const body = await parseShareCreateBody(await request.json());
    const allowed = await services.quota.consumeHourly({ ownerKind: "session", owner: record.tokenHash, policyKey: "share-create-v1", limit: SHARE_CREATE_PER_HOUR, now: new Date() });
    if (!allowed) return NextResponse.json({ ok: false, error: { code: "QUOTA_EXCEEDED", messageKo: "공유 생성 한도를 초과했습니다." } }, { status: 429 });
    const claim = await services.quota.claimIdempotency({ sessionId: record.id, operation: "share-create-v1", key: body.idempotencyKey, requestDigest: body.requestDigest, now: new Date() });
    if (claim.status === "replay") return NextResponse.json(claim.response);
    if (claim.status !== "claimed") return NextResponse.json({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT", messageKo: "같은 요청 키를 처리 중이거나 내용이 다릅니다." } }, { status: 409 });
    const result = await services.shares.create({ ownerSessionId: record.id, payload: body.payload, rightsBasis: body.rightsBasis });
    const response = { ok: true, share: result };
    await services.quota.completeIdempotency({ sessionId: record.id, operation: "share-create-v1", keyHash: claim.keyHash, response });
    return NextResponse.json(response, { status: 201 });
  } catch (error) { return mapApiFailure(error); }
}
