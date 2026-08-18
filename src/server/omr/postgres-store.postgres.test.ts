import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { Pool } from "pg";
import type { OmrQuotaConfig } from "../../domain/omr/contracts";
import { applyMigrations } from "../persistence/migrations";
import type { PrivateRowId } from "../persistence/store";
import { PostgresOmrStore } from "./postgres-store";
import type { DurableOmrJobRecord, OmrStore } from "./store";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL_REQUIRED_FOR_POSTGRES_INTEGRATION");

const schema = `hm_omr_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl, max: 1 });

function poolFor(timeZone: "UTC" | "Asia/Seoul"): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 1,
    options: `-c search_path=${schema} -c timezone=${timeZone}`,
  });
}

const quota: OmrQuotaConfig = {
  maxConcurrentJobsPerSession: 10,
  maxConcurrentJobsPerIp: 10,
  maxJobsPerSessionPerHour: 100,
  maxJobsPerIpPerHour: 100,
  dailyGlobalCreditCeiling: 100,
  maxPagesPerJob: 12,
  maxRetriesPerPage: 3,
};

const replayEnvelope = {
  version: 1 as const,
  algorithm: "aes-256-gcm" as const,
  associatedDataVersion: "integration-test",
  ciphertext: "ciphertext",
  nonce: "AAAAAAAAAAAAAAAA",
  authenticationTag: "AAAAAAAAAAAAAAAAAAAAAA",
};

function record(ownerSessionId: PrivateRowId, now: string, key: string): Omit<DurableOmrJobRecord, "id"> {
  const consentDigest = "a".repeat(64) as DurableOmrJobRecord["capabilitySnapshotDigest"];
  return {
    ownerSessionId,
    ipOwnerHash: `ip:${key}`,
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

async function session(pool: Pool, key: string): Promise<PrivateRowId> {
  const result = await pool.query(
    "INSERT INTO anonymous_sessions (token_hash,csrf_nonce,created_at,expires_at) VALUES ($1,$2,$3,$4) RETURNING id",
    [`token:${key}`, `csrf:${key}`, "2025-12-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"],
  );
  return String(result.rows[0].id) as PrivateRowId;
}

async function objectReference(pool: Pool, ownerSessionId: PrivateRowId, key: string): Promise<PrivateRowId> {
  const result = await pool.query(
    `INSERT INTO object_references
      (owner_session_id,object_key,content_type,byte_size,binary_digest,lifecycle,created_at,expires_at)
     VALUES ($1,$2,'application/octet-stream',1,$3,'active',$4,$5) RETURNING id`,
    [ownerSessionId, `object:${key}`, "f".repeat(64), "2026-01-01T00:00:00.000Z", "2026-01-03T00:00:00.000Z"],
  );
  return String(result.rows[0].id) as PrivateRowId;
}

async function claim(
  store: PostgresOmrStore,
  ownerSessionId: PrivateRowId,
  now: string,
  key: string,
  ceiling: number,
) {
  const durable = record(ownerSessionId, now, key);
  return store.claimCreate({
    ownerSessionId,
    ipOwnerHash: durable.ipOwnerHash,
    idempotencyKeyHash: `idempotency:${key}`,
    requestDigest: "c".repeat(64) as never,
    record: durable,
    quota: { ...quota, dailyGlobalCreditCeiling: ceiling },
    now,
  });
}

async function seedSettled(pool: Pool, store: PostgresOmrStore, createdAt: string, key: string): Promise<void> {
  const ownerSessionId = await session(pool, `settled:${key}`);
  const created = await claim(store, ownerSessionId, createdAt, `settled:${key}`, 100);
  if (created.status !== "claimed") throw new Error(`SETTLED_SEED_FAILED:${created.status}`);
  await pool.query(
    "UPDATE omr_jobs SET state='completed',credit_state='settled',handle_active=false,vendor_create_outcome_state='confirmed',vendor_delete_state='deleted' WHERE id=$1",
    [created.job.id],
  );
}

async function seedReserved(pool: Pool, store: PostgresOmrStore, createdAt: string, key: string): Promise<void> {
  const ownerSessionId = await session(pool, `reserved:${key}`);
  const created = await claim(store, ownerSessionId, createdAt, `reserved:${key}`, 100);
  if (created.status !== "claimed") throw new Error(`RESERVED_SEED_FAILED:${created.status}`);
  await pool.query(
    "UPDATE omr_jobs SET state='reconciliation-required',handle_active=false,vendor_create_outcome_state='outcome-uncertain',reconciliation_kind='create' WHERE id=$1",
    [created.job.id],
  );
}

async function withStore<T>(timeZone: "UTC" | "Asia/Seoul", operation: (pool: Pool, store: PostgresOmrStore) => Promise<T>): Promise<T> {
  const pool = poolFor(timeZone);
  try {
    const shown = await pool.query("SHOW TimeZone");
    expect(String(shown.rows[0].TimeZone ?? shown.rows[0].timezone)).toBe(timeZone);
    return await operation(pool, new PostgresOmrStore(pool));
  } finally {
    await pool.end();
  }
}

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const migrationPool = poolFor("UTC");
  try { await applyMigrations(migrationPool); }
  finally { await migrationPool.end(); }
});

beforeEach(async () => {
  const pool = poolFor("UTC");
  try { await pool.query("TRUNCATE TABLE anonymous_sessions RESTART IDENTITY CASCADE"); }
  finally { await pool.end(); }
});

afterAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
});

describe("actual PostgreSQL OMR authority", () => {
  it("denies settled credit from the same UTC day under an Asia/Seoul session", async () => {
    await withStore("Asia/Seoul", async (pool, store) => {
      await seedSettled(pool, store, "2026-01-01T10:00:00.000Z", "seoul-same-day");
      const nextSession = await session(pool, "seoul-next");
      await expect(claim(store, nextSession, "2026-01-01T16:00:00.000Z", "seoul-next", 1))
        .resolves.toEqual({ status: "credit-denied" });
    });
  });

  it("does not count settled credit outside the current UTC window", async () => {
    await withStore("Asia/Seoul", async (pool, store) => {
      await seedSettled(pool, store, "2025-12-31T23:59:59.999Z", "prior-day");
      const nextSession = await session(pool, "prior-day-next");
      await expect(claim(store, nextSession, "2026-01-01T16:00:00.000Z", "prior-day-next", 1))
        .resolves.toMatchObject({ status: "claimed" });
    });
  });

  it("counts unresolved reserved credit across the UTC day boundary", async () => {
    await withStore("Asia/Seoul", async (pool, store) => {
      await seedReserved(pool, store, "2025-12-31T23:00:00.000Z", "reserved-prior-day");
      const nextSession = await session(pool, "reserved-next");
      await expect(claim(store, nextSession, "2026-01-01T16:00:00.000Z", "reserved-next", 1))
        .resolves.toEqual({ status: "credit-denied" });
    });
  });

  it("makes the same UTC credit decision in a UTC session", async () => {
    await withStore("UTC", async (pool, store) => {
      await seedSettled(pool, store, "2026-01-01T10:00:00.000Z", "utc-same-day");
      const nextSession = await session(pool, "utc-next");
      await expect(claim(store, nextSession, "2026-01-01T16:00:00.000Z", "utc-next", 1))
        .resolves.toEqual({ status: "credit-denied" });
    });
  });

  it("keeps completed create replay usable only while its locked job handle is public", async () => {
    await withStore("UTC", async (pool, store) => {
      const ownerSessionId = await session(pool, "replay-owner");
      const now = "2026-01-01T00:00:00.000Z";
      const created = await claim(store, ownerSessionId, now, "replay-authority", 100);
      if (created.status !== "claimed") throw new Error(`REPLAY_SEED_FAILED:${created.status}`);
      await store.beginVendorCreation({
        jobId: created.job.id,
        expectedState: "created",
        expectedOutcomeState: "not-attempted",
        expectedVendorCreateLeaseExpiresAt: created.job.vendorCreateLeaseExpiresAt,
        now,
      });
      await store.completeVendorCreation({
        jobId: created.job.id,
        vendorJobIdEnvelope: replayEnvelope,
        expectedState: "created",
        expectedVendorCreateLeaseExpiresAt: created.job.vendorCreateLeaseExpiresAt,
        completionMode: "public-handle-recovery",
        now,
      });
      const inspection: Parameters<OmrStore["inspectCreate"]>[0] = {
        ownerSessionId,
        idempotencyKeyHash: "idempotency:replay-authority",
        requestDigest: "c".repeat(64) as never,
        vendorCreateLeaseExpiresAt: "2026-01-01T00:10:00.000Z",
        now: "2026-01-01T00:01:00.000Z",
      };
      await expect(store.inspectCreate(inspection)).resolves.toMatchObject({ status: "replay" });
      await expect(store.inspectCreate({ ...inspection, now: "2026-01-04T00:00:00.000Z" })).resolves.toEqual({ status: "replay-unavailable" });
      await pool.query("UPDATE omr_jobs SET handle_active=false,state='delete-pending' WHERE id=$1", [created.job.id]);
      await expect(store.inspectCreate(inspection)).resolves.toEqual({ status: "replay-unavailable" });
      const count = await pool.query("SELECT count(*)::int AS count FROM omr_jobs");
      expect(count.rows[0].count).toBe(1);
    });
  });

  it("detects an exact page commit after the completion acknowledgement is lost", async () => {
    await withStore("UTC", async (pool, store) => {
      const ownerSessionId = await session(pool, "page-commit-owner");
      const now = "2026-01-01T00:00:00.000Z";
      const created = await claim(store, ownerSessionId, now, "page-commit", 100);
      if (created.status !== "claimed") throw new Error(`PAGE_COMMIT_SEED_FAILED:${created.status}`);
      const page = {
        pageIndex: 0, pageDigest: "b".repeat(64) as never, mimeType: "image/png",
        idempotencyKeyHash: "page:idempotency", width: 100, height: 120,
        quality: { blurBp: 0 as never, perspectiveBp: 0 as never, glareBp: 0 as never, cropRiskBp: 0 as never, estimatedStaffSpacePixels: 20, status: "pass" as const, reasons: [] },
        warnAcknowledged: false, duplicateConfirmed: false, uploadState: "pending" as const, retryCount: 0,
      };
      const leaseToken = "page-lease";
      await expect(store.claimPage(created.job.id, page, 3, leaseToken, "2026-01-01T00:05:00.000Z", true, now))
        .resolves.toMatchObject({ status: "claimed" });
      const objectId = await objectReference(pool, ownerSessionId, "page-commit");
      await expect((async () => {
        expect(await store.completePage(created.job.id, 0, leaseToken, objectId, now)).toBe(true);
        throw new Error("page commit acknowledgement lost");
      })()).rejects.toThrow("page commit acknowledgement lost");
      await expect(store.inspectPageCompletion({
        jobId: created.job.id, pageIndex: 0, leaseToken, pageDigest: page.pageDigest,
        idempotencyKeyHash: page.idempotencyKeyHash, objectReferenceId: objectId,
      })).resolves.toEqual({ status: "committed-exact" });
      const durable = await pool.query("SELECT upload_state,processed_object_reference_id FROM omr_pages WHERE job_id=$1 AND page_ordinal=0", [created.job.id]);
      expect(durable.rows[0]).toMatchObject({ upload_state: "uploaded", processed_object_reference_id: objectId });
    });
  });

  it("detects an exact completed and settled result after acknowledgement loss", async () => {
    await withStore("Asia/Seoul", async (pool, store) => {
      const ownerSessionId = await session(pool, "result-commit-owner");
      const now = "2026-01-01T00:00:00.000Z";
      const created = await claim(store, ownerSessionId, now, "result-commit", 100);
      if (created.status !== "claimed") throw new Error(`RESULT_COMMIT_SEED_FAILED:${created.status}`);
      await pool.query("UPDATE omr_jobs SET state='queued' WHERE id=$1", [created.job.id]);
      const leaseToken = "result-lease";
      await expect(store.claimResultCapture({ jobId: created.job.id, leaseToken, leaseExpiresAt: "2026-01-01T00:05:00.000Z", now }))
        .resolves.toMatchObject({ status: "claimed" });
      const objectId = await objectReference(pool, ownerSessionId, "result-commit");
      const vendorResultDigest = "1".repeat(64) as never;
      const providerBundleDigest = "2".repeat(64) as never;
      const normalizationMappingArtifactDigest = "3".repeat(64) as never;
      const evidence = { granularity: "page" as const, frames: [], transforms: [], evidence: [], providerBundleDigest };
      const normalizationMapping = {
        version: "vendor-export-target-map-v2" as const, vendorResultDigest, providerBundleDigest,
        mappings: [], artifactDigest: normalizationMappingArtifactDigest,
      };
      await expect((async () => {
        expect(await store.completeResultCapture({
          jobId: created.job.id, leaseToken,
          update: { state: "completed", creditState: "settled", resultObjectReferenceId: objectId, vendorResultDigest, evidence, normalizationMapping, completedAt: now },
          now,
        })).toBe(true);
        throw new Error("result commit acknowledgement lost");
      })()).rejects.toThrow("result commit acknowledgement lost");
      await expect(store.inspectResultCompletion({
        jobId: created.job.id, leaseToken, objectReferenceId: objectId, vendorResultDigest,
        providerBundleDigest, normalizationMappingArtifactDigest,
      })).resolves.toEqual({ status: "committed-exact" });
      const durable = await pool.query("SELECT state,credit_state,result_object_reference_id FROM omr_jobs WHERE id=$1", [created.job.id]);
      expect(durable.rows[0]).toMatchObject({ state: "completed", credit_state: "settled", result_object_reference_id: objectId });
    });
  });
});
