import "server-only";

import type { QuotaAndIdempotencyService } from "./quota-core";
import { SESSION_CREATE_PER_HOUR } from "./quota-core";
import type { AnonymousSessionService, IssuedSession } from "./session-core";

export type SessionAdmissionResult =
  | { readonly status: "existing"; readonly csrfToken: string; readonly sessionAuthority: string; readonly expiresAt: string }
  | { readonly status: "created"; readonly issued: IssuedSession; readonly sessionAuthority: string }
  | { readonly status: "quota-exceeded" };

/** Existing-cookie recovery is read-only; only a genuinely new durable row consumes IP admission. */
export async function admitAnonymousSession(input: {
  readonly sessions: AnonymousSessionService;
  readonly quota: QuotaAndIdempotencyService;
  readonly existingToken?: string;
  readonly ipAddress: string;
  readonly now: Date;
}): Promise<SessionAdmissionResult> {
  if (input.existingToken) {
    try {
      const record = await input.sessions.verify(input.existingToken, input.now);
      return {
        status: "existing",
        csrfToken: input.sessions.csrfFor(record),
        sessionAuthority: input.sessions.authorityFor(record),
        expiresAt: record.expiresAt,
      };
    } catch { /* Invalid and expired cookies receive bounded replacement admission below. */ }
  }
  const admitted = await input.quota.consumeHourly({
    ownerKind: "ip-hmac",
    owner: input.ipAddress,
    policyKey: "session-create-v1",
    limit: SESSION_CREATE_PER_HOUR,
    now: input.now,
  });
  if (!admitted) return { status: "quota-exceeded" };
  const issued = await input.sessions.issue(input.now);
  return { status: "created", issued, sessionAuthority: input.sessions.authorityFor(issued.record) };
}
