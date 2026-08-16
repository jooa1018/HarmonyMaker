import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { semanticDigest, type SemanticDigest } from "../../domain/digest/canonical";
import type { PracticeSharePayload } from "../../domain/share";
import { MemoryGovernanceStore } from "../persistence/memory-store.test-adapter";
import type { PrivateRowId } from "../persistence/store";
import { MemoryOwnedObjectStore } from "../storage/memory-owned-object-store.test-adapter";
import { QuotaAndIdempotencyService, SHARE_CREATE_PER_HOUR } from "../security/quota-core";
import { createShareIdempotently } from "./idempotent-create";
import { readShareWithIpQuota } from "./quota-read";
import { ShareStoreService, decodeUrlShare, encodeUrlShare, SHARE_DEFAULT_TTL_DAYS } from "./share-store-core";

const digest = "0".repeat(64) as SemanticDigest;
const key = (fill: number) => Uint8Array.from({ length: 32 }, () => fill);
const owner = "private-session-row-one" as PrivateRowId;
const other = "private-session-row-two" as PrivateRowId;
const now = new Date("2026-01-01T00:00:00.000Z");

function payload(measureCount = 8): PracticeSharePayload {
  return {
    schemaVersion: 3, title: `Fixture ${measureCount}`, tempo: { beatUnit: 4, dotted: false, bpm: 80 },
    key: { tonic: { step: "C", alter: 0 }, mode: "major" }, presetId: "standard",
    arrangementArtifactDigest: digest, effectiveChordTimelineDigest: digest,
    arrangement: {
      measures: Array.from({ length: measureCount }, (_, index) => ({ index, sourceMeasureNumber: index + 1, lyricVerseIndex: 1, timeSignature: [4, 4] as const, duration: [4, 1] as const })),
      tracks: ["source-lead", "generated-harmony", "generated-harmony"].map((kind, track) => ({
        kind: kind as "source-lead" | "generated-harmony", label: `Track ${track}`,
        events: Array.from({ length: measureCount }, (_, index) => ({ kind: "note" as const, occurrenceIndex: index, offset: [0, 1] as const, duration: [4, 1] as const, pitch: [track === 0 ? "C" : track === 1 ? "E" : "G", 0, 4] as const, lyricTokenIds: [`ly:${index}`] })),
      })),
    },
    lyrics: Array.from({ length: measureCount }, (_, index) => ({ id: `ly:${index}`, text: `lyric-${index}`, verse: 1, syllabic: "single" as const, extend: false })),
    rightsShareConfirmed: true,
  };
}

