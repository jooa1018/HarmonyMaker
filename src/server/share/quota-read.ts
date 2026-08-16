import "server-only";

import type { PracticeSharePayload } from "../../domain/share";
import { SHARE_READ_PER_HOUR, type QuotaAndIdempotencyService } from "../security/quota";
import type { ShareStoreService } from "./share-store";

export type ShareReadResult =
  | { readonly status: "ok"; readonly payload: PracticeSharePayload }
  | { readonly status: "quota-exceeded" };

export async function readShareWithIpQuota(input: {
  readonly quota: QuotaAndIdempotencyService;
  readonly shares: ShareStoreService;
  readonly token: string;
  readonly ipAddress: string;
  readonly now: Date;
}): Promise<ShareReadResult> {
  const allowed = await input.quota.consumeHourly({ ownerKind: "ip-hmac", owner: input.ipAddress, policyKey: "share-read-v1", limit: SHARE_READ_PER_HOUR, now: input.now });
  if (!allowed) return { status: "quota-exceeded" };
  return { status: "ok", payload: await input.shares.read(input.token, input.now) };
}
