import { describe, expect, it } from "vitest";

import { semanticDigest } from "../../domain/digest/canonical";
import { MemoryGovernanceStore } from "../persistence/memory-store.test-adapter";
import { decryptAeadV1, encryptAeadV1, keyedTokenHash } from "./crypto-core";
import { QuotaAndIdempotencyService } from "./quota-core";
import { AnonymousSessionService, SessionSecurityError } from "./session-core";

const key = (fill: number) => Uint8Array.from({ length: 32 }, () => fill);
const now = new Date("2026-01-01T00:00:00.000Z");

describe("anonymous session, origin, CSRF, quota, and idempotency", () => {
  it("issues opaque sessions with hardened cookies and stores only a token hash", async () => {
    const store = new MemoryGovernanceStore();
    const service = new AnonymousSessionService(store, key(1), key(2), true);
    const issued = await service.issue(now);
    expect(Buffer.from(issued.token, "base64url").byteLength).toBeGreaterThanOrEqual(16);
    expect(issued.cookie).toContain("HttpOnly");
    expect(issued.cookie).toContain("SameSite=Lax");
    expect(issued.cookie).toContain("Path=/");
    expect(issued.cookie).toContain("Secure");
    expect(JSON.stringify([...store.sessions.values()])).not.toContain(issued.token);
    expect(await service.verify(issued.token, now)).toEqual(issued.record);
  });

  it("rejects expiry, revocation, fixation/cross-session CSRF, and foreign origins", async () => {
    const store = new MemoryGovernanceStore();
    const service = new AnonymousSessionService(store, key(1), key(2), false);
    const first = await service.issue(now);
    const second = await service.issue(now);
    const valid = { sessionToken: first.token, csrfToken: first.csrfToken, origin: "https://hm.example", host: "hm.example", now };
    await expect(service.authorizeMutation(valid)).resolves.toEqual(first.record);
    await expect(service.authorizeMutation({ ...valid, csrfToken: second.csrfToken })).rejects.toMatchObject({ code: "CSRF_INVALID" });
    await expect(service.authorizeMutation({ ...valid, origin: "https://foreign.example" })).rejects.toMatchObject({ code: "ORIGIN_INVALID" });
    await expect(service.authorizeMutation({ ...valid, origin: undefined })).rejects.toBeInstanceOf(SessionSecurityError);
    const rotated = await service.rotate(first.token, new Date(now.getTime() + 1_000));
    await expect(service.verify(first.token, new Date(now.getTime() + 2_000))).rejects.toMatchObject({ code: "SESSION_INVALID" });
    await expect(service.verify(rotated.token, new Date("2027-01-01T00:00:00.000Z"))).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("enforces a concurrent hourly limit and isolates raw IP and sessions", async () => {
    const store = new MemoryGovernanceStore();
    const service = new QuotaAndIdempotencyService(store, key(3));
    const results = await Promise.all(Array.from({ length: 20 }, () => service.consumeHourly({ ownerKind: "ip-hmac", owner: "::ffff:192.0.2.1", policyKey: "share-create-v1", limit: 3, now })));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(JSON.stringify(store)).not.toContain("192.0.2.1");
    await expect(service.consumeHourly({ ownerKind: "session", owner: "session-B", policyKey: "share-create-v1", limit: 3, now })).resolves.toBe(true);
  });

  it("prevents duplicate idempotent effects and rejects payload/key conflicts", async () => {
    const store = new MemoryGovernanceStore();
    const sessions = new AnonymousSessionService(store, key(1), key(2), false);
    const quota = new QuotaAndIdempotencyService(store, key(3));
    const session = await sessions.issue(now);
    const digestA = await semanticDigest({ value: "A" });
    const digestB = await semanticDigest({ value: "B" });
    const claims = await Promise.all(Array.from({ length: 10 }, () => quota.claimIdempotency({ sessionId: session.record.id, operation: "create-share", key: "request-key-0001", requestDigest: digestA, now })));
    expect(claims.filter((claim) => claim.status === "claimed")).toHaveLength(1);
    expect(claims.filter((claim) => claim.status === "pending")).toHaveLength(9);
    await store.completeIdempotency({ sessionId: session.record.id, operation: "create-share", keyHash: claims[0].keyHash, response: { ok: true } });
    await expect(quota.claimIdempotency({ sessionId: session.record.id, operation: "create-share", key: "request-key-0001", requestDigest: digestA, now })).resolves.toMatchObject({ status: "replay", response: { ok: true } });
    await expect(quota.claimIdempotency({ sessionId: session.record.id, operation: "create-share", key: "request-key-0001", requestDigest: digestB, now })).resolves.toMatchObject({ status: "conflict" });
  });
});

describe("versioned authenticated encryption", () => {
  it("round-trips, uses fresh nonces, and rejects tampering and versions", () => {
    const plaintext = new TextEncoder().encode("canonical plaintext");
    const first = encryptAeadV1(plaintext, key(4));
    const second = encryptAeadV1(plaintext, key(4));
    expect(first.nonce).not.toBe(second.nonce);
    expect(decryptAeadV1(first, key(4))).toEqual(plaintext);
    const tampered = { ...first, ciphertext: `${first.ciphertext[0] === "A" ? "B" : "A"}${first.ciphertext.slice(1)}` };
    expect(() => decryptAeadV1(tampered, key(4))).toThrow("AEAD_AUTHENTICATION_FAILED");
    expect(() => decryptAeadV1({ ...first, version: 2 } as never, key(4))).toThrow("AEAD_ENVELOPE_VERSION_UNSUPPORTED");
    expect(keyedTokenHash("same", key(4), "share")).not.toBe(keyedTokenHash("same", key(4), "delete"));
  });
});
