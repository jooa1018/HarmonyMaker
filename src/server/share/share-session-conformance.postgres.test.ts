import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { Pool } from "pg";
import { semanticDigest, type SemanticDigest } from "../../domain/digest/canonical";
import type { PracticeSharePayload } from "../../domain/share";
import { applyMigrations } from "../persistence/migrations";
import { MemoryGovernanceStore } from "../persistence/memory-store.test-adapter";
import { PostgresGovernanceStore } from "../persistence/postgres-store";
import type { GovernanceStore } from "../persistence/store";
import { QuotaAndIdempotencyService } from "../security/quota-core";
import { AnonymousSessionService } from "../security/session-core";
import { createShareIdempotently } from "./idempotent-create";
import { readShareWithIpQuota } from "./quota-read";
import { ShareStoreService } from "./share-store-core";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL_REQUIRED_FOR_POSTGRES_INTEGRATION");
const admin = new Pool({ connectionString: databaseUrl, max: 1 });
let schemaSequence = 0;
const key = (fill: number) => Uint8Array.from({ length: 32 }, () => fill);
const now = new Date("2026-01-01T00:00:00.000Z");
const digest = "0".repeat(64) as SemanticDigest;

function payload(title: string): PracticeSharePayload {
  return {
    schemaVersion: 3, title, tempo: { beatUnit: 4, dotted: false, bpm: 80 },
    key: { tonic: { step: "C", alter: 0 }, mode: "major" }, presetId: "standard",
    arrangementArtifactDigest: digest, effectiveChordTimelineDigest: digest,
    arrangement: {
      measures: [{ index: 0, sourceMeasureNumber: 1, lyricVerseIndex: 1, timeSignature: [4, 4], duration: [4, 1] }],
      tracks: [{ kind: "source-lead", label: "Lead", events: [{ kind: "note", occurrenceIndex: 0, offset: [0, 1], duration: [4, 1], pitch: ["C", 0, 4] }] }],
    },
    lyrics: [], rightsShareConfirmed: true,
  };
}

interface Harness {
  readonly store: GovernanceStore;
  readonly activeShareCount: () => Promise<number>;
  readonly auditKinds: () => Promise<readonly string[]>;
  readonly close: () => Promise<void>;
}

async function memoryHarness(): Promise<Harness> {
  const store = new MemoryGovernanceStore();
  return {
    store,
    activeShareCount: async () => [...store.shares.values()].filter((record) => record.lifecycle === "active").length,
    auditKinds: async () => store.audits.map((audit) => String(audit.eventKind)),
    close: async () => undefined,
  };
}

async function postgresHarness(): Promise<Harness> {
  schemaSequence += 1;
  const schema = `hm_share_conformance_${process.pid}_${Date.now()}_${schemaSequence}`;
  if (!/^hm_share_conformance_[0-9_]+$/u.test(schema)) throw new Error("TEST_SCHEMA_INVALID");
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: databaseUrl, max: 10, options: `-c search_path=${schema} -c timezone=UTC` });
  await applyMigrations(pool);
  return {
    store: new PostgresGovernanceStore(pool),
    activeShareCount: async () => Number((await pool.query("SELECT count(*)::int AS count FROM share_records WHERE lifecycle='active'")).rows[0].count),
    auditKinds: async () => (await pool.query("SELECT event_kind FROM audit_events ORDER BY id")).rows.map((row) => String(row.event_kind)),
    close: async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); },
  };
}

