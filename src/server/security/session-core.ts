import { generateOpaqueToken, keyedTokenHash, timingSafeHashEquals } from "./crypto-core";
import type { GovernanceStore, SessionRecord } from "../persistence/store";

export const SESSION_COOKIE_NAME = "hm_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export interface IssuedSession {
  readonly token: string;
  readonly csrfToken: string;
  readonly record: SessionRecord;
  readonly cookie: string;
}

export interface MutationRequestEvidence {
  readonly sessionToken?: string;
  readonly csrfToken?: string;
  readonly origin?: string;
  readonly host?: string;
  readonly forwardedHost?: string;
  readonly now: Date;
}

export class SessionSecurityError extends Error {
  constructor(readonly code: "SESSION_INVALID" | "CSRF_INVALID" | "ORIGIN_INVALID") {
    super(code);
    this.name = "SessionSecurityError";
  }
}

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/u, "");
}

export class AnonymousSessionService {
  constructor(
    private readonly store: GovernanceStore,
    private readonly sessionHashKey: Uint8Array,
    private readonly csrfKey: Uint8Array,
    private readonly production: boolean,
  ) {}

  private tokenHash(token: string): string { return keyedTokenHash(token, this.sessionHashKey, "anonymous-session-v1"); }
  private csrfToken(record: SessionRecord): string { return keyedTokenHash(`${record.tokenHash}:${record.csrfNonce}`, this.csrfKey, "csrf-v1"); }
  csrfFor(record: SessionRecord): string { return this.csrfToken(record); }
  authorityFor(record: SessionRecord): string { return keyedTokenHash(record.tokenHash, this.csrfKey, "anonymous-session-authority-v1"); }

  async issue(now = new Date()): Promise<IssuedSession> {
    const token = generateOpaqueToken();
    const csrfNonce = generateOpaqueToken(16);
    const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1_000);
    const record = await this.store.createSession({
      tokenHash: this.tokenHash(token), csrfNonce, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString(),
    });
    return {
      token,
      csrfToken: this.csrfToken(record),
      record,
      cookie: `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${this.production ? "; Secure" : ""}`,
    };
  }

  async verify(token: string | undefined, now = new Date()): Promise<SessionRecord> {
    if (!token) throw new SessionSecurityError("SESSION_INVALID");
    const record = await this.store.findSessionByTokenHash(this.tokenHash(token));
    if (!record || record.revokedAt || record.expiresAt <= now.toISOString()) throw new SessionSecurityError("SESSION_INVALID");
    return record;
  }

  async rotate(token: string, now = new Date()): Promise<IssuedSession> {
    const current = await this.verify(token, now);
    await this.store.revokeSession(current.id, now.toISOString());
    return this.issue(now);
  }

  async authorizeMutation(evidence: MutationRequestEvidence): Promise<SessionRecord> {
    const host = normalizeHost(evidence.forwardedHost ?? evidence.host ?? "");
    if (!evidence.origin || !host) throw new SessionSecurityError("ORIGIN_INVALID");
    let originHost: string;
    try { originHost = normalizeHost(new URL(evidence.origin).host); } catch { throw new SessionSecurityError("ORIGIN_INVALID"); }
    if (originHost !== host) throw new SessionSecurityError("ORIGIN_INVALID");
    const record = await this.verify(evidence.sessionToken, evidence.now);
    const expected = this.csrfToken(record);
    if (!evidence.csrfToken || !timingSafeHashEquals(expected, evidence.csrfToken)) throw new SessionSecurityError("CSRF_INVALID");
    return record;
  }
}