describe("ShareStore and URL share", () => {
  it.each([8, 32, 64])("canonically round-trips the %i-measure/3-track fixture", (count) => {
    const encoded = encodeUrlShare(payload(count));
    expect(decodeUrlShare(encoded)).toEqual(payload(count));
  });

  it("uses the URL path when it fits and durable encryption only when required", async () => {
    const store = new MemoryGovernanceStore();
    const service = new ShareStoreService(store, key(1), key(2), key(3), key(4));
    const local = await service.create({ ownerSessionId: owner, payload: payload(8), rightsBasis: "self-authored", now });
    expect(local.kind).toBe("url");
    const durable = await service.create({ ownerSessionId: owner, payload: payload(64), rightsBasis: "self-authored", now, forceStore: true });
    expect(durable.kind).toBe("store");
    if (durable.kind !== "store") return;
    expect(durable.expiresAt).toBe(new Date(now.getTime() + SHARE_DEFAULT_TTL_DAYS * 86_400_000).toISOString());
    expect(await service.read(durable.token, now)).toEqual(payload(64));
    const raw = JSON.stringify([...store.shares.values()]);
    expect(raw).not.toContain(durable.token);
    expect(raw).not.toContain(durable.ownerDeleteSecret);
    expect(raw).not.toContain("Fixture 64");
  });

  it("fails closed for tampering, expiry, wrong delete secret, deletion, and unauthorized takedown", async () => {
    const store = new MemoryGovernanceStore();
    const service = new ShareStoreService(store, key(1), key(2), key(3), key(4));
    const created = await service.create({ ownerSessionId: owner, payload: payload(), rightsBasis: "self-authored", now, forceStore: true });
    if (created.kind !== "store") return;
    await expect(service.ownerDelete(created.token, "wrong", now)).rejects.toThrow("SHARE_UNAVAILABLE");
    await expect(service.takedown({ token: created.token, authorization: "wrong", now })).rejects.toThrow("INTERNAL_AUTHORITY_INVALID");
    await expect(service.read(created.token, new Date("2027-01-01T00:00:00.000Z"))).rejects.toThrow("SHARE_UNAVAILABLE");
    const record = [...store.shares.values()][0];
    const firstTagCharacter = record.encryptedPayload.authenticationTag[0];
    store.shares.set(record.id, { ...record, encryptedPayload: { ...record.encryptedPayload, authenticationTag: `${firstTagCharacter === "A" ? "B" : "A"}${record.encryptedPayload.authenticationTag.slice(1)}` } });
    await expect(service.read(created.token, now)).rejects.toThrow("SHARE_UNAVAILABLE");
    store.shares.set(record.id, record);
    await service.ownerDelete(created.token, created.ownerDeleteSecret, now);
    await expect(service.read(created.token, now)).rejects.toThrow("SHARE_UNAVAILABLE");
    await expect(service.ownerDelete(created.token, created.ownerDeleteSecret, now)).resolves.toBeUndefined();
  });

  it("accepts abuse reports without token enumeration and authorizes idempotent takedown", async () => {
    const store = new MemoryGovernanceStore();
    const service = new ShareStoreService(store, key(1), key(2), key(3), key(4));
    await expect(service.report({ token: "nonexistent", category: "copyright", now })).resolves.toEqual({ accepted: true });
    const created = await service.create({ ownerSessionId: owner, payload: payload(), rightsBasis: "self-authored", now, forceStore: true });
    if (created.kind !== "store") return;
    const authorization = Buffer.from(key(4)).toString("base64url");
    await service.takedown({ token: created.token, authorization, now });
    await service.takedown({ token: created.token, authorization, now });
    await expect(service.read(created.token, now)).rejects.toThrow("SHARE_UNAVAILABLE");
  });

  it("replays a completed create without consuming a new quota unit", async () => {
    const store = new MemoryGovernanceStore();
    const shares = new ShareStoreService(store, key(1), key(2), key(3), key(4));
    const quota = new QuotaAndIdempotencyService(store, key(5));
    const requestDigest = await semanticDigest({ payload: payload(), rightsBasis: "self-authored" });
    const common = { quota, shares, sessionId: owner, sessionQuotaOwner: "session-owner-hash", payload: payload(), rightsBasis: "self-authored" as const, idempotencyKey: "request-key-share-replay", requestDigest, now, forceStore: true };
    const created = await createShareIdempotently(common);
    expect(created).toMatchObject({ status: 201, body: { ok: true } });
    for (let count = 1; count < SHARE_CREATE_PER_HOUR; count += 1) {
      await expect(quota.consumeHourly({ ownerKind: "session", owner: common.sessionQuotaOwner, policyKey: "share-create-v1", limit: SHARE_CREATE_PER_HOUR, now })).resolves.toBe(true);
    }
    await expect(quota.consumeHourly({ ownerKind: "session", owner: common.sessionQuotaOwner, policyKey: "share-create-v1", limit: SHARE_CREATE_PER_HOUR, now })).resolves.toBe(false);
    await expect(createShareIdempotently(common)).resolves.toEqual({ ...created, status: 200 });
    const choice = (created.body as { share: { token: string; ownerDeleteSecret: string } }).share;
    const persistedReplay = JSON.stringify(store.idempotencyResponses());
    expect(persistedReplay).toContain("ciphertext");
    expect(persistedReplay).not.toContain(choice.token);
    expect(persistedReplay).not.toContain(choice.ownerDeleteSecret);
  });

  it("creates one durable effect under concurrent idempotent requests and replays the same secrets", async () => {
    const store = new MemoryGovernanceStore();
    const shares = new ShareStoreService(store, key(1), key(2), key(3), key(4));
    const quota = new QuotaAndIdempotencyService(store, key(5));
    const requestDigest = await semanticDigest({ payload: payload(64), rightsBasis: "self-authored" });
    const common = { quota, shares, sessionId: owner, sessionQuotaOwner: "session-concurrent", payload: payload(64), rightsBasis: "self-authored" as const, idempotencyKey: "request-key-concurrent", requestDigest, now, forceStore: true };
    const results = await Promise.all(Array.from({ length: 10 }, () => createShareIdempotently(common)));
    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    expect(results.filter((result) => result.status === 409)).toHaveLength(9);
    expect(store.shares.size).toBe(1);
    const created = results.find((result) => result.status === 201)!;
    const replay = await createShareIdempotently(common);
    expect(replay).toEqual({ ...created, status: 200 });
    expect(store.shares.size).toBe(1);
  });

  it("rolls back a staged durable effect when completion crashes and recovers without duplication", async () => {
    const store = new MemoryGovernanceStore();
    const shares = new ShareStoreService(store, key(1), key(2), key(3), key(4));
    const quota = new QuotaAndIdempotencyService(store, key(5));
    const requestDigest = await semanticDigest({ payload: payload(64), rightsBasis: "self-authored" });
    const common = { quota, shares, sessionId: owner, sessionQuotaOwner: "session-crash", payload: payload(64), rightsBasis: "self-authored" as const, idempotencyKey: "request-key-crash-recovery", requestDigest, now, forceStore: true };
    store.failNextIdempotentShareCommit = true;
    await expect(createShareIdempotently(common)).rejects.toThrow("SIMULATED_CRASH_AFTER_EFFECT_BEFORE_COMMIT");
    expect(store.shares.size).toBe(0);
    expect(store.idempotencyResponses()).toEqual([]);
    const recovered = await createShareIdempotently(common);
    expect(recovered).toMatchObject({ status: 201, body: { ok: true, share: { kind: "store" } } });
    expect(store.shares.size).toBe(1);
    await expect(createShareIdempotently(common)).resolves.toEqual({ ...recovered, status: 200 });
    expect(store.shares.size).toBe(1);
  });

  it("fences an expired worker after a pending claim is recovered", async () => {
    const store = new MemoryGovernanceStore();
    const shares = new ShareStoreService(store, key(1), key(2), key(3), key(4));
    const quota = new QuotaAndIdempotencyService(store, key(5));
    const requestDigest = await semanticDigest({ payload: payload(64), rightsBasis: "self-authored" });
    const claimInput = { sessionId: owner, operation: "share-create-v1", key: "request-key-stale-worker", requestDigest, pendingLeaseSeconds: 5 } as const;
    const stale = await quota.claimIdempotency({ ...claimInput, now });
    const recovered = await quota.claimIdempotency({ ...claimInput, now: new Date(now.getTime() + 5_000) });
    expect(stale.status).toBe("claimed");
    expect(recovered.status).toBe("claimed");
    if (stale.status !== "claimed" || recovered.status !== "claimed") return;
    const create = (claim: typeof stale) => shares.createAndCompleteIdempotency({
      ownerSessionId: owner, payload: payload(64), rightsBasis: "self-authored", now, forceStore: true,
      idempotency: { operation: claimInput.operation, keyHash: claim.keyHash, requestDigest, claimCreatedAt: claim.claimCreatedAt },
    });
    await expect(create(stale)).rejects.toThrow("IDEMPOTENCY_NOT_CLAIMED");
    expect(store.shares.size).toBe(0);
    await expect(create(recovered)).resolves.toMatchObject({ ok: true, share: { kind: "store" } });
    expect(store.shares.size).toBe(1);
  });

  it("applies the ShareStore read limit to an IP-HMAC owner without retaining the raw IP", async () => {
    const store = new MemoryGovernanceStore();
    const shares = new ShareStoreService(store, key(1), key(2), key(3), key(4));
    const quota = new QuotaAndIdempotencyService(store, key(5));
    const created = await shares.create({ ownerSessionId: owner, payload: payload(64), rightsBasis: "self-authored", now, forceStore: true });
    if (created.kind !== "store") return;
    for (let count = 0; count < 120; count += 1) {
      await expect(readShareWithIpQuota({ quota, shares, token: created.token, ipAddress: "192.0.2.44", now })).resolves.toMatchObject({ status: "ok" });
    }
    await expect(readShareWithIpQuota({ quota, shares, token: created.token, ipAddress: "192.0.2.44", now })).resolves.toEqual({ status: "quota-exceeded" });
    expect(JSON.stringify(store)).not.toContain("192.0.2.44");
  });
});

describe("owned object-store boundary", () => {
  it("enforces ownership, integrity, opaque keys, retention metadata, and idempotent delete", async () => {
    const records = new MemoryGovernanceStore();
    const objects = new MemoryOwnedObjectStore(records);
    const created = await objects.put({ ownerSessionId: owner, bytes: new TextEncoder().encode("bytes"), contentType: "application/octet-stream", expiresAt: "2026-02-01T00:00:00.000Z" });
    expect(created.objectKey).toMatch(/^objects\/[A-Za-z0-9_-]{20,}$/u);
    expect(created.objectKey).not.toContain(String(owner));
    expect(await objects.get(created.id, owner)).toMatchObject({ contentType: "application/octet-stream" });
    await expect(objects.get(created.id, other)).rejects.toThrow("OBJECT_UNAVAILABLE");
    expect(await objects.head(created.id, owner)).toMatchObject({ byteSize: 5, expiresAt: "2026-02-01T00:00:00.000Z" });
    await objects.delete(created.id, owner, now);
    await objects.delete(created.id, owner, now);
    await expect(objects.get(created.id, owner)).rejects.toThrow("OBJECT_UNAVAILABLE");
  });
});
