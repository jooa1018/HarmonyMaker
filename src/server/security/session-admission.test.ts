import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MemoryGovernanceStore } from "../persistence/memory-store.test-adapter";
import { QuotaAndIdempotencyService, SESSION_CREATE_PER_HOUR } from "./quota-core";
import { admitAnonymousSession } from "./session-admission";
import { AnonymousSessionService, SESSION_TTL_SECONDS } from "./session-core";

const key = (fill: number) => Uint8Array.from({ length: 32 }, () => fill);
const now = new Date("2026-01-01T00:00:00.000Z");

describe("anonymous session durable-row admission", () => {
  it("replays a valid cookie without consuming new-session IP quota", async () => {
    const store = new MemoryGovernanceStore();
    const sessions = new AnonymousSessionService(store, key(1), key(2), false);
    const quota = new QuotaAndIdempotencyService(store, key(3));
    const issued = await sessions.issue(now);
    for (let count = 0; count < 20; count += 1) {
      await expect(admitAnonymousSession({ sessions, quota, existingToken: issued.token, ipAddress: "192.0.2.1", now })).resolves.toMatchObject({ status: "existing", sessionAuthority: sessions.authorityFor(issued.record) });
    }
    expect(store.sessions.size).toBe(1);
    for (let count = 0; count < SESSION_CREATE_PER_HOUR; count += 1) {
      await expect(quota.consumeHourly({ ownerKind: "ip-hmac", owner: "192.0.2.1", policyKey: "session-create-v1", limit: SESSION_CREATE_PER_HOUR, now })).resolves.toBe(true);
    }
  });

  it("bounds cookie-less durable row creation and expires rows on the 30-day retention contract", async () => {
    const store = new MemoryGovernanceStore();
    const sessions = new AnonymousSessionService(store, key(1), key(2), false);
    const quota = new QuotaAndIdempotencyService(store, key(3));
    const results = [];
    for (let count = 0; count < SESSION_CREATE_PER_HOUR + 1; count += 1) {
      results.push(await admitAnonymousSession({ sessions, quota, ipAddress: "192.0.2.2", now }));
    }
    expect(results.filter((result) => result.status === "created")).toHaveLength(SESSION_CREATE_PER_HOUR);
    expect(results.at(-1)).toEqual({ status: "quota-exceeded" });
    expect(store.sessions.size).toBe(SESSION_CREATE_PER_HOUR);
    const cleanup = await store.cleanup({ now: new Date(now.getTime() + SESSION_TTL_SECONDS * 1_000 + 1).toISOString(), batchSize: 50, dryRun: false });
    expect(cleanup.expiredSessionIds).toHaveLength(SESSION_CREATE_PER_HOUR);
  });
});
