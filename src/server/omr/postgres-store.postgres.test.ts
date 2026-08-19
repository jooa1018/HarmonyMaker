import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { Pool } from "pg";
import type { S3Client } from "@aws-sdk/client-s3";
import { binaryDigest, semanticDigest } from "../../domain/digest/canonical";
import { MAX_OMR_CREDIT_ESTIMATE, OMR_VENDOR_ADAPTER_CONTRACT_VERSION, OmrVendorCallError, type OmrQuotaConfig } from "../../domain/omr/contracts";
import { applyMigrationsWithClient, MIGRATIONS, OMR_PROVIDER_DELETE_AUTHORITY_SQL } from "../persistence/migrations";
import type { PrivateRowId } from "../persistence/store";
import { PostgresGovernanceStore } from "../persistence/postgres-store";
import { MemoryOwnedObjectStore } from "../storage/memory-owned-object-store.test-adapter";
import { S3OwnedObjectStore } from "../storage/s3-owned-object-store";
import { CleanupService } from "../cleanup/cleanup-service";
import { DurableOmrApplicationService, omrQuotaConfig } from "./application-service";
import { PostgresOmrStore } from "./postgres-store";
import { ReferenceOmrVendorAdapter, type ReferenceOmrFixture } from "./reference-adapter";
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

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

interface PostgresFakeMaterializedObject {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly metadata: Record<string, string>;
}

class PostgresControllableGenerationS3 {
  readonly objects = new Map<string, PostgresFakeMaterializedObject>();
  readonly putStarted = [deferred(), deferred()];
  readonly putGates = [deferred(), deferred()];
  readonly deletes: Array<{ readonly key: string; readonly generation?: string }> = [];
  failDeleteGeneration?: string;
  private failedDelete = false;
  private putCalls = 0;

