import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { Pool } from "pg";
import type { S3Client } from "@aws-sdk/client-s3";
import { semanticDigest } from "../../domain/digest/canonical";
import { MAX_OMR_CREDIT_ESTIMATE, type OmrQuotaConfig } from "../../domain/omr/contracts";
import { applyMigrations } from "../persistence/migrations";
import type { PrivateRowId } from "../persistence/store";
import { PostgresGovernanceStore } from "../persistence/postgres-store";
import { S3OwnedObjectStore } from "../storage/s3-owned-object-store";
import { CleanupService } from "../cleanup/cleanup-service";
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

  it("fences expired capture and status tokens behind newer completed authority", async () => {
    await withStore("UTC", async (pool, store) => {
      const ownerSessionId = await session(pool, "fencing-owner");
      const created = await claim(store, ownerSessionId, "2026-01-01T00:00:00.000Z", "fencing", 100);
      if (created.status !== "claimed") throw new Error(`FENCING_SEED_FAILED:${created.status}`);
      await pool.query("UPDATE omr_jobs SET state='queued' WHERE id=$1", [created.job.id]);
      await store.claimResultCapture({ jobId: created.job.id, leaseToken: "capture-a", leaseExpiresAt: "2026-01-01T00:00:01.000Z", now: "2026-01-01T00:00:00.000Z" });
      const restartedStore = new PostgresOmrStore(pool);
      await restartedStore.claimResultCapture({ jobId: created.job.id, leaseToken: "capture-b", leaseExpiresAt: "2026-01-01T00:10:00.000Z", now: "2026-01-01T00:00:02.000Z" });
      await store.releaseResultCapture(created.job.id, "capture-a", "2026-01-01T00:00:02.500Z");
      expect((await pool.query("SELECT result_capture_lease_token FROM omr_jobs WHERE id=$1", [created.job.id])).rows[0].result_capture_lease_token).toBe("capture-b");
      await expect(store.failResultCapture({ jobId: created.job.id, leaseToken: "capture-a", expectedStates: ["queued"], update: { state: "failed", creditState: "released" }, now: "2026-01-01T00:00:03.000Z" })).resolves.toBe(false);
      const resultId = await objectReference(pool, ownerSessionId, "fencing-result");
      await expect(store.completeResultCapture({ jobId: created.job.id, leaseToken: "capture-b", update: { state: "completed", creditState: "settled", resultObjectReferenceId: resultId }, now: "2026-01-01T00:00:04.000Z" })).resolves.toBe(true);
      await expect(store.releaseResultCapture(created.job.id, "capture-a", "2026-01-01T00:00:05.000Z")).resolves.toBeUndefined();
      expect((await pool.query("SELECT state,credit_state,result_object_reference_id,result_capture_lease_token FROM omr_jobs WHERE id=$1", [created.job.id])).rows[0])
        .toMatchObject({ state: "completed", credit_state: "settled", result_object_reference_id: resultId, result_capture_lease_token: null });

      const second = await claim(store, ownerSessionId, "2026-01-01T01:00:00.000Z", "status-fencing", 100);
      if (second.status !== "claimed") throw new Error(`STATUS_FENCING_SEED_FAILED:${second.status}`);
      await pool.query("UPDATE omr_jobs SET state='queued' WHERE id=$1", [second.job.id]);
      await store.claimStatusObservation({ jobId: second.job.id, leaseToken: "status-a", leaseExpiresAt: "2026-01-01T01:00:01.000Z", now: "2026-01-01T01:00:00.000Z" });
      await restartedStore.claimStatusObservation({ jobId: second.job.id, leaseToken: "status-b", leaseExpiresAt: "2026-01-01T01:10:00.000Z", now: "2026-01-01T01:00:02.000Z" });
      await store.claimResultCapture({ jobId: second.job.id, leaseToken: "status-capture", leaseExpiresAt: "2026-01-01T01:10:00.000Z", statusObservationLeaseToken: "status-b", now: "2026-01-01T01:00:03.000Z" });
      const statusResultId = await objectReference(pool, ownerSessionId, "status-result");
      await store.completeResultCapture({ jobId: second.job.id, leaseToken: "status-capture", update: { state: "completed", creditState: "settled", resultObjectReferenceId: statusResultId }, now: "2026-01-01T01:00:04.000Z" });
      await expect(store.completeStatusObservation({ jobId: second.job.id, leaseToken: "status-a", expectedStates: ["queued"], update: { state: "failed", creditState: "released" }, now: "2026-01-01T01:00:05.000Z" })).resolves.toBe(false);
      expect((await pool.query("SELECT state,credit_state,result_object_reference_id,status_observation_lease_token FROM omr_jobs WHERE id=$1", [second.job.id])).rows[0])
        .toMatchObject({ state: "completed", credit_state: "settled", result_object_reference_id: statusResultId, status_observation_lease_token: null });
    });
  });

  it("uses bigint accounting beyond int32 and rejects the exact per-job boundary plus one", async () => {
    await withStore("UTC", async (pool, store) => {
      const largeClaim = async (key: string, estimate: number, ceiling: number) => {
        const owner = await session(pool, `large:${key}`);
        const durable = { ...record(owner, "2026-01-01T00:00:00.000Z", key), creditEstimate: estimate };
        return store.claimCreate({ ownerSessionId: owner, ipOwnerHash: durable.ipOwnerHash, idempotencyKeyHash: `large:${key}`, requestDigest: `${key.padEnd(64, "0")}`.slice(0, 64) as never, record: durable, quota: { ...quota, maxConcurrentJobsPerIp: 10, dailyGlobalCreditCeiling: ceiling }, now: "2026-01-01T00:00:00.000Z" });
      };
      await expect(largeClaim("first", MAX_OMR_CREDIT_ESTIMATE, MAX_OMR_CREDIT_ESTIMATE * 2)).resolves.toMatchObject({ status: "claimed" });
      await expect(largeClaim("second", MAX_OMR_CREDIT_ESTIMATE, MAX_OMR_CREDIT_ESTIMATE * 2)).resolves.toMatchObject({ status: "claimed" });
      expect((await pool.query("SELECT sum(credit_estimate::bigint)::text AS total FROM omr_jobs")).rows[0].total).toBe(String(MAX_OMR_CREDIT_ESTIMATE * 2));
      await expect(largeClaim("third", 1, MAX_OMR_CREDIT_ESTIMATE * 2)).resolves.toEqual({ status: "credit-denied" });
      await expect(largeClaim("overflow", MAX_OMR_CREDIT_ESTIMATE + 1, Number.MAX_SAFE_INTEGER)).rejects.toThrow("OMR_CREDIT_DOMAIN_INVALID");
    });
  });

  it("durably commits start/input/cancel before acknowledgement loss and preserves canonical input replay", async () => {
    await withStore("UTC", async (pool, store) => {
      const cases = [
        { kind: "start" as const, initial: "uploading", update: { state: "queued" as const } },
        { kind: "submit-input" as const, initial: "needs-input", update: { state: "processing" as const } },
        { kind: "cancel" as const, initial: "processing", update: { state: "cancelled" as const, creditState: "released" as const } },
      ];
      for (const item of cases) {
        const owner = await session(pool, `operation:${item.kind}`);
        const created = await claim(store, owner, "2026-01-01T00:00:00.000Z", `operation-${item.kind}`, 100);
        if (created.status !== "claimed") throw new Error(`OPERATION_SEED_FAILED:${created.status}`);
        await pool.query("UPDATE omr_jobs SET state=$2 WHERE id=$1", [created.job.id, item.initial]);
        const response = { kind: "vendor-specific" as const, requestId: "request:canonical", schemaId: "schema:canonical", payload: { nested: 1, alpha: true } };
        const digest = item.kind === "submit-input"
          ? await semanticDigest({ projectionSchema: "hm-omr-vendor-input-v1", input: response })
          : await semanticDigest({ projectionSchema: "hm-omr-operation-request-v1", kind: item.kind, jobId: created.job.id });
        const lease = `lease:${item.kind}`;
        await store.claimOperation({ jobId: created.job.id, kind: item.kind, operationRequestDigest: digest, expectedStates: [item.initial as DurableOmrJobRecord["state"]], leaseToken: lease, leaseExpiresAt: "2026-01-01T00:05:00.000Z", supportsIdempotency: true, now: "2026-01-01T00:00:00.000Z" });
        let vendorEffects = 0;
        vendorEffects += 1;
        const acknowledgementLoss = new Proxy(store, {
          get(target, property, receiver) {
            if (property === "completeOperation") return async (input: Parameters<OmrStore["completeOperation"]>[0]) => {
              const applied = await target.completeOperation(input);
              if (applied) throw new Error(`${item.kind} commit acknowledgement lost`);
              return applied;
            };
            const value = Reflect.get(target, property, receiver) as unknown;
            return typeof value === "function" ? value.bind(target) : value;
          },
        }) as OmrStore;
        await expect(acknowledgementLoss.completeOperation({ jobId: created.job.id, kind: item.kind, leaseToken: lease, update: item.kind === "submit-input" ? { ...item.update, acceptedInput: response, acceptedInputDigest: digest } : item.update, now: "2026-01-01T00:00:01.000Z" })).rejects.toThrow("commit acknowledgement lost");
        const restarted = new PostgresOmrStore(pool);
        const durable = (await pool.query("SELECT state,credit_state,accepted_input,accepted_input_digest,operation_lease_token FROM omr_jobs WHERE id=$1", [created.job.id])).rows[0];
        expect(durable.state).toBe(item.update.state);
        expect(durable.operation_lease_token).toBeNull();
        if (item.kind === "submit-input") {
          const reordered = { ...response, payload: { alpha: true, nested: 1 } };
          expect(await semanticDigest({ projectionSchema: "hm-omr-vendor-input-v1", input: reordered })).toBe(durable.accepted_input_digest);
          expect(durable.accepted_input).toEqual(response);
        }
        await expect(restarted.claimOperation({ jobId: created.job.id, kind: item.kind, operationRequestDigest: digest, expectedStates: [item.initial as DurableOmrJobRecord["state"]], leaseToken: `retry:${item.kind}`, leaseExpiresAt: "2026-01-01T00:10:00.000Z", supportsIdempotency: true, now: "2026-01-01T00:06:00.000Z" })).resolves.toMatchObject({ status: "invalid" });
        expect(vendorEffects).toBe(1);
      }
    });
  });

  it("keeps a PostgreSQL publication ledger discoverable through Put/Delete acknowledgement failures and restart", async () => {
    await withStore("UTC", async (pool) => {
      const owner = await session(pool, "publication-owner");
      const keys = new Set<string>();
      let putLost = true;
      let deleteFailed = true;
      const fake = { send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        const key = String(command.input.Key);
        if (command.constructor.name === "PutObjectCommand") { keys.add(key); if (putLost) { putLost = false; throw new TypeError("put acknowledgement lost"); } }
        if (command.constructor.name === "DeleteObjectCommand") { if (deleteFailed) { deleteFailed = false; throw new Error("delete failed"); } keys.delete(key); }
        return {};
      } } as unknown as S3Client;
      const governance = new PostgresGovernanceStore(pool);
      const first = new S3OwnedObjectStore(fake, "integration-bucket", governance);
      const publication = { ownerSessionId: owner, publicationId: "postgres-put-loss", bytes: Uint8Array.of(4, 5, 6), contentType: "application/octet-stream" } as const;
      await expect(first.put(publication)).rejects.toThrow("put acknowledgement lost");
      expect(keys.size).toBe(1);
      const staged = (await pool.query("SELECT id,object_key,lifecycle,publication_token FROM object_references")).rows[0];
      expect(staged).toMatchObject({ lifecycle: "upload-pending", publication_token: expect.any(String) });
      const restarted = new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool));
      const cleanup = new CleanupService(new PostgresGovernanceStore(pool), restarted);
      await expect(cleanup.run({ now: new Date("2030-01-01T00:00:00.000Z") })).resolves.toMatchObject({ failures: [expect.objectContaining({ scope: expect.stringMatching(/^object:/u), message: "delete failed" })] });
      expect(keys.size).toBe(1);
      expect((await pool.query("SELECT lifecycle,publication_put_may_still_complete,publication_predecessor_token,publication_cleanup_token FROM object_references")).rows[0])
        .toEqual({ lifecycle: "tombstone-pending", publication_put_may_still_complete: false, publication_predecessor_token: null, publication_cleanup_token: null });
      await expect(cleanup.run({ now: new Date("2030-01-01T00:01:00.000Z") })).resolves.toMatchObject({ failures: [] });
      expect(keys.size).toBe(0);
      expect((await pool.query("SELECT lifecycle FROM object_references")).rows[0].lifecycle).toBe("deleted");
      const republished = await restarted.put(publication);
      expect(republished).toMatchObject({ id: String(staged.id), objectKey: staged.object_key, lifecycle: "active" });
      expect(keys).toEqual(new Set([staged.object_key]));
      expect((await pool.query("SELECT count(*)::int AS count FROM object_references")).rows[0].count).toBe(1);
    });
  });

  it("recovers PostgreSQL reference/activation acknowledgement loss as one active publication", async () => {
    await withStore("UTC", async (pool) => {
      for (const lostMethod of ["createObjectReference", "completeObjectPublication"] as const) {
        await pool.query("TRUNCATE TABLE object_references RESTART IDENTITY CASCADE");
        const owner = await session(pool, `publication-ack:${lostMethod}`);
        const governance = new PostgresGovernanceStore(pool);
        let loseOnce = true;
        const unstable = new Proxy(governance, {
          get(target, property, receiver) {
            if (property === lostMethod) return async (...args: unknown[]) => {
              const result = await (target[lostMethod] as (...values: unknown[]) => Promise<unknown>)(...args);
              if (loseOnce) { loseOnce = false; throw new Error(`${lostMethod} acknowledgement lost`); }
              return result;
            };
            const value = Reflect.get(target, property, receiver) as unknown;
            return typeof value === "function" ? value.bind(target) : value;
          },
        }) as PostgresGovernanceStore;
        const commands: string[] = [];
        const fake = { send: async (command: { constructor: { name: string } }) => { commands.push(command.constructor.name); return {}; } } as unknown as S3Client;
        const active = await new S3OwnedObjectStore(fake, "integration-bucket", unstable).put({ ownerSessionId: owner, publicationId: `postgres-ack-loss:${lostMethod}`, bytes: Uint8Array.of(1), contentType: "application/octet-stream" });
        expect(active.lifecycle).toBe("active");
        expect((await pool.query("SELECT lifecycle,publication_token,publication_lease_expires_at FROM object_references")).rows)
          .toEqual([{ lifecycle: "active", publication_token: null, publication_lease_expires_at: null }]);
        expect(commands).toEqual(["PutObjectCommand"]);
      }
    });
  });

  it("fences late PostgreSQL Put generations across cleanup, restart, retry, and newer adoption", async () => {
    await withStore("UTC", async (pool) => {
      const defer = () => {
        let resolve!: () => void;
        const promise = new Promise<void>((done) => { resolve = done; });
        return { promise, resolve };
      };

      // A process disappears after the first delete and after its delayed Put
      // materializes. A restarted process rediscovers the exact tombstone/key.
      let owner = await session(pool, "postgres-late-put-restart");
      let gate = defer();
      let started = defer();
      let processReplaced = false;
      let objects = new Map<string, Uint8Array>();
      const deletes: string[] = [];
      const governance = new PostgresGovernanceStore(pool);
      const unstable = new Proxy(governance, {
        get(target, property, receiver) {
          if (processReplaced && (property === "completeObjectPublication" || property === "settleObjectPublicationPut")) {
            return async () => { throw new Error("process replaced"); };
          }
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as PostgresGovernanceStore;
      let fake = { send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        const key = String(command.input.Key);
        if (command.constructor.name === "PutObjectCommand") { started.resolve(); await gate.promise; objects.set(key, Uint8Array.from(command.input.Body as Uint8Array)); }
        if (command.constructor.name === "HeadObjectCommand" && !objects.has(key)) throw Object.assign(new Error("not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
        if (command.constructor.name === "DeleteObjectCommand") { deletes.push(key); objects.delete(key); }
        return {};
      } } as unknown as S3Client;
      let store = new S3OwnedObjectStore(fake, "integration-bucket", unstable);
      let pending = store.put({ ownerSessionId: owner, publicationId: "postgres-late-restart", bytes: Uint8Array.of(1, 4), contentType: "application/octet-stream" });
      await started.promise;
      await new CleanupService(governance, store).run({ now: new Date("2030-01-01T00:00:00.000Z") });
      let row = (await pool.query("SELECT * FROM object_references")).rows[0];
      expect(row).toMatchObject({ lifecycle: "tombstone-pending", publication_generation: "1", publication_put_may_still_complete: true, publication_token: expect.any(String) });
      expect(row.publication_delete_confirmed_at).not.toBeNull();
      processReplaced = true;
      gate.resolve();
      await expect(pending).rejects.toThrow("process replaced");
      expect(objects.size).toBe(1);
      const restarted = new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool));
      await new CleanupService(new PostgresGovernanceStore(pool), restarted).run({ now: new Date("2030-01-01T00:01:00.000Z") });
      row = (await pool.query("SELECT * FROM object_references")).rows[0];
      expect(row).toMatchObject({ lifecycle: "deleted", publication_generation: "1", publication_put_may_still_complete: false });
      expect(row.publication_token).toBeNull();
      expect(objects.size).toBe(0);
      expect(new Set(deletes)).toEqual(new Set([row.object_key]));

      // A late second delete fails after the Put continuation settles its exact
      // generation. The durable tombstone survives and a new process retries it.
      await pool.query("TRUNCATE TABLE anonymous_sessions RESTART IDENTITY CASCADE");
      owner = await session(pool, "postgres-late-put-delete-retry");
      gate = defer();
      started = defer();
      objects = new Map<string, Uint8Array>();
      let deleteCount = 0;
      let failSecond = true;
      fake = { send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        const key = String(command.input.Key);
        if (command.constructor.name === "PutObjectCommand") { started.resolve(); await gate.promise; objects.set(key, Uint8Array.from(command.input.Body as Uint8Array)); }
        if (command.constructor.name === "DeleteObjectCommand") {
          deleteCount += 1;
          if (deleteCount > 1 && failSecond) throw new Error("postgres late second delete failed");
          objects.delete(key);
        }
        return {};
      } } as unknown as S3Client;
      store = new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool));
      pending = store.put({ ownerSessionId: owner, publicationId: "postgres-late-delete-retry", bytes: Uint8Array.of(2, 5), contentType: "application/octet-stream" });
      await started.promise;
      const claimStore = new PostgresGovernanceStore(pool);
      const selected = await claimStore.cleanup({ now: "2030-01-01T00:00:00.000Z", batchSize: 10, dryRun: false });
      const selectedPublication = selected.pendingObjectReferences[0];
      const cleanupClaims = await Promise.all(["cleanup-claim-a", "cleanup-claim-b"].map((publicationCleanupToken) => claimStore.claimObjectPublicationCleanup({
        id: selectedPublication.id, ownerSessionId: owner, objectKey: selectedPublication.objectKey,
        publicationGeneration: selectedPublication.publicationGeneration!, publicationCleanupToken,
        publicationCleanupLeaseExpiresAt: "2030-01-01T00:05:00.000Z", now: "2030-01-01T00:00:00.000Z",
      })));
      const claimedToken = cleanupClaims[0] ? "cleanup-claim-a" : "cleanup-claim-b";
      expect([...cleanupClaims].sort()).toEqual([false, true]);
      await claimStore.releaseObjectPublicationCleanup({
        id: selectedPublication.id, ownerSessionId: owner, publicationGeneration: selectedPublication.publicationGeneration!, publicationCleanupToken: claimedToken,
      });
      await new CleanupService(new PostgresGovernanceStore(pool), store).run({ now: new Date("2030-01-01T00:00:00.000Z") });
      gate.resolve();
      await expect(pending).rejects.toThrow("postgres late second delete failed");
      row = (await pool.query("SELECT * FROM object_references")).rows[0];
      expect(row).toMatchObject({ lifecycle: "tombstone-pending", publication_generation: "1", publication_put_may_still_complete: false, publication_token: expect.any(String) });
      expect(row.publication_cleanup_token).toBeNull();
      failSecond = false;
      await new CleanupService(new PostgresGovernanceStore(pool), new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)))
        .run({ now: new Date("2030-01-01T00:01:00.000Z") });
      expect(objects.size).toBe(0);
      expect((await pool.query("SELECT lifecycle FROM object_references")).rows[0].lifecycle).toBe("deleted");

      // Generation B starts only after A's first delete is confirmed. B adopts
      // the stable logical key; delayed A can neither activate over nor delete B.
      await pool.query("TRUNCATE TABLE anonymous_sessions RESTART IDENTITY CASCADE");
      owner = await session(pool, "postgres-generation-adoption");
      gate = defer();
      started = defer();
      objects = new Map<string, Uint8Array>();
      let putCount = 0;
      deleteCount = 0;
      fake = { send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        const key = String(command.input.Key);
        if (command.constructor.name === "PutObjectCommand") {
          putCount += 1;
          if (putCount === 1) { started.resolve(); await gate.promise; }
          objects.set(key, Uint8Array.from(command.input.Body as Uint8Array));
        }
        if (command.constructor.name === "DeleteObjectCommand") { deleteCount += 1; objects.delete(key); }
        return {};
      } } as unknown as S3Client;
      const publication = { ownerSessionId: owner, publicationId: "postgres-generation-adoption", bytes: Uint8Array.of(7, 7), contentType: "application/octet-stream" } as const;
      const first = new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)).put(publication);
      await started.promise;
      await new CleanupService(new PostgresGovernanceStore(pool), new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)))
        .run({ now: new Date("2030-01-01T00:00:00.000Z") });
      const second = await new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)).put(publication);
      expect(second).toMatchObject({ lifecycle: "active", publicationGeneration: 2, publicationPredecessorToken: expect.any(String) });
      gate.resolve();
      await expect(first).resolves.toMatchObject({ id: second.id, lifecycle: "active" });
      row = (await pool.query("SELECT lifecycle,publication_generation,publication_predecessor_token FROM object_references")).rows[0];
      expect(row).toEqual({ lifecycle: "active", publication_generation: "2", publication_predecessor_token: null });
      expect(objects).toEqual(new Map([[second.objectKey, publication.bytes]]));
      expect(deleteCount).toBe(1);
    });
  });
});
