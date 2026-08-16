import "server-only";

import type { SemanticDigest } from "../../domain/digest/canonical";
import type { PracticeSharePayload } from "../../domain/share";
import type { RightsBasis } from "../../domain/source/model";
import type { PrivateRowId } from "../persistence/store";
import { SHARE_CREATE_PER_HOUR, type QuotaAndIdempotencyService } from "../security/quota";
import type { ShareCreationChoice, ShareStoreService } from "./share-store";

export interface ShareCreateCoordinationResult {
  readonly status: 200 | 201 | 409 | 429;
  readonly body: unknown;
}

/** Claims before quota so a completed replay has no new resource cost. */
export async function createShareIdempotently(input: {
  readonly quota: QuotaAndIdempotencyService;
  readonly shares: ShareStoreService;
  readonly sessionId: PrivateRowId;
  readonly sessionQuotaOwner: string;
  readonly payload: PracticeSharePayload;
  readonly rightsBasis: RightsBasis;
  readonly idempotencyKey: string;
  readonly requestDigest: SemanticDigest;
  readonly now: Date;
  readonly forceStore?: boolean;
}): Promise<ShareCreateCoordinationResult> {
  const operation = "share-create-v1";
  const claim = await input.quota.claimIdempotency({ sessionId: input.sessionId, operation, key: input.idempotencyKey, requestDigest: input.requestDigest, now: input.now });
  if (claim.status === "replay") return { status: 200, body: input.shares.replayIdempotentCreate(claim.response) };
  if (claim.status !== "claimed") return { status: 409, body: { ok: false, error: { code: "IDEMPOTENCY_CONFLICT", messageKo: "같은 요청 키를 처리 중이거나 내용이 다릅니다." } } };
  const release = () => input.quota.releaseIdempotency({ sessionId: input.sessionId, operation, keyHash: claim.keyHash, claimCreatedAt: claim.claimCreatedAt });
  const allowed = await input.quota.consumeHourly({ ownerKind: "session", owner: input.sessionQuotaOwner, policyKey: operation, limit: SHARE_CREATE_PER_HOUR, now: input.now });
  if (!allowed) {
    await release();
    return { status: 429, body: { ok: false, error: { code: "QUOTA_EXCEEDED", messageKo: "공유 생성 한도를 초과했습니다." } } };
  }
  let response: { readonly ok: true; readonly share: ShareCreationChoice };
  try {
    response = await input.shares.createAndCompleteIdempotency({
      ownerSessionId: input.sessionId,
      payload: input.payload,
      rightsBasis: input.rightsBasis,
      now: input.now,
      ...(input.forceStore === undefined ? {} : { forceStore: input.forceStore }),
      idempotency: { operation, keyHash: claim.keyHash, requestDigest: input.requestDigest, claimCreatedAt: claim.claimCreatedAt },
    });
  } catch (error) {
    await release().catch(() => undefined);
    throw error;
  }
  return { status: 201, body: response };
}
