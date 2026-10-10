import { expect, it } from "vitest";
import { MemoryGovernanceStore } from "../persistence/memory-store.test-adapter";
import type { DurableShareRecord } from "../persistence/store";

it("erases ciphertext while retaining owner tombstone and protects referenced expired sessions", async () => {
  const store = new MemoryGovernanceStore();
  const session = await store.createSession({ tokenHash: "owner", csrfNonce: "nonce", createdAt: "2024-01-01T00:00:00.000Z", expiresAt: "2024-02-01T00:00:00.000Z" });
  const share = await store.createShare({ ownerSessionId: session.id, tokenHash: "share", deleteSecretVerifier: "verifier", payloadDigest: "digest", encryptedPayload: {} as DurableShareRecord["encryptedPayload"], plaintextSize: 1, rightsBasis: "self-authored", lifecycle: "active", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-06-01T00:00:00.000Z" });
  await store.transitionShare({ id: share.id, lifecycle: "deleted", at: "2026-02-01T00:00:00.000Z" });
  expect(await store.findShareByTokenHash("share")).toMatchObject({ encryptedPayload: null, lifecycle: "deleted" });
  await store.cleanup({ now: "2026-06-30T00:00:00.000Z", batchSize: 50, dryRun: false });
  expect(await store.findSessionByTokenHash("owner")).toBeDefined();
  const result = await store.cleanup({ now: "2026-07-01T00:00:00.000Z", batchSize: 50, dryRun: false });
  expect(result).toMatchObject({ removedShareCount: 1, removedSessionCount: 1 });
  expect(await store.findShareByTokenHash("share")).toBeUndefined();
});