  async send(command: { readonly constructor: { readonly name: string }; readonly input: Record<string, unknown> }): Promise<Record<string, unknown>> {
    const key = String(command.input.Key);
    if (command.constructor.name === "PutObjectCommand") {
      const index = this.putCalls;
      this.putCalls += 1;
      this.putStarted[index]?.resolve();
      await this.putGates[index]?.promise;
      this.objects.set(key, {
        bytes: Uint8Array.from(command.input.Body as Uint8Array),
        contentType: String(command.input.ContentType),
        metadata: command.input.Metadata as Record<string, string>,
      });
      return {};
    }
    if (command.constructor.name === "HeadObjectCommand") {
      const object = this.objects.get(key);
      if (!object) throw Object.assign(new Error("not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      return { ContentLength: object.bytes.byteLength, ContentType: object.contentType, Metadata: object.metadata };
    }
    if (command.constructor.name === "DeleteObjectCommand") {
      const generation = this.objects.get(key)?.metadata["hm-publication-generation"];
      this.deletes.push({ key, ...(generation ? { generation } : {}) });
      if (!this.failedDelete && this.failDeleteGeneration !== undefined && generation === this.failDeleteGeneration) {
        this.failedDelete = true;
        throw new Error(`postgres generation ${generation} delete failed`);
      }
      this.objects.delete(key);
    }
    return {};
  }
}

class PostgresRejectedDeferredGenerationS3 {
  readonly objects = new Map<string, PostgresFakeMaterializedObject>();
  readonly putStarted = [deferred(), deferred()];
  readonly materializationGates = [deferred(), deferred()];
  readonly materialized = [deferred(), deferred()];
  readonly deletes: Array<{ readonly key: string; readonly generation?: string }> = [];
  failDeleteGeneration?: string;
  private failedDelete = false;
  private putCalls = 0;

  async send(command: { readonly constructor: { readonly name: string }; readonly input: Record<string, unknown> }): Promise<Record<string, unknown>> {
    const key = String(command.input.Key);
    if (command.constructor.name === "PutObjectCommand") {
      const index = this.putCalls;
      this.putCalls += 1;
      const object = {
        bytes: Uint8Array.from(command.input.Body as Uint8Array),
        contentType: String(command.input.ContentType),
        metadata: command.input.Metadata as Record<string, string>,
      };
      this.putStarted[index]?.resolve();
      void this.materializationGates[index]?.promise.then(() => {
        this.objects.set(key, object);
        this.materialized[index]?.resolve();
      });
      throw new TypeError(`postgres response lost for generation ${index + 1}`);
    }
    if (command.constructor.name === "HeadObjectCommand") {
      const object = this.objects.get(key);
      if (!object) throw Object.assign(new Error("not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      return { ContentLength: object.bytes.byteLength, ContentType: object.contentType, Metadata: object.metadata };
    }
    if (command.constructor.name === "DeleteObjectCommand") {
      const generation = this.objects.get(key)?.metadata["hm-publication-generation"];
      this.deletes.push({ key, ...(generation ? { generation } : {}) });
      if (!this.failedDelete && this.failDeleteGeneration !== undefined && generation === this.failDeleteGeneration) {
        this.failedDelete = true;
        throw new Error(`postgres generation ${generation} delete failed`);
      }
      this.objects.delete(key);
    }
    return {};
  }
}

class PostgresAmbiguousDeleteGenerationS3 {
  readonly objects = new Map<string, PostgresFakeMaterializedObject>();
  readonly putStarted = [deferred(), deferred(), deferred()];
  readonly putGates = [deferred(), deferred(), deferred()];
  readonly putKeys: string[] = [];
  readonly keyGenerations = new Map<string, string>();
  readonly deleteTargets: string[] = [];
  readonly delayedDeleteGate = deferred();
  readonly delayedDeleteApplied = deferred();
  ambiguousDeleteGeneration?: string;
  applyAmbiguousDelete = true;
  failRetryGeneration?: string;
  private putCalls = 0;
  private ambiguousDeleteIssued = false;
  private retryFailureIssued = false;

  async send(command: { readonly constructor: { readonly name: string }; readonly input: Record<string, unknown> }): Promise<Record<string, unknown>> {
    const key = String(command.input.Key);
    if (command.constructor.name === "PutObjectCommand") {
      const index = this.putCalls++;
      const metadata = command.input.Metadata as Record<string, string>;
      this.putKeys.push(key);
      this.keyGenerations.set(key, metadata["hm-publication-generation"]);
      this.putStarted[index]?.resolve();
      await this.putGates[index]?.promise;
      this.objects.set(key, {
        bytes: Uint8Array.from(command.input.Body as Uint8Array),
        contentType: String(command.input.ContentType),
        metadata,
      });
      return {};
    }
    if (command.constructor.name === "HeadObjectCommand") {
      const object = this.objects.get(key);
      if (!object) throw Object.assign(new Error("not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      return { ContentLength: object.bytes.byteLength, ContentType: object.contentType, Metadata: object.metadata };
    }
    if (command.constructor.name === "GetObjectCommand") {
      const object = this.objects.get(key);
      if (!object) throw Object.assign(new Error("not found"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
      return { ContentType: object.contentType, Body: { transformToByteArray: async () => object.bytes } };
    }
    if (command.constructor.name === "DeleteObjectCommand") {
      const generation = this.keyGenerations.get(key);
      this.deleteTargets.push(key);
      if (!this.ambiguousDeleteIssued && generation === this.ambiguousDeleteGeneration && this.objects.has(key)) {
        this.ambiguousDeleteIssued = true;
        void this.delayedDeleteGate.promise.then(() => {
          if (this.applyAmbiguousDelete) this.objects.delete(key);
          this.delayedDeleteApplied.resolve();
        });
        throw new TypeError(`postgres delete response lost for generation ${generation}`);
      }
      if (!this.retryFailureIssued && generation === this.failRetryGeneration) {
        this.retryFailureIssued = true;
        throw new Error(`postgres delete retry failed for generation ${generation}`);
      }
      this.objects.delete(key);
    }
    return {};
  }
}

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
      (owner_session_id,logical_publication_key,object_key,content_type,byte_size,binary_digest,lifecycle,created_at,expires_at)
     VALUES ($1,$2,$2,'application/octet-stream',1,$3,'active',$4,$5) RETURNING id`,
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

function failAfterFailPageStage(pool: Pool, failureStage: number): Pool {
  return new Proxy(pool, {
    get(target, property, receiver) {
      if (property !== "connect") return Reflect.get(target, property, receiver);
      return async () => {
        const client = await target.connect();
        let stage = 0;
        let injected = false;
        return new Proxy(client, {
          get(clientTarget, clientProperty, clientReceiver) {
            if (clientProperty !== "query") {
              const value = Reflect.get(clientTarget, clientProperty, clientReceiver) as unknown;
              return typeof value === "function" ? value.bind(clientTarget) : value;
            }
            return async (text: string, values: readonly unknown[] = []) => {
              const result = await clientTarget.query(text, values as unknown[]);
              const normalized = text.replace(/\s+/gu, " ").trim();
              const isStage = normalized === "BEGIN"
                || normalized === "SELECT state FROM omr_jobs WHERE id=$1 FOR UPDATE"
                || normalized.startsWith("SELECT upload_state,upload_lease_token FROM omr_pages")
                || normalized.startsWith("UPDATE omr_pages SET upload_state=")
                || normalized.startsWith("UPDATE omr_jobs SET state='reconciliation-required'")
                || normalized === "COMMIT";
              if (isStage) stage += 1;
              if (!injected && isStage && stage === failureStage) {
                injected = true;
                throw new Error(`failPage fault after stage ${failureStage}`);
              }
              return result;
            };
          },
        });
      };
    },
  }) as Pool;
}

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const migrationPool = poolFor("UTC");
  try {
    const client = await migrationPool.connect();
    try { await applyMigrationsWithClient(client, MIGRATIONS.filter((migration) => migration.version < 13)); }
    finally { client.release(); }
    await migrationPool.query(OMR_PROVIDER_DELETE_AUTHORITY_SQL);
  } finally { await migrationPool.end(); }
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
  it("fences provider DELETE at exact lease expiry and after W2 reclaims W1", async () => {
    await withStore("UTC", async (pool, store) => {
      const ownerSessionId = await session(pool, "provider-delete-fence");
      const created = await claim(store, ownerSessionId, "2026-01-01T00:00:00.000Z", "provider-delete-fence", 100);
      if (created.status !== "claimed") throw new Error(`DELETE_LEDGER_SEED_FAILED:${created.status}`);
      const authority = {
        jobId: created.job.id,
        operationId: "provider-delete:integration:1",
        operationGeneration: 1,
        providerBindingId: created.job.providerBindingId,
        adapterContractVersion: created.job.adapterContractVersion,
        vendorId: created.job.capabilities.vendorId,
        vendorJobIdEnvelope: replayEnvelope,
        idempotencyKey: "provider-delete-idempotency:integration:1",
        supportsDeletion: true,
        supportsIdempotency: true,
      } as const;
      await expect(store.claimProviderDelete({
        ...authority, claimToken: "W1", claimLeaseExpiresAt: "2026-01-01T00:00:10.000Z", now: "2026-01-01T00:00:00.000Z",
      })).resolves.toMatchObject({ status: "claimed", operation: { claimToken: "W1" } });
      await expect(store.beginProviderDeleteDispatch({
        jobId: authority.jobId, operationId: authority.operationId, operationGeneration: 1,
        claimToken: "W1", now: "2026-01-01T00:00:09.999Z",
      })).resolves.toBe(true);
      await expect(new PostgresOmrStore(pool).claimProviderDelete({
        ...authority, claimToken: "overlap", claimLeaseExpiresAt: "2026-01-01T00:00:19.999Z", now: "2026-01-01T00:00:09.999Z",
      })).resolves.toMatchObject({ status: "pending", operation: { claimToken: "W1", dispatchOutcome: "outcome-uncertain" } });
      await expect(store.completeProviderDelete({
        jobId: authority.jobId, operationId: authority.operationId, operationGeneration: 1,
        claimToken: "W1", dispatchOutcome: "acknowledged-deleted", result: { status: "deleted" },
        reconciliationRequired: false, now: "2026-01-01T00:00:10.000Z",
      })).resolves.toBe(false);
      const restartedStore = new PostgresOmrStore(pool);
      await expect(restartedStore.claimProviderDelete({
        ...authority, claimToken: "W2", claimLeaseExpiresAt: "2026-01-01T00:00:20.000Z", now: "2026-01-01T00:00:10.000Z",
      })).resolves.toMatchObject({ status: "claimed", operation: { claimToken: "W2" } });
      await expect(store.beginProviderDeleteDispatch({
        jobId: authority.jobId, operationId: authority.operationId, operationGeneration: 1,
        claimToken: "W1", now: "2026-01-01T00:00:10.001Z",
      })).resolves.toBe(false);
      await expect(store.completeProviderDelete({
        jobId: authority.jobId, operationId: authority.operationId, operationGeneration: 1,
        claimToken: "W1", dispatchOutcome: "acknowledged-deleted", result: { status: "deleted" },
        reconciliationRequired: false, now: "2026-01-01T00:00:10.001Z",
      })).resolves.toBe(false);
      await expect(store.beginProviderDeleteDispatch({
        jobId: authority.jobId, operationId: authority.operationId, operationGeneration: 1,
        claimToken: "W2", now: "2026-01-01T00:00:10.001Z",
      })).resolves.toBe(true);
      await expect(store.completeProviderDelete({
        jobId: authority.jobId, operationId: authority.operationId, operationGeneration: 1,
        claimToken: "W2", dispatchOutcome: "acknowledged-deleted", result: { status: "deleted" },
        reconciliationRequired: false, now: "2026-01-01T00:00:19.999Z",
      })).resolves.toBe(true);
      await expect(store.getProviderDeleteOperation(authority.jobId)).resolves.toMatchObject({
        claimToken: undefined, dispatchOutcome: "acknowledged-deleted", result: { status: "deleted" },
      });
      await expect(store.markHandleDeleted(authority.jobId, "2026-01-01T00:00:20.000Z")).resolves.toBeUndefined();
      await expect(store.markHandleDeleted(authority.jobId, "2026-01-01T00:00:20.001Z")).resolves.toBeUndefined();
      await expect(store.finalizeJobDelete({
        jobId: authority.jobId,
        providerDeleteAuthority: { operationId: authority.operationId, operationGeneration: 2 },
        update: {
          state: "delete-pending", vendorDeleteState: "pending", localDeleteState: "deleted",
          vendorDeleteResult: { status: "failed", code: "STALE", message: "stale pending observation" },
        },
        now: "2026-01-01T00:00:20.002Z",
      })).resolves.toMatchObject({ status: "superseded", job: { state: "delete-pending" } });
      await expect(store.finalizeJobDelete({
        jobId: authority.jobId,
        providerDeleteAuthority: { operationId: authority.operationId, operationGeneration: 1 },
        update: {
          state: "delete-pending", vendorDeleteState: "pending", localDeleteState: "deleted",
          vendorDeleteResult: { status: "failed", code: "STALE", message: "stale pending observation" },
        },
        now: "2026-01-01T00:00:20.003Z",
      })).resolves.toMatchObject({
        status: "applied",
        job: { state: "deleted", vendorDeleteState: "deleted", localDeleteState: "deleted", vendorDeleteResult: { status: "deleted" } },
      });
      await expect(store.finalizeJobDelete({
        jobId: authority.jobId,
        providerDeleteAuthority: { operationId: authority.operationId, operationGeneration: 1 },
        update: { state: "delete-pending", vendorDeleteState: "pending", localDeleteState: "failed" },
        now: "2026-01-01T00:00:20.004Z",
      })).resolves.toMatchObject({
        status: "terminal", job: { state: "deleted", vendorDeleteState: "deleted", localDeleteState: "deleted" },
      });
    });
  });

  it("persists non-idempotent DELETE uncertainty as reconciliation authority across restart", async () => {
    await withStore("UTC", async (pool, store) => {
      const ownerSessionId = await session(pool, "provider-delete-non-idempotent");
      const created = await claim(store, ownerSessionId, "2026-01-01T00:00:00.000Z", "provider-delete-non-idempotent", 100);
      if (created.status !== "claimed") throw new Error(`DELETE_LEDGER_SEED_FAILED:${created.status}`);
      const authority = {
        jobId: created.job.id,
        operationId: "provider-delete:integration:non-idempotent",
        operationGeneration: 1,
        providerBindingId: created.job.providerBindingId,
        adapterContractVersion: created.job.adapterContractVersion,
        vendorId: created.job.capabilities.vendorId,
        vendorJobIdEnvelope: replayEnvelope,
        idempotencyKey: "provider-delete-idempotency:integration:non-idempotent",
        supportsDeletion: true,
        supportsIdempotency: false,
      } as const;
      await expect(store.claimProviderDelete({
        ...authority, claimToken: "W1", claimLeaseExpiresAt: "2026-01-01T00:00:10.000Z", now: "2026-01-01T00:00:00.000Z",
      })).resolves.toMatchObject({ status: "claimed" });
      await expect(store.beginProviderDeleteDispatch({
        jobId: authority.jobId, operationId: authority.operationId, operationGeneration: 1,
        claimToken: "W1", now: "2026-01-01T00:00:01.000Z",
      })).resolves.toBe(true);
      await expect(store.completeProviderDelete({
        jobId: authority.jobId, operationId: authority.operationId, operationGeneration: 1,
        claimToken: "W1", dispatchOutcome: "outcome-uncertain",
        result: { status: "failed", code: "OMR_VENDOR_DELETE_OUTCOME_UNCERTAIN", message: "reconcile" },
        nextAttemptAt: "2026-01-01T12:00:00.000Z", reconciliationRequired: true,
        now: "2026-01-01T00:00:02.000Z",
      })).resolves.toBe(true);
      const restartedStore = new PostgresOmrStore(pool);
      await expect(restartedStore.claimProviderDelete({
        ...authority, claimToken: "W2", claimLeaseExpiresAt: "2026-01-02T00:05:00.000Z", now: "2026-01-02T00:00:00.000Z",
      })).resolves.toMatchObject({
        status: "reconciliation-required",
        operation: { dispatchOutcome: "outcome-uncertain", reconciliationRequired: true, claimToken: undefined },
      });
    });
  });

  it.each([
    {
      key: "ack-failed",
      supportsIdempotency: true,
      dispatchOutcome: "acknowledged-failed" as const,
      reconciliationRequired: false,
      result: { status: "failed" as const, code: "OMR_VENDOR_DELETE_FAILED", message: "acknowledged failure" },
    },
    {
      key: "non-idempotent-uncertain",
      supportsIdempotency: false,
      dispatchOutcome: "outcome-uncertain" as const,
      reconciliationRequired: true,
      result: { status: "failed" as const, code: "OMR_VENDOR_DELETE_OUTCOME_UNCERTAIN", message: "reconciliation required" },
    },
  ])("keeps PostgreSQL DELETE ledger truth after a stale pending finalizer: $key", async (scenario) => {
    await withStore("UTC", async (pool, store) => {
      const ownerSessionId = await session(pool, `provider-delete-reverse-${scenario.key}`);
      const created = await claim(store, ownerSessionId, "2026-01-01T00:00:00.000Z", `provider-delete-reverse-${scenario.key}`, 100);
      if (created.status !== "claimed") throw new Error(`DELETE_LEDGER_SEED_FAILED:${created.status}`);
      const authority = {
        jobId: created.job.id,
        operationId: `provider-delete:reverse:${scenario.key}`,
        operationGeneration: 1,
        providerBindingId: created.job.providerBindingId,
        adapterContractVersion: created.job.adapterContractVersion,
        vendorId: created.job.capabilities.vendorId,
        vendorJobIdEnvelope: replayEnvelope,
        idempotencyKey: `provider-delete-reverse-key:${scenario.key}`,
        supportsDeletion: true,
        supportsIdempotency: scenario.supportsIdempotency,
      } as const;
      await store.markHandleDeleted(created.job.id, "2026-01-01T00:00:00.000Z");
      await expect(store.claimProviderDelete({
        ...authority, claimToken: "W1", claimLeaseExpiresAt: "2026-01-01T00:10:00.000Z",
        now: "2026-01-01T00:00:00.000Z",
      })).resolves.toMatchObject({ status: "claimed" });
      await expect(store.beginProviderDeleteDispatch({
        jobId: created.job.id, operationId: authority.operationId, operationGeneration: 1,
        claimToken: "W1", now: "2026-01-01T00:00:01.000Z",
      })).resolves.toBe(true);
      await expect(store.completeProviderDelete({
        jobId: created.job.id, operationId: authority.operationId, operationGeneration: 1,
        claimToken: "W1", dispatchOutcome: scenario.dispatchOutcome, result: scenario.result,
        nextAttemptAt: "2026-01-01T12:00:00.000Z",
        reconciliationRequired: scenario.reconciliationRequired,
        now: "2026-01-01T00:00:02.000Z",
      })).resolves.toBe(true);
      const providerDeleteAuthority = {
        operationId: authority.operationId,
        operationGeneration: authority.operationGeneration,
      };
      await expect(store.finalizeJobDelete({
        jobId: created.job.id,
        providerDeleteAuthority,
        update: {
          state: "delete-pending", vendorDeleteState: "failed", localDeleteState: "deleted",
          vendorDeleteResult: scenario.result, vendorDeleteNextAttemptAt: "2026-01-01T12:00:00.000Z",
        },
        now: "2026-01-01T00:00:03.000Z",
      })).resolves.toMatchObject({ status: "applied", job: { vendorDeleteState: "failed" } });
      await expect(new PostgresOmrStore(pool).finalizeJobDelete({
        jobId: created.job.id,
        providerDeleteAuthority,
        update: {
          state: "delete-pending", vendorDeleteState: "pending", localDeleteState: "failed",
          vendorDeleteResult: { status: "failed", code: "STALE_PENDING", message: "stale pending observation" },
          vendorDeleteNextAttemptAt: "2026-01-01T00:10:00.000Z",
        },
        now: "2026-01-01T00:00:04.000Z",
      })).resolves.toMatchObject({
        status: "applied",
        job: {
          state: "delete-pending", vendorDeleteState: "failed", localDeleteState: "deleted",
          vendorDeleteResult: scenario.result, vendorDeleteNextAttemptAt: "2026-01-01T12:00:00.000Z",
        },
      });
    });
  });

  it("does not claim or burn a PostgreSQL upload while historical binding A is absent, then resumes on A", async () => {
    await withStore("UTC", async (pool, store) => {
      const ownerSessionId = await session(pool, "historical-upload-binding");
      const pageBytes = new TextEncoder().encode("postgres-historical-binding-page");
      const pageDigest = await binaryDigest(pageBytes);
      const fixture: ReferenceOmrFixture = {
        id: "historical-upload-binding",
        orderedPageDigests: [pageDigest],
        statusScript: [{ kind: "queued" }],
        musicXml: "<score-partwise/>",
        evidence: { granularity: "page", frames: [], transforms: [], evidence: [] },
        retentionInfo: { canDeleteImmediately: true, policyReference: "integration" },
      };
      const adapterA = new ReferenceOmrVendorAdapter([fixture], { vendorId: "provider-a", vendorDisplayName: "Provider A" });
      const adapterB = new ReferenceOmrVendorAdapter([fixture], { vendorId: "provider-b", vendorDisplayName: "Provider B" });
      const registry = new Map<string, ReferenceOmrVendorAdapter>([["binding:a", adapterA], ["binding:b", adapterB]]);
      const resolveAdapter = (bindingId: string, contractVersion: string) => contractVersion === OMR_VENDOR_ADAPTER_CONTRACT_VERSION
        ? registry.get(bindingId) : undefined;
      const governance = new PostgresGovernanceStore(pool);
      const objects = new MemoryOwnedObjectStore(governance);
      const inspectPage = async (input: { readonly bytes: Uint8Array; readonly mimeType: string }) => ({
        bytes: Uint8Array.from(input.bytes), digest: await binaryDigest(input.bytes), mimeType: input.mimeType,
        width: 100, height: 120,
        quality: { blurBp: 0 as never, perspectiveBp: 0 as never, glareBp: 0 as never, cropRiskBp: 0 as never, status: "pass" as const, reasons: [] },
      });
      const common = {
        store, objects, handleHmacKey: new Uint8Array(32).fill(11), vendorJobEncryptionKey: new Uint8Array(32).fill(12),
        quota: omrQuotaConfig(100), actor: { sessionId: ownerSessionId, ipOwnerHash: "ip:postgres-historical-binding" },
        inspectPage, now: () => new Date("2026-01-01T00:00:00.000Z"),
        adapterContractVersion: OMR_VENDOR_ADAPTER_CONTRACT_VERSION,
        resolveAdapter,
      };
      const serviceA = new DurableOmrApplicationService({ ...common, adapter: adapterA, providerBindingId: "binding:a" });
      const preflight = await serviceA.getProviderPreflight();
      const handle = await serviceA.createJob({
        sessionId: ownerSessionId, pageCount: 1,
        pages: [{ pageIndex: 0, pageDigest, mimeType: "image/png" }], sourceKind: "camera-photo",
        rights: { basis: "self-authored", allowedUses: ["generation", "provider-transfer"] },
        providerTransferConsent: true, consentCapabilitySnapshotDigest: preflight.capabilitySnapshotDigest,
        idempotencyKey: "postgres-historical-binding-create",
      });
      registry.delete("binding:a");
      const rotated = new DurableOmrApplicationService({ ...common, adapter: adapterB, providerBindingId: "binding:b" });
      const upload = { pageIndex: 0, pageDigest, mimeType: "image/png" as const, idempotencyKey: "postgres-historical-binding-upload", bytes: new Blob([pageBytes]) };
      await expect(rotated.uploadPage(handle, upload)).rejects.toThrow("OMR_PROVIDER_BINDING_UNAVAILABLE");
      const restarted = new DurableOmrApplicationService({ ...common, adapter: adapterB, providerBindingId: "binding:b" });
      await expect(restarted.uploadPage(handle, upload)).rejects.toThrow("OMR_PROVIDER_BINDING_UNAVAILABLE");
      expect(adapterA.callCounts.upload).toBe(0);
      expect(adapterB.callCounts.upload).toBe(0);
      const beforeRestore = await pool.query("SELECT state FROM omr_jobs WHERE owner_session_id=$1", [ownerSessionId]);
      expect(beforeRestore.rows[0].state).toBe("created");
      const pagesBeforeRestore = await pool.query("SELECT retry_count,upload_state,upload_lease_token FROM omr_pages WHERE job_id=(SELECT id FROM omr_jobs WHERE owner_session_id=$1)", [ownerSessionId]);
      expect(pagesBeforeRestore.rows).toEqual([]);
      registry.set("binding:a", adapterA);
      const restored = new DurableOmrApplicationService({ ...common, adapter: adapterB, providerBindingId: "binding:b" });
      await expect(restored.uploadPage(handle, upload)).resolves.toBeUndefined();
      expect(adapterA.callCounts.upload).toBe(1);
      expect(adapterB.callCounts.upload).toBe(0);
      const afterRestore = await pool.query("SELECT retry_count,upload_state,upload_lease_token FROM omr_pages WHERE job_id=(SELECT id FROM omr_jobs WHERE owner_session_id=$1)", [ownerSessionId]);
      expect(afterRestore.rows[0]).toMatchObject({ retry_count: 0, upload_state: "uploaded", upload_lease_token: null });
    });
  });

  it("runs shared provider-delete application authority on PostgreSQL across overlap, uncertainty, restart, and local cleanup", async () => {
    await withStore("UTC", async (pool, store) => {
      let nowMs = Date.parse("2026-01-01T00:00:00.000Z");
      const pageBytes = new TextEncoder().encode("postgres-provider-delete-application-page");
      const pageDigest = await binaryDigest(pageBytes);
      const fixture: ReferenceOmrFixture = {
        id: "postgres-provider-delete-application",
        orderedPageDigests: [pageDigest], statusScript: [{ kind: "queued" }],
        musicXml: "<score-partwise/>", evidence: { granularity: "page", frames: [], transforms: [], evidence: [] },
        retentionInfo: { canDeleteImmediately: true, policyReference: "postgres-delete-application" },
      };
      const governance = new PostgresGovernanceStore(pool);
      const objects = new MemoryOwnedObjectStore(governance);
      const inspectPage = async (input: { readonly bytes: Uint8Array; readonly mimeType: string }) => ({
        bytes: Uint8Array.from(input.bytes), digest: await binaryDigest(input.bytes), mimeType: input.mimeType,
        width: 100, height: 120,
        quality: { blurBp: 0 as never, perspectiveBp: 0 as never, glareBp: 0 as never, cropRiskBp: 0 as never, estimatedStaffSpacePixels: 20, status: "pass" as const, reasons: [] },
      });
      const make = async (key: string, adapter: ReferenceOmrVendorAdapter) => {
        const ownerSessionId = await session(pool, `delete-app:${key}`);
        const dependencies = {
          store, objects, adapter,
          handleHmacKey: new Uint8Array(32).fill(21), vendorJobEncryptionKey: new Uint8Array(32).fill(22),
          quota: omrQuotaConfig(100), actor: { sessionId: ownerSessionId, ipOwnerHash: `ip:delete-app:${key}` },
          inspectPage, now: () => new Date(nowMs),
        };
        const service = new DurableOmrApplicationService(dependencies);
        const preflight = await service.getProviderPreflight();
        const handle = await service.createJob({
          sessionId: ownerSessionId, pageCount: 1,
          pages: [{ pageIndex: 0, pageDigest, mimeType: "image/png" }], sourceKind: "camera-photo",
          rights: { basis: "self-authored", allowedUses: ["generation", "provider-transfer"] },
          providerTransferConsent: true, consentCapabilitySnapshotDigest: preflight.capabilitySnapshotDigest,
          idempotencyKey: `delete-app:${key}`,
        });
        return { service, handle, dependencies };
      };

      const overlapAdapter = new ReferenceOmrVendorAdapter([fixture]);
      const overlap = await make("overlap", overlapAdapter);
      await overlap.service.uploadPage(overlap.handle, {
        pageIndex: 0, pageDigest, mimeType: "image/png", idempotencyKey: "delete-app:overlap-page",
        bytes: new Blob([pageBytes]),
      });
      const gate = deferred();
      const overlapDelete = vi.spyOn(overlapAdapter, "deleteVendorJob").mockImplementation(async () => {
        await gate.promise;
        return { status: "deleted" };
      });
      const originalOverlapObjectDelete = objects.delete.bind(objects);
      const staleCleanupGate = deferred();
      let overlapLocalDeleteCalls = 0;
      const overlapLocalDelete = vi.spyOn(objects, "delete").mockImplementation(async (...args) => {
        overlapLocalDeleteCalls += 1;
        if (overlapLocalDeleteCalls === 1) await staleCleanupGate.promise;
        return originalOverlapObjectDelete(...args);
      });
      const direct = overlap.service.delete(overlap.handle);
      await vi.waitFor(() => expect(overlapDelete).toHaveBeenCalledTimes(1));
      const staleCleanup = overlap.service.cleanupExpiredJobs();
      await vi.waitFor(() => expect(overlapLocalDelete).toHaveBeenCalledTimes(1));
      expect(overlapDelete).toHaveBeenCalledTimes(1);
      gate.resolve();
      await expect(direct).resolves.toMatchObject({ cleanupState: "resolved", vendor: { status: "deleted" } });
      staleCleanupGate.resolve();
      await expect(staleCleanup).resolves.toMatchObject([{ result: { cleanupState: "resolved", vendor: { status: "deleted" } } }]);
      expect(overlapDelete).toHaveBeenCalledTimes(1);
      await expect(pool.query(
        "SELECT state,vendor_delete_state,local_delete_state,cleanup_lease_token FROM omr_jobs WHERE owner_session_id=$1",
        [overlap.dependencies.actor.sessionId],
      )).resolves.toMatchObject({ rows: [{ state: "deleted", vendor_delete_state: "deleted", local_delete_state: "deleted", cleanup_lease_token: null }] });
      overlapLocalDelete.mockRestore();

      const twoDirectAdapter = new ReferenceOmrVendorAdapter([fixture]);
      const twoDirect = await make("two-direct", twoDirectAdapter);
      await twoDirect.service.uploadPage(twoDirect.handle, {
        pageIndex: 0, pageDigest, mimeType: "image/png", idempotencyKey: "delete-app:two-direct-page",
        bytes: new Blob([pageBytes]),
      });
      const twoDirectProviderGate = deferred();
      const twoDirectProviderDelete = vi.spyOn(twoDirectAdapter, "deleteVendorJob").mockImplementation(async () => {
        await twoDirectProviderGate.promise;
        return { status: "deleted" };
      });
      const originalTwoDirectObjectDelete = objects.delete.bind(objects);
      const staleDirectGate = deferred();
      let twoDirectLocalDeleteCalls = 0;
      const twoDirectLocalDelete = vi.spyOn(objects, "delete").mockImplementation(async (...args) => {
        twoDirectLocalDeleteCalls += 1;
        if (twoDirectLocalDeleteCalls === 1) await staleDirectGate.promise;
        return originalTwoDirectObjectDelete(...args);
      });
      const firstDirect = twoDirect.service.delete(twoDirect.handle);
      await vi.waitFor(() => expect(twoDirectProviderDelete).toHaveBeenCalledTimes(1));
      const secondDirect = twoDirect.service.delete(twoDirect.handle);
      await vi.waitFor(() => expect(twoDirectLocalDelete).toHaveBeenCalledTimes(1));
      twoDirectProviderGate.resolve();
      await expect(firstDirect).resolves.toMatchObject({ cleanupState: "resolved", vendor: { status: "deleted" } });
      staleDirectGate.resolve();
      await expect(secondDirect).resolves.toMatchObject({ cleanupState: "resolved", vendor: { status: "deleted" } });
      expect(twoDirectProviderDelete).toHaveBeenCalledTimes(1);
      await expect(pool.query(
        "SELECT state,vendor_delete_state,local_delete_state,cleanup_lease_token FROM omr_jobs WHERE owner_session_id=$1",
        [twoDirect.dependencies.actor.sessionId],
      )).resolves.toMatchObject({ rows: [{ state: "deleted", vendor_delete_state: "deleted", local_delete_state: "deleted", cleanup_lease_token: null }] });
      twoDirectLocalDelete.mockRestore();

      const idempotentAdapter = new ReferenceOmrVendorAdapter([fixture]);
      const idempotent = await make("idempotent-loss", idempotentAdapter);
      const exactKeys: string[] = [];
      let deleteCalls = 0;
      vi.spyOn(idempotentAdapter, "deleteVendorJob").mockImplementation(async (_job, operation) => {
        exactKeys.push(operation.idempotencyKey);
        deleteCalls += 1;
        if (deleteCalls === 1) throw new OmrVendorCallError("applied then response lost", "outcome-uncertain");
        return { status: "deleted" };
      });
      await expect(idempotent.service.delete(idempotent.handle)).resolves.toMatchObject({ cleanupState: "pending" });
      nowMs += 60_001;
      const idempotentRestart = new DurableOmrApplicationService(idempotent.dependencies);
      await expect(idempotentRestart.delete(idempotent.handle)).resolves.toMatchObject({ cleanupState: "resolved", vendor: { status: "deleted" } });
      expect(exactKeys).toHaveLength(2);
      expect(new Set(exactKeys).size).toBe(1);

      const nonIdempotentAdapter = new ReferenceOmrVendorAdapter([fixture], { supportsIdempotency: false });
      const nonIdempotent = await make("non-idempotent-loss", nonIdempotentAdapter);
      const nonIdempotentDelete = vi.spyOn(nonIdempotentAdapter, "deleteVendorJob")
        .mockRejectedValue(new OmrVendorCallError("applied then response lost", "outcome-uncertain"));
      await expect(nonIdempotent.service.delete(nonIdempotent.handle)).resolves.toMatchObject({
        cleanupState: "pending", vendor: { status: "failed", code: "OMR_VENDOR_DELETE_OUTCOME_UNCERTAIN" },
      });
      nowMs += 12 * 60 * 60_000 + 1;
      const nonIdempotentRestart = new DurableOmrApplicationService(nonIdempotent.dependencies);
      await expect(nonIdempotentRestart.delete(nonIdempotent.handle)).resolves.toMatchObject({ cleanupState: "pending" });
      expect(nonIdempotentDelete).toHaveBeenCalledTimes(1);

      const localAdapter = new ReferenceOmrVendorAdapter([fixture]);
      const local = await make("local-cleanup", localAdapter);
      await local.service.uploadPage(local.handle, {
        pageIndex: 0, pageDigest, mimeType: "image/png", idempotencyKey: "delete-app:local-page",
        bytes: new Blob([pageBytes]),
      });
      const originalObjectDelete = objects.delete.bind(objects);
      const localDelete = vi.spyOn(objects, "delete")
        .mockRejectedValueOnce(new Error("local cleanup transient"))
        .mockImplementation(originalObjectDelete);
      await expect(local.service.delete(local.handle)).resolves.toMatchObject({
        cleanupState: "pending", vendor: { status: "deleted" }, nextAttemptAt: expect.any(String),
      });
      nowMs += 60_001;
      const localRestart = new DurableOmrApplicationService(local.dependencies);
      await expect(localRestart.cleanupExpiredJobs()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ result: expect.objectContaining({ cleanupState: "resolved", vendor: { status: "deleted" } }) }),
      ]));
      expect(localDelete).toHaveBeenCalledTimes(2);
    });
  });

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

  it("keeps failPage aggregate authority atomic at all six PostgreSQL fault points", async () => {
    await withStore("UTC", async (pool, store) => {
      for (let failureStage = 1; failureStage <= 6; failureStage += 1) {
        const key = `fail-page-stage-${failureStage}`;
        const ownerSessionId = await session(pool, key);
        const now = "2026-01-01T00:00:00.000Z";
        const created = await claim(store, ownerSessionId, now, key, 100);
        if (created.status !== "claimed") throw new Error(`FAIL_PAGE_SEED_FAILED:${created.status}`);
        const page = {
          pageIndex: 0, pageDigest: "b".repeat(64) as never, mimeType: "image/png",
          idempotencyKeyHash: `page:idempotency:${failureStage}`, width: 100, height: 120,
          quality: { blurBp: 0 as never, perspectiveBp: 0 as never, glareBp: 0 as never, cropRiskBp: 0 as never, estimatedStaffSpacePixels: 20, status: "pass" as const, reasons: [] },
          warnAcknowledged: false, duplicateConfirmed: false, uploadState: "pending" as const, retryCount: 0,
        };
        const leaseToken = `fail-page-lease-${failureStage}`;
        await expect(store.claimPage(created.job.id, page, 3, leaseToken, "2026-01-01T00:05:00.000Z", false, now))
          .resolves.toMatchObject({ status: "claimed" });
        const faultingStore = new PostgresOmrStore(failAfterFailPageStage(pool, failureStage));
        await expect(faultingStore.failPage(created.job.id, 0, leaseToken, "reconciliation-required", "2026-01-01T00:00:01.000Z"))
          .rejects.toThrow(`failPage fault after stage ${failureStage}`);
        const durable = await pool.query(
          `SELECT j.state,j.reconciliation_kind,p.upload_state,p.upload_lease_token
           FROM omr_jobs j JOIN omr_pages p ON p.job_id=j.id WHERE j.id=$1 AND p.page_ordinal=0`,
          [created.job.id],
        );
        if (failureStage < 6) {
          expect(durable.rows[0]).toMatchObject({
            state: "uploading", reconciliation_kind: null,
            upload_state: "pending", upload_lease_token: leaseToken,
          });
          await expect(store.failPage(created.job.id, 0, leaseToken, "reconciliation-required", "2026-01-01T00:00:02.000Z"))
            .resolves.toBeUndefined();
        } else {
          expect(durable.rows[0]).toMatchObject({
            state: "reconciliation-required", reconciliation_kind: "page-upload",
            upload_state: "reconciliation-required", upload_lease_token: null,
          });
        }
        const restarted = await pool.query(
          `SELECT j.state,j.reconciliation_kind,p.upload_state,p.upload_lease_token
           FROM omr_jobs j JOIN omr_pages p ON p.job_id=j.id WHERE j.id=$1 AND p.page_ordinal=0`,
          [created.job.id],
        );
        expect(restarted.rows[0]).toMatchObject({
          state: "reconciliation-required", reconciliation_kind: "page-upload",
          upload_state: "reconciliation-required", upload_lease_token: null,
        });
      }
    });
  });

  it("leaves PostgreSQL page and job rows byte-for-byte unchanged for a stale failPage token", async () => {
    await withStore("UTC", async (pool, store) => {
      const ownerSessionId = await session(pool, "stale-fail-page-token");
      const created = await claim(store, ownerSessionId, "2026-01-01T00:00:00.000Z", "stale-fail-page-token", 100);
      if (created.status !== "claimed") throw new Error(`FAIL_PAGE_SEED_FAILED:${created.status}`);
      const page = {
        pageIndex: 0, pageDigest: "b".repeat(64) as never, mimeType: "image/png",
        idempotencyKeyHash: "stale-token-page-key", width: 100, height: 120,
        quality: { blurBp: 0 as never, perspectiveBp: 0 as never, glareBp: 0 as never, cropRiskBp: 0 as never, estimatedStaffSpacePixels: 20, status: "pass" as const, reasons: [] },
        warnAcknowledged: false, duplicateConfirmed: false, uploadState: "pending" as const, retryCount: 0,
      };
      await expect(store.claimPage(created.job.id, page, 3, "current-page-lease", "2026-01-01T00:05:00.000Z", true, "2026-01-01T00:00:00.000Z"))
        .resolves.toMatchObject({ status: "claimed" });
      const before = await pool.query(
        `SELECT to_jsonb(j) AS job,to_jsonb(p) AS page
         FROM omr_jobs j JOIN omr_pages p ON p.job_id=j.id WHERE j.id=$1 AND p.page_ordinal=0`,
        [created.job.id],
      );
      await expect(store.failPage(created.job.id, 0, "stale-page-lease", "reconciliation-required", "2026-01-01T00:00:01.000Z"))
        .resolves.toBeUndefined();
      const after = await pool.query(
        `SELECT to_jsonb(j) AS job,to_jsonb(p) AS page
         FROM omr_jobs j JOIN omr_pages p ON p.job_id=j.id WHERE j.id=$1 AND p.page_ordinal=0`,
        [created.job.id],
      );
      expect(after.rows[0]).toEqual(before.rows[0]);
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
      const objects = new Map<string, PostgresFakeMaterializedObject>();
      let putLost = true;
      let deleteFailed = true;
      const fake = { send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        const key = String(command.input.Key);
        if (command.constructor.name === "PutObjectCommand") {
          objects.set(key, {
            bytes: Uint8Array.from(command.input.Body as Uint8Array),
            contentType: String(command.input.ContentType),
            metadata: command.input.Metadata as Record<string, string>,
          });
          if (putLost) { putLost = false; throw new TypeError("put acknowledgement lost"); }
        }
        if (command.constructor.name === "HeadObjectCommand") {
          const object = objects.get(key);
          if (!object) throw Object.assign(new Error("not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
          return { ContentLength: object.bytes.byteLength, ContentType: object.contentType, Metadata: object.metadata };
        }
        if (command.constructor.name === "DeleteObjectCommand") { if (deleteFailed) { deleteFailed = false; throw new Error("delete failed"); } objects.delete(key); }
        return {};
      } } as unknown as S3Client;
      const governance = new PostgresGovernanceStore(pool);
      const first = new S3OwnedObjectStore(fake, "integration-bucket", governance);
      const publication = { ownerSessionId: owner, publicationId: "postgres-put-loss", bytes: Uint8Array.of(4, 5, 6), contentType: "application/octet-stream" } as const;
      await expect(first.put(publication)).rejects.toThrow("put acknowledgement lost");
      expect(objects.size).toBe(1);
      const staged = (await pool.query("SELECT id,object_key,lifecycle,publication_token FROM object_references")).rows[0];
      expect(staged).toMatchObject({ lifecycle: "upload-pending", publication_token: expect.any(String) });
      const restarted = new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool));
      const cleanup = new CleanupService(new PostgresGovernanceStore(pool), restarted);
      await expect(cleanup.run({ now: new Date("2030-01-01T00:00:00.000Z") })).resolves.toMatchObject({ failures: [expect.objectContaining({ scope: expect.stringMatching(/^object:/u), message: "delete failed" })] });
      expect(objects.size).toBe(1);
      expect((await pool.query("SELECT lifecycle,publication_put_may_still_complete,publication_predecessor_token,publication_cleanup_token FROM object_references")).rows[0])
        .toEqual({ lifecycle: "tombstone-pending", publication_put_may_still_complete: false, publication_predecessor_token: null, publication_cleanup_token: null });
      await expect(cleanup.run({ now: new Date("2030-01-01T00:01:00.000Z") })).resolves.toMatchObject({ failures: [] });
      expect(objects.size).toBe(0);
      expect((await pool.query("SELECT lifecycle,publication_token,publication_put_may_still_complete FROM object_references")).rows[0])
        .toMatchObject({ lifecycle: "deleted", publication_token: null, publication_put_may_still_complete: false });
      const republished = await restarted.put(publication);
      expect(republished).toMatchObject({ id: String(staged.id), lifecycle: "active", publicationGeneration: 2 });
      expect(republished.objectKey).not.toBe(staged.object_key);
      expect(new Set(objects.keys())).toEqual(new Set([republished.objectKey]));
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
      let objects = new Map<string, { readonly bytes: Uint8Array; readonly contentType: string; readonly metadata: Record<string, string> }>();
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
        if (command.constructor.name === "PutObjectCommand") {
          started.resolve();
          await gate.promise;
          objects.set(key, { bytes: Uint8Array.from(command.input.Body as Uint8Array), contentType: String(command.input.ContentType), metadata: command.input.Metadata as Record<string, string> });
        }
        if (command.constructor.name === "HeadObjectCommand") {
          const object = objects.get(key);
          if (!object) throw Object.assign(new Error("not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
          return { ContentLength: object.bytes.byteLength, ContentType: object.contentType, Metadata: object.metadata };
        }
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
      objects = new Map<string, { readonly bytes: Uint8Array; readonly contentType: string; readonly metadata: Record<string, string> }>();
      let deleteCount = 0;
      let failSecond = true;
      fake = { send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        const key = String(command.input.Key);
        if (command.constructor.name === "PutObjectCommand") {
          started.resolve();
          await gate.promise;
          objects.set(key, { bytes: Uint8Array.from(command.input.Body as Uint8Array), contentType: String(command.input.ContentType), metadata: command.input.Metadata as Record<string, string> });
        }
        if (command.constructor.name === "HeadObjectCommand") {
          const object = objects.get(key);
          if (!object) throw Object.assign(new Error("not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
          return { ContentLength: object.bytes.byteLength, ContentType: object.contentType, Metadata: object.metadata };
        }
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
      const activeObjects = new Map<string, Uint8Array>();
      let putCount = 0;
      deleteCount = 0;
      fake = { send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        const key = String(command.input.Key);
        if (command.constructor.name === "PutObjectCommand") {
          putCount += 1;
          if (putCount === 1) { started.resolve(); await gate.promise; }
          activeObjects.set(key, Uint8Array.from(command.input.Body as Uint8Array));
        }
        if (command.constructor.name === "DeleteObjectCommand") { deleteCount += 1; activeObjects.delete(key); }
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
      expect(activeObjects).toEqual(new Map([[second.objectKey, publication.bytes]]));
      expect(deleteCount).toBe(2);
    });
  });

  it("attributes two concurrent PostgreSQL publication generations independently", async () => {
    await withStore("UTC", async (pool) => {
      const s3 = new PostgresControllableGenerationS3();
      const fake = s3 as unknown as S3Client;
      const owner = await session(pool, "postgres-cross-generation");
      const publication = { ownerSessionId: owner, publicationId: "postgres-cross-generation", bytes: Uint8Array.of(4, 4), contentType: "application/octet-stream" } as const;
      const firstStore = new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool));
      const first = firstStore.put(publication);
      await s3.putStarted[0].promise;
      await new CleanupService(new PostgresGovernanceStore(pool), firstStore).run({ now: new Date("2030-01-01T00:00:00.000Z") });
      const stagedA = (await pool.query("SELECT id,object_key,publication_token FROM object_references")).rows[0];

      const secondStore = new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool));
      const second = secondStore.put(publication);
      await s3.putStarted[1].promise;
      await new CleanupService(new PostgresGovernanceStore(pool), secondStore).run({ now: new Date("2031-01-01T00:00:00.000Z") });
      let row = (await pool.query("SELECT * FROM object_references")).rows[0];
      expect(row).toMatchObject({
        lifecycle: "tombstone-pending",
        publication_generation: "2",
        publication_token: expect.any(String),
        publication_put_may_still_complete: true,
        publication_predecessor_token: stagedA.publication_token,
        publication_predecessor_generation: "1",
      });
      const tokenB = row.publication_token;
      const objectKeyB = row.object_key;

      s3.putGates[0].resolve();
      await expect(first).rejects.toThrow("OBJECT_PUBLICATION_DELETED");
      row = (await pool.query("SELECT * FROM object_references")).rows[0];
      expect(row).toMatchObject({
        lifecycle: "tombstone-pending",
        publication_generation: "2",
        publication_token: tokenB,
        publication_put_may_still_complete: true,
      });
      expect(row.publication_predecessor_token).toBeNull();
      expect(s3.objects.size).toBe(0);
      expect(s3.deletes.filter((item) => item.generation === "1")).toHaveLength(1);

      s3.putGates[1].resolve();
      await expect(second).rejects.toThrow("OBJECT_PUBLICATION_DELETED");
      row = (await pool.query("SELECT * FROM object_references")).rows[0];
      expect(row).toMatchObject({ lifecycle: "deleted", publication_generation: "2", publication_put_may_still_complete: false });
      expect(row.publication_token).toBeNull();
      expect(row.publication_predecessor_token).toBeNull();
      expect(s3.objects.size).toBe(0);
      expect(s3.deletes.filter((item) => item.generation === "2")).toHaveLength(1);
      expect(new Set(s3.deletes.map((item) => item.key))).toEqual(new Set([stagedA.object_key, objectKeyB]));
    });
  });

  it("persists rejected PostgreSQL Put uncertainty through cleanup claim fencing and restart", async () => {
    await withStore("UTC", async (pool) => {
      const s3 = new PostgresRejectedDeferredGenerationS3();
      const fake = s3 as unknown as S3Client;
      const owner = await session(pool, "postgres-rejected-late");
      const publication = { ownerSessionId: owner, publicationId: "postgres-rejected-late", bytes: Uint8Array.of(1, 9), contentType: "application/octet-stream" } as const;
      const rejected = expect(new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)).put(publication))
        .rejects.toThrow("postgres response lost for generation 1");
      await s3.putStarted[0].promise;
      await rejected;

      let row = (await pool.query("SELECT * FROM object_references")).rows[0];
      expect(row).toMatchObject({
        lifecycle: "upload-pending",
        publication_generation: "1",
        publication_token: expect.any(String),
        publication_put_may_still_complete: true,
      });
      const token = row.publication_token;
      const claimsStore = new PostgresGovernanceStore(pool);
      const selected = await claimsStore.cleanup({ now: "2030-01-01T00:00:00.000Z", batchSize: 10, dryRun: false });
      const candidate = selected.pendingObjectReferences[0];
      const claims = await Promise.all(["rejected-cleanup-a", "rejected-cleanup-b"].map((publicationCleanupToken) => claimsStore.claimObjectPublicationCleanup({
        id: candidate.id,
        ownerSessionId: owner,
        objectKey: candidate.objectKey,
        publicationGeneration: candidate.publicationGeneration!,
        publicationCleanupToken,
        publicationCleanupLeaseExpiresAt: "2030-01-01T00:05:00.000Z",
        now: "2030-01-01T00:00:00.000Z",
      })));
      expect([...claims].sort()).toEqual([false, true]);
      await claimsStore.releaseObjectPublicationCleanup({
        id: candidate.id,
        ownerSessionId: owner,
        publicationGeneration: candidate.publicationGeneration!,
        publicationCleanupToken: claims[0] ? "rejected-cleanup-a" : "rejected-cleanup-b",
      });

      await new CleanupService(new PostgresGovernanceStore(pool), new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)))
        .run({ now: new Date("2030-01-01T00:00:00.000Z") });
      row = (await pool.query("SELECT * FROM object_references")).rows[0];
      expect(row).toMatchObject({
        lifecycle: "tombstone-pending",
        publication_generation: "1",
        publication_token: token,
        publication_put_may_still_complete: true,
      });
      expect(row.publication_delete_confirmed_at).not.toBeNull();
      expect(s3.objects.size).toBe(0);
      expect(s3.deletes).toEqual([{ key: row.object_key }]);

      await new CleanupService(new PostgresGovernanceStore(pool), new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)))
        .run({ now: new Date("2030-01-01T00:01:00.000Z") });
      row = (await pool.query("SELECT * FROM object_references")).rows[0];
      expect(row).toMatchObject({ lifecycle: "tombstone-pending", publication_token: token, publication_put_may_still_complete: true });
      expect(s3.deletes).toHaveLength(2);

      s3.materializationGates[0].resolve();
      await s3.materialized[0].promise;
      await new CleanupService(new PostgresGovernanceStore(pool), new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)))
        .run({ now: new Date("2030-01-01T00:02:00.000Z") });
      row = (await pool.query("SELECT * FROM object_references")).rows[0];
      expect(row).toMatchObject({ lifecycle: "deleted", publication_generation: "1", publication_put_may_still_complete: false });
      expect(row.publication_token).toBeNull();
      expect(s3.objects.size).toBe(0);
      expect(s3.deletes.filter((item) => item.generation === "1")).toHaveLength(1);
    });
  });

  it("reconciles PostgreSQL generations A and B after both Put promises reject before materialization", async () => {
    await withStore("UTC", async (pool) => {
      const s3 = new PostgresRejectedDeferredGenerationS3();
      const fake = s3 as unknown as S3Client;
      const owner = await session(pool, "postgres-rejected-generations");
      const publication = { ownerSessionId: owner, publicationId: "postgres-rejected-generations", bytes: Uint8Array.of(2, 8), contentType: "application/octet-stream" } as const;
      const rejectedA = expect(new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)).put(publication))
        .rejects.toThrow("postgres response lost for generation 1");
      await s3.putStarted[0].promise;
      await rejectedA;
      let row = (await pool.query("SELECT * FROM object_references")).rows[0];
      const tokenA = row.publication_token;
      await new CleanupService(new PostgresGovernanceStore(pool), new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)))
        .run({ now: new Date("2030-01-01T00:00:00.000Z") });

      const rejectedB = expect(new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)).put(publication))
        .rejects.toThrow("postgres response lost for generation 2");
      await s3.putStarted[1].promise;
      await rejectedB;
      await new CleanupService(new PostgresGovernanceStore(pool), new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)))
        .run({ now: new Date("2031-01-01T00:00:00.000Z") });
      row = (await pool.query("SELECT * FROM object_references")).rows[0];
      const tokenB = row.publication_token;
      expect(row).toMatchObject({
        lifecycle: "tombstone-pending",
        publication_generation: "2",
        publication_token: expect.any(String),
        publication_put_may_still_complete: true,
        publication_predecessor_token: tokenA,
        publication_predecessor_generation: "1",
      });

      s3.materializationGates[0].resolve();
      await s3.materialized[0].promise;
      await new CleanupService(new PostgresGovernanceStore(pool), new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)))
        .run({ now: new Date("2031-01-01T00:01:00.000Z") });
      row = (await pool.query("SELECT * FROM object_references")).rows[0];
      expect(row).toMatchObject({
        lifecycle: "tombstone-pending",
        publication_generation: "2",
        publication_token: tokenB,
        publication_put_may_still_complete: true,
      });
      expect(row.publication_predecessor_token).toBeNull();
      expect(s3.objects.size).toBe(0);
      expect(s3.deletes.filter((item) => item.generation === "1")).toHaveLength(1);

      s3.materializationGates[1].resolve();
      await s3.materialized[1].promise;
      await new CleanupService(new PostgresGovernanceStore(pool), new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)))
        .run({ now: new Date("2031-01-01T00:02:00.000Z") });
      row = (await pool.query("SELECT * FROM object_references")).rows[0];
      expect(row).toMatchObject({ lifecycle: "deleted", publication_generation: "2", publication_put_may_still_complete: false });
      expect(row.publication_token).toBeNull();
      expect(row.publication_predecessor_token).toBeNull();
      expect(s3.objects.size).toBe(0);
      expect(s3.deletes.filter((item) => item.generation === "2")).toHaveLength(1);
    });
  });

  it("retains PostgreSQL authority when deleting a rejected Put's late materialization fails", async () => {
    await withStore("UTC", async (pool) => {
      const s3 = new PostgresRejectedDeferredGenerationS3();
      s3.failDeleteGeneration = "1";
      const fake = s3 as unknown as S3Client;
      const owner = await session(pool, "postgres-rejected-delete-retry");
      const publication = { ownerSessionId: owner, publicationId: "postgres-rejected-delete-retry", bytes: Uint8Array.of(3, 7), contentType: "application/octet-stream" } as const;
      const rejected = expect(new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)).put(publication))
        .rejects.toThrow("postgres response lost for generation 1");
      await s3.putStarted[0].promise;
      await rejected;
      let row = (await pool.query("SELECT * FROM object_references")).rows[0];
      const token = row.publication_token;
      await new CleanupService(new PostgresGovernanceStore(pool), new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)))
        .run({ now: new Date("2030-01-01T00:00:00.000Z") });
      s3.materializationGates[0].resolve();
      await s3.materialized[0].promise;

      const failed = await new CleanupService(new PostgresGovernanceStore(pool), new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)))
        .run({ now: new Date("2030-01-01T00:01:00.000Z") });
      expect(failed.failures).toEqual([expect.objectContaining({ message: "postgres generation 1 delete failed" })]);
      row = (await pool.query("SELECT * FROM object_references")).rows[0];
      expect(row).toMatchObject({
        lifecycle: "tombstone-pending",
        publication_generation: "1",
        publication_token: token,
        publication_put_may_still_complete: false,
      });
      expect(row.publication_cleanup_token).toBeNull();
      expect(s3.objects.size).toBe(1);

      await new CleanupService(new PostgresGovernanceStore(pool), new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)))
        .run({ now: new Date("2030-01-01T00:02:00.000Z") });
      row = (await pool.query("SELECT * FROM object_references")).rows[0];
      expect(row).toMatchObject({ lifecycle: "deleted", publication_generation: "1", publication_put_may_still_complete: false });
      expect(row.publication_token).toBeNull();
      expect(s3.objects.size).toBe(0);
      expect(s3.deletes.filter((item) => item.generation === "1")).toHaveLength(2);
    });
  });

  it("recovers a materialized PostgreSQL predecessor without settling current generation B", async () => {
    await withStore("UTC", async (pool) => {
      const s3 = new PostgresControllableGenerationS3();
      const fake = s3 as unknown as S3Client;
      let aProcessGone = false;
      const unstableA = new Proxy(new PostgresGovernanceStore(pool), {
        get(target, property, receiver) {
          if (aProcessGone && (property === "completeObjectPublication" || property === "settleObjectPublicationPut")) {
            return async () => { throw new Error("postgres generation A process disappeared"); };
          }
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as PostgresGovernanceStore;
      const owner = await session(pool, "postgres-predecessor-restart");
      const publication = { ownerSessionId: owner, publicationId: "postgres-predecessor-restart", bytes: Uint8Array.of(5), contentType: "application/octet-stream" } as const;
      const firstStore = new S3OwnedObjectStore(fake, "integration-bucket", unstableA);
      const first = firstStore.put(publication);
      await s3.putStarted[0].promise;
      await new CleanupService(new PostgresGovernanceStore(pool), new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)))
        .run({ now: new Date("2030-01-01T00:00:00.000Z") });
      const secondStore = new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool));
      const second = secondStore.put(publication);
      await s3.putStarted[1].promise;
      await new CleanupService(new PostgresGovernanceStore(pool), secondStore).run({ now: new Date("2031-01-01T00:00:00.000Z") });

      aProcessGone = true;
      s3.putGates[0].resolve();
      await expect(first).rejects.toThrow("postgres generation A process disappeared");
      await new CleanupService(new PostgresGovernanceStore(pool), new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)))
        .run({ now: new Date("2031-01-01T00:01:00.000Z") });
      let row = (await pool.query("SELECT * FROM object_references")).rows[0];
      expect(row).toMatchObject({ lifecycle: "tombstone-pending", publication_generation: "2", publication_put_may_still_complete: true });
      expect(row.publication_predecessor_token).toBeNull();
      expect(s3.objects.size).toBe(0);

      s3.putGates[1].resolve();
      await expect(second).rejects.toThrow("OBJECT_PUBLICATION_DELETED");
      row = (await pool.query("SELECT lifecycle FROM object_references")).rows[0];
      expect(row.lifecycle).toBe("deleted");
      expect(s3.objects.size).toBe(0);
    });
  });

  it("recovers current PostgreSQL generation B after materialization and process replacement", async () => {
    await withStore("UTC", async (pool) => {
      const s3 = new PostgresControllableGenerationS3();
      const fake = s3 as unknown as S3Client;
      let bProcessGone = false;
      const unstableB = new Proxy(new PostgresGovernanceStore(pool), {
        get(target, property, receiver) {
          if (bProcessGone && (property === "completeObjectPublication" || property === "settleObjectPublicationPut")) {
            return async () => { throw new Error("postgres generation B process disappeared"); };
          }
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as PostgresGovernanceStore;
      const owner = await session(pool, "postgres-current-restart");
      const publication = { ownerSessionId: owner, publicationId: "postgres-current-restart", bytes: Uint8Array.of(6), contentType: "application/octet-stream" } as const;
      const firstStore = new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool));
      const first = firstStore.put(publication);
      await s3.putStarted[0].promise;
      await new CleanupService(new PostgresGovernanceStore(pool), firstStore).run({ now: new Date("2030-01-01T00:00:00.000Z") });
      const secondStore = new S3OwnedObjectStore(fake, "integration-bucket", unstableB);
      const second = secondStore.put(publication);
      await s3.putStarted[1].promise;
      await new CleanupService(new PostgresGovernanceStore(pool), new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)))
        .run({ now: new Date("2031-01-01T00:00:00.000Z") });

      s3.putGates[0].resolve();
      await expect(first).rejects.toThrow("OBJECT_PUBLICATION_DELETED");
      bProcessGone = true;
      s3.putGates[1].resolve();
      await expect(second).rejects.toThrow("postgres generation B process disappeared");
      expect(s3.objects.size).toBe(1);
      let row = (await pool.query("SELECT * FROM object_references")).rows[0];
      expect(row).toMatchObject({ lifecycle: "tombstone-pending", publication_generation: "2", publication_put_may_still_complete: true });

      await new CleanupService(new PostgresGovernanceStore(pool), new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)))
        .run({ now: new Date("2031-01-01T00:01:00.000Z") });
      row = (await pool.query("SELECT * FROM object_references")).rows[0];
      expect(row).toMatchObject({ lifecycle: "deleted", publication_generation: "2", publication_put_may_still_complete: false });
      expect(s3.objects.size).toBe(0);
    });
  });

  it("retains PostgreSQL generation B authority through attributed delete failure", async () => {
    await withStore("UTC", async (pool) => {
      const s3 = new PostgresControllableGenerationS3();
      s3.failDeleteGeneration = "2";
      const fake = s3 as unknown as S3Client;
      const owner = await session(pool, "postgres-generation-delete-retry");
      const publication = { ownerSessionId: owner, publicationId: "postgres-generation-delete-retry", bytes: Uint8Array.of(7), contentType: "application/octet-stream" } as const;
      const firstStore = new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool));
      const first = firstStore.put(publication);
      await s3.putStarted[0].promise;
      await new CleanupService(new PostgresGovernanceStore(pool), firstStore).run({ now: new Date("2030-01-01T00:00:00.000Z") });
      const secondStore = new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool));
      const second = secondStore.put(publication);
      await s3.putStarted[1].promise;
      await new CleanupService(new PostgresGovernanceStore(pool), secondStore).run({ now: new Date("2031-01-01T00:00:00.000Z") });
      s3.putGates[0].resolve();
      await expect(first).rejects.toThrow("OBJECT_PUBLICATION_DELETED");
      s3.putGates[1].resolve();
      await expect(second).rejects.toThrow("postgres generation 2 delete failed");
      let row = (await pool.query("SELECT * FROM object_references")).rows[0];
      expect(row).toMatchObject({
        lifecycle: "tombstone-pending",
        publication_generation: "2",
        publication_token: expect.any(String),
        publication_put_may_still_complete: false,
      });
      expect(row.publication_cleanup_token).toBeNull();
      expect(s3.objects.size).toBe(1);

      await new CleanupService(new PostgresGovernanceStore(pool), new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)))
        .run({ now: new Date("2031-01-01T00:01:00.000Z") });
      row = (await pool.query("SELECT lifecycle FROM object_references")).rows[0];
      expect(row.lifecycle).toBe("deleted");
      expect(s3.objects.size).toBe(0);
      expect(s3.deletes.filter((item) => item.generation === "2")).toHaveLength(2);
    });
  });

  it("keeps active PostgreSQL generation C readable when an ambiguous A delete applies late and B cleanup retries after restart", async () => {
    await withStore("UTC", async (pool) => {
      const s3 = new PostgresAmbiguousDeleteGenerationS3();
      s3.ambiguousDeleteGeneration = "1";
      const fake = s3 as unknown as S3Client;
      const owner = await session(pool, "postgres-ambiguous-delete-isolation");
      const publication = { ownerSessionId: owner, publicationId: "postgres-ambiguous-delete-isolation", bytes: Uint8Array.of(9, 2), contentType: "application/octet-stream" } as const;

      const first = new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)).put(publication);
      const firstOutcome = expect(first).rejects.toThrow("postgres delete response lost for generation 1");
      await s3.putStarted[0].promise;
      await new CleanupService(new PostgresGovernanceStore(pool), new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)))
        .run({ now: new Date("2030-01-01T00:00:00.000Z") });
      const second = new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)).put(publication);
      await s3.putStarted[1].promise;
      await new CleanupService(new PostgresGovernanceStore(pool), new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)))
        .run({ now: new Date("2031-01-01T00:00:00.000Z") });

      s3.putGates[0].resolve();
      await firstOutcome;
      let generations = (await pool.query(
        "SELECT publication_generation,physical_object_key,delete_outcome,cleanup_token,deleted_at FROM object_publication_generations ORDER BY publication_generation",
      )).rows;
      expect(generations[0]).toMatchObject({ publication_generation: "1", delete_outcome: "outcome-uncertain", cleanup_token: null, deleted_at: null });

      const third = new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)).put(publication);
      await s3.putStarted[2].promise;
      s3.putGates[2].resolve();
      const activeC = await third;
      expect(activeC).toMatchObject({ lifecycle: "active", publicationGeneration: 3 });
      expect(new Set(s3.putKeys).size).toBe(3);
      expect(s3.putKeys.every((key) => key.includes("/generations/"))).toBe(true);
      let row = (await pool.query("SELECT logical_publication_key,object_key,lifecycle,publication_generation FROM object_references")).rows[0];
      expect(row).toMatchObject({ object_key: activeC.objectKey, lifecycle: "active", publication_generation: "3" });

      s3.delayedDeleteGate.resolve();
      await s3.delayedDeleteApplied.promise;
      expect(s3.objects.has(s3.putKeys[0])).toBe(false);
      expect(s3.objects.has(activeC.objectKey)).toBe(true);
      await expect(new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)).head(activeC.id, owner))
        .resolves.toMatchObject({ byteSize: 2 });

      s3.failRetryGeneration = "2";
      const secondOutcome = expect(second).rejects.toThrow("postgres delete retry failed for generation 2");
      s3.putGates[1].resolve();
      await secondOutcome;
      generations = (await pool.query(
        "SELECT publication_generation,delete_outcome,cleanup_token,deleted_at FROM object_publication_generations ORDER BY publication_generation",
      )).rows;
      expect(generations[1]).toMatchObject({ publication_generation: "2", delete_outcome: "outcome-uncertain", cleanup_token: null, deleted_at: null });

      await new CleanupService(new PostgresGovernanceStore(pool), new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)))
        .run({ now: new Date("2032-01-01T00:00:00.000Z") });
      generations = (await pool.query(
        "SELECT publication_generation,physical_object_key,delete_outcome,deleted_at FROM object_publication_generations ORDER BY publication_generation",
      )).rows;
      expect(generations.map((generation) => ({ generation: generation.publication_generation, outcome: generation.delete_outcome, deleted: generation.deleted_at !== null })))
        .toEqual([
          { generation: "1", outcome: "acknowledged", deleted: true },
          { generation: "2", outcome: "acknowledged", deleted: true },
          { generation: "3", outcome: "not-started", deleted: false },
        ]);
      row = (await pool.query("SELECT object_key,lifecycle,publication_generation FROM object_references")).rows[0];
      expect(row).toEqual({ object_key: activeC.objectKey, lifecycle: "active", publication_generation: "3" });
      expect(s3.objects.size).toBe(1);
      expect(s3.objects.has(activeC.objectKey)).toBe(true);
      expect(s3.deleteTargets).not.toContain(activeC.objectKey);
      await expect(new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)).get(activeC.id, owner))
        .resolves.toMatchObject({ bytes: publication.bytes });
    });
  });

  it("recovers actual PostgreSQL deletion after both applied and non-applied Delete acknowledgement loss", async () => {
    await withStore("UTC", async (pool) => {
      for (const remoteApplies of [true, false]) {
        const s3 = new PostgresAmbiguousDeleteGenerationS3();
        s3.ambiguousDeleteGeneration = "1";
        s3.applyAmbiguousDelete = remoteApplies;
        s3.putGates[0].resolve();
        const fake = s3 as unknown as S3Client;
        const owner = await session(pool, `postgres-single-delete-${remoteApplies}`);
        const store = new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool));
        const created = await store.put({ ownerSessionId: owner, publicationId: `postgres-single-delete-${remoteApplies}`, bytes: Uint8Array.of(6), contentType: "application/octet-stream" });
        await expect(store.delete(created.id, owner, new Date("2030-01-01T00:00:00.000Z")))
          .rejects.toThrow("postgres delete response lost for generation 1");
        let generation = (await pool.query(
          "SELECT delete_outcome,cleanup_token,deleted_at FROM object_publication_generations WHERE object_reference_id=$1 AND publication_generation=1",
          [created.id],
        )).rows[0];
        expect(generation).toEqual({ delete_outcome: "outcome-uncertain", cleanup_token: null, deleted_at: null });

        s3.delayedDeleteGate.resolve();
        await s3.delayedDeleteApplied.promise;
        expect(s3.objects.has(created.objectKey)).toBe(!remoteApplies);
        await new CleanupService(new PostgresGovernanceStore(pool), new S3OwnedObjectStore(fake, "integration-bucket", new PostgresGovernanceStore(pool)))
          .run({ now: new Date("2030-01-01T00:01:00.000Z") });
        generation = (await pool.query(
          "SELECT delete_outcome,cleanup_token,deleted_at FROM object_publication_generations WHERE object_reference_id=$1 AND publication_generation=1",
          [created.id],
        )).rows[0];
        expect(generation).toMatchObject({ delete_outcome: "acknowledged", cleanup_token: null, deleted_at: expect.any(Date) });
        expect((await pool.query("SELECT lifecycle,object_key FROM object_references WHERE id=$1", [created.id])).rows[0])
          .toEqual({ lifecycle: "deleted", object_key: created.objectKey });
        expect(s3.objects.size).toBe(0);
      }
    });
  });
});
