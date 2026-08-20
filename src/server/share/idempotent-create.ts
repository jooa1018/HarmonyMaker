import "server-only";

import type { SemanticDigest } from "../../domain/digest/canonical";
import type { PracticeSharePayload } from "../../domain/share";
import type { RightsBasis } from "../../domain/source/model";
import { isShareCreateIdempotencyKey } from "../../product/share-create-key";
import type { PrivateRowId } from "../persistence/store";
import { SHARE_CREATE_PER_HOUR, type QuotaAndIdempotencyService } from "../security/quota";
import { SHARE_DEFAULT_TTL_DAYS, type ShareCreationChoice, type ShareStoreService } from "./share-store";

/** Keeps the completed replay past share expiry, so K1 can be retired explicitly instead of becoming a blind fresh effect. */
export const SHARE_CREATE_REPLAY_RETENTION_DAYS = SHARE_DEFAULT_TTL_DAYS + 30;

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
  const claim = await input.quota.claimIdempotency({
    sessionId: input.sessionId, operation, key: input.idempotencyKey, requestDigest: input.requestDigest, now: input.now,
    retentionSeconds: SHARE_CREATE_REPLAY_RETENTION_DAYS * 86_400,
  });
  if (claim.status === "replay") {
    const replay = input.shares.replayIdempotentCreate(claim.response);
    if (replay.share.kind === "store" && replay.share.expiresAt <= input.now.toISOString()) {
      return { status: 409, body: { ok: false, error: { code: "SHARE_CREATE_REPLAY_RETIRED", messageKo: "이전 공유가 만료되어 새 요청을 시작할 수 있습니다." } } };
    }
    return { status: 200, body: replay };
  }
  if (claim.status === "pending") return { status: 409, body: { ok: false, error: { code: "IDEMPOTENCY_PENDING", messageKo: "같은 공유 생성 요청이 처리 중입니다." } } };
  if (claim.status === "conflict") return { status: 409, body: { ok: false, error: { code: "IDEMPOTENCY_CONFLICT", messageKo: "같은 요청 키의 내용이 일치하지 않습니다." } } };
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

/**
 * Cross-session recovery never creates a share or consumes quota. It only observes the
 * aggregate or atomically fences an expired pending claim before granting fresh intent.
 */
export async function recoverShareCreateIdempotently(input: {
  readonly quota: QuotaAndIdempotencyService;
  readonly shares: ShareStoreService;
  readonly idempotencyKey: string;
  readonly requestDigest: SemanticDigest;
  readonly now: Date;
}): Promise<ShareCreateCoordinationResult> {
  if (!isShareCreateIdempotencyKey(input.idempotencyKey)) throw new RangeError("IDEMPOTENCY_KEY_INVALID");
  const found = await input.quota.recoverIdempotency({
    operation: "share-create-v1", key: input.idempotencyKey, requestDigest: input.requestDigest, now: input.now,
  });
  if (found.status === "missing" || found.status === "retired-no-effect") {
    return { status: 409, body: { ok: false, error: { code: "SHARE_CREATE_DETERMINISTIC_NO_EFFECT", messageKo: "이전 요청에 durable 공유 효과가 없으므로 명시적 새 요청을 시작할 수 있습니다." } } };
  }
  if (found.status === "pending") return { status: 409, body: { ok: false, error: { code: "IDEMPOTENCY_PENDING", messageKo: "같은 공유 생성 요청이 처리 중입니다." } } };
  if (found.status === "conflict") return { status: 409, body: { ok: false, error: { code: "IDEMPOTENCY_CONFLICT", messageKo: "요청 키와 본문 digest가 일치하지 않습니다." } } };
  if (found.status === "ambiguous") return { status: 409, body: { ok: false, error: { code: "IDEMPOTENCY_AMBIGUOUS", messageKo: "요청 키의 durable authority가 하나로 확정되지 않았습니다." } } };
  if (found.status === "expired") return { status: 409, body: { ok: false, error: { code: "SHARE_CREATE_REPLAY_RETIRED", messageKo: "이전 공유와 replay authority가 만료되어 새 요청을 시작할 수 있습니다." } } };
  const replay = input.shares.replayIdempotentCreate(found.response);
  if (replay.share.kind === "store" && replay.share.expiresAt <= input.now.toISOString()) {
    return { status: 409, body: { ok: false, error: { code: "SHARE_CREATE_REPLAY_RETIRED", messageKo: "이전 공유가 만료되어 새 요청을 시작할 수 있습니다." } } };
  }
  return { status: 200, body: replay };
}