async function runShareSessionConformance(makeHarness: () => Promise<Harness>): Promise<void> {
  const harness = await makeHarness();
  try {
    const sessions = new AnonymousSessionService(harness.store, key(1), key(2), false);
    const quota = new QuotaAndIdempotencyService(harness.store, key(3));
    const shares = new ShareStoreService(harness.store, key(4), key(5), key(6), key(7));
    const authorization = Buffer.from(key(7)).toString("base64url");

    const firstSession = await sessions.issue(now);
    expect(await sessions.verify(firstSession.token, now)).toEqual(firstSession.record);
    expect(sessions.authorityFor(firstSession.record)).toBe(sessions.authorityFor(firstSession.record));
    await expect(sessions.authorizeMutation({ sessionToken: firstSession.token, csrfToken: firstSession.csrfToken, origin: "https://hm.test", host: "hm.test", now })).resolves.toEqual(firstSession.record);
    const rotated = await sessions.rotate(firstSession.token, new Date(now.getTime() + 1_000));
    await expect(sessions.verify(firstSession.token, new Date(now.getTime() + 2_000))).rejects.toThrow("SESSION_INVALID");

    const sharePayload = payload("response-loss-recovery");
    const requestDigest = await semanticDigest({ payload: sharePayload, rightsBasis: "self-authored" });
    const common = {
      quota, shares, sessionId: rotated.record.id, sessionQuotaOwner: rotated.record.tokenHash,
      payload: sharePayload, rightsBasis: "self-authored" as const, idempotencyKey: "request-key-response-loss",
      requestDigest, now, forceStore: true,
    };
    const committedResponseWhoseAckWasLost = await createShareIdempotently(common);
    expect(committedResponseWhoseAckWasLost.status).toBe(201);
    const replay = await createShareIdempotently(common);
    expect(replay).toEqual({ ...committedResponseWhoseAckWasLost, status: 200 });
    expect(await harness.activeShareCount()).toBe(1);
    await expect(createShareIdempotently({ ...common, requestDigest: await semanticDigest({ changed: true }) })).resolves.toMatchObject({ status: 409, body: { error: { code: "IDEMPOTENCY_CONFLICT" } } });

    const concurrentPayload = payload("concurrent");
    const concurrentCommon = { ...common, payload: concurrentPayload, idempotencyKey: "request-key-concurrent", requestDigest: await semanticDigest({ payload: concurrentPayload, rightsBasis: "self-authored" }) };
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => createShareIdempotently(concurrentCommon)));
    expect(concurrent.filter((result) => result.status === 201)).toHaveLength(1);
    // A waiter may observe pending (409) or the just-committed replay (200); both stores must expose one exact effect.
    expect(concurrent.filter((result) => result.status === 200 || result.status === 409)).toHaveLength(7);
    const concurrentCreated = concurrent.find((result) => result.status === 201)!;
    for (const result of concurrent.filter((candidate) => candidate.status === 200)) expect(result.body).toEqual(concurrentCreated.body);
    expect(await harness.activeShareCount()).toBe(2);

    const quotaResults = await Promise.all(Array.from({ length: 20 }, () => quota.consumeHourly({ ownerKind: "ip-hmac", owner: "192.0.2.80", policyKey: "conformance-v1", limit: 3, now })));
    expect(quotaResults.filter(Boolean)).toHaveLength(3);

    const replayChoice = (replay.body as { share: { token: string; ownerDeleteSecret: string } }).share;
    for (let count = 0; count < 120; count += 1) await expect(readShareWithIpQuota({ quota, shares, token: replayChoice.token, ipAddress: "192.0.2.81", now })).resolves.toMatchObject({ status: "ok" });
    await expect(readShareWithIpQuota({ quota, shares, token: replayChoice.token, ipAddress: "192.0.2.81", now })).resolves.toEqual({ status: "quota-exceeded" });

    await shares.report({ token: replayChoice.token, reporterSessionId: rotated.record.id, category: "copyright", detail: "conformance", now });
    const reports = await shares.listModerationReports({ authorization, status: "pending" });
    expect(reports).toHaveLength(1);
    const claimRace = await Promise.allSettled([
      shares.claimModerationReport({ authorization, reportId: reports[0].id, moderatorId: "moderator-A", now }),
      shares.claimModerationReport({ authorization, reportId: reports[0].id, moderatorId: "moderator-B", now }),
    ]);
    expect(claimRace.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const claim = claimRace.find((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof shares.claimModerationReport>>> => result.status === "fulfilled")!.value;
    await shares.resolveModerationReport({ authorization, reportId: reports[0].id, claimToken: claim.claimToken, resolution: "takedown", now });
    await expect(shares.read(replayChoice.token, now)).rejects.toThrow("SHARE_UNAVAILABLE");

    const ownerDeleteChoice = await shares.create({ ownerSessionId: rotated.record.id, payload: payload("owner-delete"), rightsBasis: "self-authored", now, forceStore: true });
    expect(ownerDeleteChoice.kind).toBe("store");
    if (ownerDeleteChoice.kind === "store") {
      await shares.ownerDelete(ownerDeleteChoice.token, ownerDeleteChoice.ownerDeleteSecret, now);
      await expect(shares.read(ownerDeleteChoice.token, now)).rejects.toThrow("SHARE_UNAVAILABLE");
    }
    expect(await harness.auditKinds()).toEqual(expect.arrayContaining(["share-abuse-report", "share-moderation-claim", "share-moderation-resolve", "share-owner-delete"]));

    const cleanupAt = new Date(now.getTime() + 181 * 86_400_000).toISOString();
    const cleanup = await Promise.all([
      harness.store.cleanup({ now: cleanupAt, batchSize: 100, dryRun: false }),
      harness.store.cleanup({ now: cleanupAt, batchSize: 100, dryRun: false }),
    ]);
    expect(new Set(cleanup.flatMap((result) => result.expiredShareIds)).size).toBe(cleanup.flatMap((result) => result.expiredShareIds).length);
    expect(cleanup.reduce((sum, result) => sum + result.removedIdempotencyCount, 0)).toBeGreaterThanOrEqual(2);
    await expect(sessions.verify(rotated.token, new Date(cleanupAt))).rejects.toThrow("SESSION_INVALID");
  } finally { await harness.close(); }
}

describe("Memory/PostgreSQL share-session conformance", () => {
  it("runs the exact conformance campaign against Memory", async () => { await runShareSessionConformance(memoryHarness); });
  it("runs the exact conformance campaign against actual PostgreSQL 17", async () => { await runShareSessionConformance(postgresHarness); }, 30_000);
});

describe("PostgreSQL harness lifecycle", () => {
  it("keeps the integration database connection explicit", () => { expect(databaseUrl).toMatch(/^postgres(?:ql)?:\/\//u); });
});

afterAll(async () => { await admin.end(); });
