import type { SemanticDigest } from "../../domain/digest/canonical";
import type { GovernanceStore, IdempotencyClaim, PrivateRowId } from "../persistence/store";
import { keyedTokenHash } from "./crypto-core";

export const OMR_QUOTA_POLICY = Object.freeze({ maxConcurrentJobsPerSession: 1, maxJobsPerSessionPerHour: 3 });
export const SHARE_CREATE_PER_HOUR = 12;
export const SHARE_READ_PER_HOUR = 120;
export const ABUSE_REPORT_PER_HOUR = 6;
export const SESSION_CREATE_PER_HOUR = 12;
export const IDEMPOTENCY_PENDING_LEASE_SECONDS = 300;

export function normalizeIpAddress(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
}

function hourlyWindow(now: Date): { readonly start: string; readonly end: string } {
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  return { start: start.toISOString(), end: new Date(start.getTime() + 60 * 60 * 1_000).toISOString() };
}

export class QuotaAndIdempotencyService {
  constructor(private readonly store: GovernanceStore, private readonly hmacKey: Uint8Array) {}
  ipHash(ip: string): string { return keyedTokenHash(normalizeIpAddress(ip), this.hmacKey, "quota-ip-v1"); }

  async consumeHourly(input: { readonly ownerKind: "session" | "ip-hmac"; readonly owner: string; readonly policyKey: string; readonly limit: number; readonly now: Date }): Promise<boolean> {
    const window = hourlyWindow(input.now);
    return this.store.consumeQuota({
      ownerKind: input.ownerKind,
      ownerHash: input.ownerKind === "ip-hmac" ? this.ipHash(input.owner) : input.owner,
      policyKey: input.policyKey,
      windowStartedAt: window.start,
      expiresAt: window.end,
      limit: input.limit,
    });
  }

  async claimIdempotency(input: { readonly sessionId: PrivateRowId; readonly operation: string; readonly key: string; readonly requestDigest: SemanticDigest; readonly now: Date; readonly retentionSeconds?: number; readonly pendingLeaseSeconds?: number }): Promise<IdempotencyClaim & { readonly keyHash: string }> {
    if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(input.key)) throw new RangeError("IDEMPOTENCY_KEY_INVALID");
    const keyHash = keyedTokenHash(input.key, this.hmacKey, "idempotency-v1");
    const result = await this.store.claimIdempotency({
      sessionId: input.sessionId, operation: input.operation, keyHash,
      requestDigest: input.requestDigest, createdAt: input.now.toISOString(),
      claimExpiresAt: new Date(input.now.getTime() + (input.pendingLeaseSeconds ?? IDEMPOTENCY_PENDING_LEASE_SECONDS) * 1_000).toISOString(),
      expiresAt: new Date(input.now.getTime() + (input.retentionSeconds ?? 86_400) * 1_000).toISOString(),
    });
    return { ...result, keyHash };
  }

  async completeIdempotency(input: { readonly sessionId: PrivateRowId; readonly operation: string; readonly keyHash: string; readonly response: unknown }): Promise<void> {
    await this.store.completeIdempotency(input);
  }

  async releaseIdempotency(input: { readonly sessionId: PrivateRowId; readonly operation: string; readonly keyHash: string; readonly claimCreatedAt?: string }): Promise<void> {
    await this.store.releaseIdempotency(input);
  }
}
