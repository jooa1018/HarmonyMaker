import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { Pool } from "pg";

import type { SemanticDigest } from "../../domain/digest/canonical";
import type { PrivateRowId } from "../persistence/store";
import { applyMigrationsWithClient, MIGRATIONS } from "../persistence/migrations";
import { PostgresOmrCreateRecoveryRegistry, withCrossSessionOmrCreateRecovery } from "./cross-session-create-recovery";
import { PostgresOmrStore } from "./postgres-store";
import type { DurableOmrJobRecord, OmrStore } from "./store";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL_REQUIRED_FOR_POSTGRES_INTEGRATION");
const schema = `hm_omr_recovery_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl, max: 1 });
const pool = new Pool({ connectionString: databaseUrl, max: 8, options: `-c search_path=${schema} -c timezone=UTC` });
const requestDigest = "c".repeat(64) as SemanticDigest;
const replayEnvelope = {
  version: 1 as const,
  algorithm: "aes-256-gcm" as const,
  associatedDataVersion: "cross-session-test",
  ciphertext: "ciphertext",
  nonce: "AAAAAAAAAAAAAAAA",
  authenticationTag: "AAAAAAAAAAAAAAAAAAAAAA",
};
const quota = {
  maxConcurrentJobsPerSession: 10,
  maxConcurrentJobsPerIp: 10,
  maxJobsPerSessionPerHour: 100,
  maxJobsPerIpPerHour: 100,
  dailyGlobalCreditCeiling: 100,
  maxPagesPerJob: 12,
  maxRetriesPerPage: 3,
};

function record(ownerSessionId: PrivateRowId, now: string, key: string): Omit<DurableOmrJobRecord, "id"> {
  const consentDigest = "a".repeat(64) as DurableOmrJobRecord["capabilitySnapshotDigest"];
  return {
    ownerSessionId,
    ipOwnerHash: `ip:${ownerSessionId}`,
    publicHandleHash: `handle:${key}`,
    publicHandleReplayEnvelope: replayEnvelope,
    handleExpiresAt: "2026-01-03T00:00:00.000Z",
    sourceKind: "camera-photo",
    pageCount: 1,
    canonicalCreateRequest: {
      pageCount: 1,
      pages: [{ pageIndex: 0, pageDigest: "b".repeat(64) as never, mimeType: "image/png" }],
      sourceKind: "camera-photo",
      rights: { basis: "self-authored", allowedUses: ["provider-transfer"] },
      providerTransferConsent: true,
      consentCapabilitySnapshotDigest: consentDigest,
      idempotencyKey: key,
    },
    state: "created",
    rights: { basis: "self-authored", allowedUses: ["provider-transfer"] },
    providerTransferConsent: true,
    providerConsentRecordedAt: now,
    capabilities: {
      vendorId: "integration-provider",
      vendorDisplayName: "PostgreSQL integration provider",
      supportedMimeTypes: ["image/png"],
      transferMimeType: "image/png",
      maxPages: 12,
      evidenceGranularity: "page",
      retentionDisclosure: true,
      supportsIdempotency: true,
      supportsInteractiveInput: false,
      supportsDeletion: true,
      canDeleteImmediately: true,
      retentionPolicyReference: "integration-only",
      externalTransfer: true,
      estimatedCreditPerPage: 1,
    },
    capabilitySnapshotDigest: consentDigest,
    providerBindingId: "integration-provider",
    adapterContractVersion: "omr-vendor-adapter-v1",
    vendorCreateIdempotencyKey: `vendor:${key}`,
    vendorCreateLeaseExpiresAt: new Date(new Date(now).getTime() + 5 * 60 * 1_000).toISOString(),
    vendorCreateOutcomeState: "not-attempted",
    creditEstimate: 1,
    creditState: "reserved",
    pages: [],
    vendorDeleteState: "not-started",
    localDeleteState: "not-started",
    handleActive: true,
    createdAt: now,
    updatedAt: now,
  };
}

async function session(key: string): Promise<PrivateRowId> {
  const result = await pool.query(
    "INSERT INTO anonymous_sessions (token_hash,csrf_nonce,created_at,expires_at) VALUES ($1,$2,$3,$4) RETURNING id",
    [`token:${key}`, `csrf:${key}`, "2025-12-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"],
  );
  return String(result.rows[0].id) as PrivateRowId;
}

function claim(store: OmrStore, ownerSessionId: PrivateRowId, key: string, digest = requestDigest) {
  const now = "2026-01-01T00:00:00.000Z";
  const durable = record(ownerSessionId, now, key);
  return store.claimCreate({
    ownerSessionId,
    ipOwnerHash: durable.ipOwnerHash,
    idempotencyKeyHash: `idempotency:${key}`,
    requestDigest: digest,
    record: durable,
    quota,
    now,
  });
}

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const client = await pool.connect();
  try { await applyMigrationsWithClient(client, MIGRATIONS); }
  finally { client.release(); }
});

beforeEach(async () => {
  await pool.query("TRUNCATE TABLE anonymous_sessions RESTART IDENTITY CASCADE");
});

afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
});

describe("actual PostgreSQL cross-session OMR create recovery", () => {
  it("recovers a committed S1 job under S2 and persists an exact handle alias", async () => {
    const base = new PostgresOmrStore(pool);
    const store = withCrossSessionOmrCreateRecovery(base, new PostgresOmrCreateRecoveryRegistry(pool));
    const s1 = await session("s1");
    const s2 = await session("s2");
    const created = await claim(store, s1, "replacement");
    if (created.status !== "claimed") throw new Error(`CREATE_FAILED:${created.status}`);
    await pool.query(
      `UPDATE omr_jobs SET vendor_create_outcome_state='confirmed',vendor_job_id_envelope=$2 WHERE id=$1`,
      [created.job.id, JSON.stringify(replayEnvelope)],
    );
    await pool.query("UPDATE omr_create_idempotency SET state='complete' WHERE job_id=$1", [created.job.id]);

    const recovered = await store.inspectCreate({
      ownerSessionId: s2,
      idempotencyKeyHash: "idempotency:replacement",
      requestDigest,
      vendorCreateLeaseExpiresAt: "2026-01-01T00:10:00.000Z",
      now: "2026-01-01T00:01:00.000Z",
    });
    expect(recovered.status).toBe("replay");
    await expect(store.findOwnedByHandleHash("handle:replacement", s2)).resolves.toMatchObject({ id: created.job.id });
    expect(Number((await pool.query("SELECT count(*)::int AS count FROM omr_jobs")).rows[0].count)).toBe(1);
    expect(Number((await pool.query("SELECT count(*)::int AS count FROM idempotency_records WHERE operation='omr-session-alias-v1'")).rows[0].count)).toBe(1);
  });

  it("serializes concurrent S1/S2 first claims for one K into one row and reservation", async () => {
    const s1 = await session("race-s1");
    const s2 = await session("race-s2");
    const store1 = withCrossSessionOmrCreateRecovery(new PostgresOmrStore(pool), new PostgresOmrCreateRecoveryRegistry(pool));
    const store2 = withCrossSessionOmrCreateRecovery(new PostgresOmrStore(pool), new PostgresOmrCreateRecoveryRegistry(pool));
    const [one, two] = await Promise.all([
      claim(store1, s1, "race"),
      claim(store2, s2, "race"),
    ]);
    expect([one.status, two.status].filter((status) => status === "claimed")).toHaveLength(1);
    expect([one.status, two.status].filter((status) => status === "pending")).toHaveLength(1);
    expect(Number((await pool.query("SELECT count(*)::int AS count FROM omr_jobs")).rows[0].count)).toBe(1);
    expect(Number((await pool.query("SELECT count(*)::int AS count FROM omr_create_idempotency")).rows[0].count)).toBe(1);
    expect(Number((await pool.query("SELECT count(*)::int AS count FROM omr_jobs WHERE credit_state='reserved'")).rows[0].count)).toBe(1);
  });

  it("returns conflict for the recovered K with a different request digest", async () => {
    const store = withCrossSessionOmrCreateRecovery(new PostgresOmrStore(pool), new PostgresOmrCreateRecoveryRegistry(pool));
    const s1 = await session("conflict-s1");
    const s2 = await session("conflict-s2");
    const created = await claim(store, s1, "conflict");
    expect(created.status).toBe("claimed");
    const conflict = await claim(store, s2, "conflict", "d".repeat(64) as SemanticDigest);
    expect(conflict.status).toBe("conflict");
    expect(Number((await pool.query("SELECT count(*)::int AS count FROM omr_jobs")).rows[0].count)).toBe(1);
  });
});
