import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Pool } from "pg";
import type { PrivateRowId } from "../persistence/store";
import { PostgresOmrStore } from "./postgres-store";
import {
  ACTIVE_OMR_LIFECYCLE_STATES, VENDOR_CLEANUP_EXPOSURE_STATES, hasActiveOmrVendorExposure,
} from "./store";

interface FakeJobRow extends Record<string, unknown> {
  state: string;
  operation_kind: string | null;
  operation_request_digest: string | null;
  operation_lease_token: string | null;
  operation_lease_expires_at: string | null;
  result_capture_lease_token: string | null;
  cleanup_lease_token: string | null;
  cleanup_lease_expires_at: string | null;
  reconciliation_kind: string | null;
  public_failure_code: string | null;
  public_failure_message_ko: string | null;
  vendor_create_outcome_state: string;
  vendor_job_id_envelope: Record<string, unknown> | null;
  upload_state: string | null;
  upload_lease_token: string | null;
}

class LockedPoolFake {
  readonly calls: string[] = [];
  cleanupCandidate = false;
  createIdempotencyState = "pending";
  readonly row: FakeJobRow = {
    id: "1", owner_session_id: "1", ip_owner_hash: "ip:fixture", public_handle_hash: "handle:fixture",
    public_handle_replay_envelope: { version: "aead-v1", associatedDataVersion: "test", iv: "iv", ciphertext: "cipher", tag: "tag" },
    expires_at: "2026-01-02T00:00:00.000Z", source_kind: "camera-photo", page_count: 1,
    canonical_create_request: { pageCount: 1, pages: [], sourceKind: "camera-photo", rights: { basis: "user-confirmed-rights", allowedUses: ["provider-transfer"] }, providerTransferConsent: true, consentCapabilitySnapshotDigest: "a".repeat(64), idempotencyKey: "fixture" },
    rights_json: { basis: "user-confirmed-rights", allowedUses: ["provider-transfer"] }, provider_consent_recorded_at: "2026-01-01T00:00:00.000Z",
    capability_snapshot: { vendorId: "fixture" }, capability_snapshot_digest: "a".repeat(64), vendor_create_idempotency_key: "vendor-key",
    vendor_create_lease_expires_at: "2026-01-01T00:00:00.000Z", vendor_create_outcome_state: "confirmed", vendor_job_id_envelope: null, credit_estimate: 1, credit_state: "reserved",
    vendor_delete_state: "not-started", local_delete_state: "not-started", handle_active: true,
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    state: "processing", operation_kind: null, operation_request_digest: null, operation_lease_token: null, operation_lease_expires_at: null,
    result_capture_lease_token: null, cleanup_lease_token: null, cleanup_lease_expires_at: null,
    reconciliation_kind: null, public_failure_code: null, public_failure_message_ko: null,
    upload_state: null, upload_lease_token: null,
  };
  private lock = Promise.resolve();

  async acquire(): Promise<() => void> {
    const prior = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((resolve) => { release = resolve; });
    await prior;
    return release;
  }

  async connect() {
    let releaseLock: (() => void) | undefined;
    return {
      query: async (sql: string, values: readonly unknown[] = []) => {
        this.calls.push(sql);
        if (sql.includes("FOR UPDATE")) {
          if (!releaseLock) releaseLock = await this.acquire();
          if (sql.startsWith("SELECT id FROM omr_jobs")) return { rows: this.cleanupCandidate ? [{ id: this.row.id }] : [], rowCount: this.cleanupCandidate ? 1 : 0 };
          return { rows: [{ ...this.row }], rowCount: 1 };
        }
        if (sql.startsWith("SELECT * FROM omr_jobs")) return { rows: [{ ...this.row }], rowCount: 1 };
        if (sql.startsWith("SELECT * FROM omr_pages")) return { rows: [], rowCount: 0 };
        if (sql === "SELECT id FROM omr_jobs WHERE id=$1") return { rows: [{ id: this.row.id }], rowCount: 1 };
        if (sql.startsWith("UPDATE omr_create_idempotency SET state='complete'")) {
          if (this.createIdempotencyState !== "pending") return { rows: [], rowCount: 0 };
          this.createIdempotencyState = "complete";
          return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith("UPDATE omr_jobs")) {
          if (sql.includes("vendor_job_id_envelope=$2")) {
            const leaseToken = values[4] === null ? null : String(values[4]);
            const publicRecovery = sql.includes("state='created'");
            const statePermitsPublicRecovery = this.row.state === "created"
              || (this.row.state === "reconciliation-required" && this.row.reconciliation_kind === "create");
            const authorityMatches = publicRecovery
              ? this.row.handle_active === true && statePermitsPublicRecovery
                && this.row.cleanup_lease_token === null && leaseToken === null
                && this.row.vendor_create_lease_expires_at === values[5]
              : this.row.handle_active === false && this.row.state === "delete-pending"
                && (leaseToken === null
                  ? this.row.cleanup_lease_token === null && this.row.vendor_create_lease_expires_at === values[5]
                  : this.row.cleanup_lease_token === leaseToken);
            const matches = this.createIdempotencyState === "pending"
              && this.row.state === values[3]
              && this.row.vendor_create_outcome_state === "outcome-uncertain"
              && this.row.vendor_job_id_envelope === null
              && authorityMatches;
            if (!matches) return { rows: [], rowCount: 0 };
            this.row.vendor_job_id_envelope = JSON.parse(String(values[1])) as Record<string, unknown>;
            this.row.vendor_create_outcome_state = "confirmed";
            if (publicRecovery) {
              this.row.state = "created";
              this.row.reconciliation_kind = null;
              this.row.public_failure_code = null;
              this.row.public_failure_message_ko = null;
            }
            return { rows: [{ id: this.row.id }], rowCount: 1 };
          }
          if (sql.includes("state='reconciliation-required',reconciliation_kind='create'")) {
            const statePermitsReplay = this.row.state === "created"
              || (this.row.state === "reconciliation-required" && this.row.reconciliation_kind === "create");
            const matches = this.createIdempotencyState === "pending"
              && this.row.handle_active === true && this.row.state === values[1] && statePermitsReplay
              && this.row.vendor_create_outcome_state === "outcome-uncertain"
              && this.row.vendor_create_lease_expires_at === values[2]
              && this.row.vendor_job_id_envelope === null && this.row.cleanup_lease_token === null;
            if (!matches) return { rows: [], rowCount: 0 };
            this.row.state = "reconciliation-required";
            this.row.reconciliation_kind = "create";
            this.row.public_failure_code = String(values[3]);
            this.row.public_failure_message_ko = String(values[4]);
            return { rows: [], rowCount: 1 };
          }
          if (sql.includes("handle_active=false,state='delete-pending'")) {
            if (!this.row.handle_active) return { rows: [], rowCount: 0 };
            this.row.handle_active = false;
            this.row.state = "delete-pending";
            if (this.row.credit_state !== "settled") {
              const preserve = this.row.credit_state === "reserved"
                && (this.row.vendor_create_outcome_state === "outcome-uncertain"
                  || (this.row.vendor_create_outcome_state === "confirmed" && this.row.vendor_delete_state !== "deleted"));
              this.row.credit_state = preserve ? "reserved" : "released";
            }
            return { rows: [], rowCount: 1 };
          }
          if (sql.includes("state=CASE WHEN state='delete-pending'")) {
            if (this.row.state !== "delete-pending") this.row.state = "expired";
            this.row.handle_active = false;
            if (this.row.credit_state !== "settled") {
              const preserve = this.row.credit_state === "reserved"
                && (this.row.vendor_create_outcome_state === "outcome-uncertain"
                  || (this.row.vendor_create_outcome_state === "confirmed" && this.row.vendor_delete_state !== "deleted"));
              this.row.credit_state = preserve ? "reserved" : "released";
            }
            this.row.cleanup_lease_token = String(values[2]);
            this.row.cleanup_lease_expires_at = String(values[3]);
            return { rows: [], rowCount: 1 };
          }
          const assignments = sql.slice(sql.indexOf(" SET ") + 5, sql.indexOf(" WHERE ")).split(",");
          for (const assignment of assignments) {
            const match = /^([a-z_]+)=\$(\d+)$/u.exec(assignment.trim());
            if (!match) continue;
            const value = values[Number(match[2]) - 1];
            if (match[1] === "state") this.row.state = String(value);
            if (match[1] === "operation_kind") this.row.operation_kind = value === null ? null : String(value);
            if (match[1] === "operation_request_digest") this.row.operation_request_digest = value === null ? null : String(value);
            if (match[1] === "operation_lease_token") this.row.operation_lease_token = value === null ? null : String(value);
            if (match[1] === "operation_lease_expires_at") this.row.operation_lease_expires_at = value === null ? null : String(value);
            if (match[1] === "result_capture_lease_token") this.row.result_capture_lease_token = value === null ? null : String(value);
            if (match[1] === "cleanup_lease_token") this.row.cleanup_lease_token = value === null ? null : String(value);
          }
          return { rows: [], rowCount: 1 };
        }
        if (sql === "COMMIT" || sql === "ROLLBACK") { const release = releaseLock; releaseLock = undefined; release?.(); }
        return { rows: [], rowCount: 0 };
      },
      release: () => { const release = releaseLock; releaseLock = undefined; release?.(); },
    };
  }

  async query(sql: string, values: readonly unknown[] = []) {
    const client = await this.connect();
    try { return await client.query(sql, values); } finally { client.release(); }
  }
}

interface QuotaExposure {
  readonly ownerSessionId: string;
  readonly ipOwnerHash: string;
  readonly state: Parameters<typeof hasActiveOmrVendorExposure>[0]["state"];
  readonly vendorCreateOutcomeState: Parameters<typeof hasActiveOmrVendorExposure>[0]["vendorCreateOutcomeState"];
  readonly vendorDeleteState: Parameters<typeof hasActiveOmrVendorExposure>[0]["vendorDeleteState"];
  readonly createdAt: string;
  readonly creditState: "reserved" | "settled" | "released";
  readonly creditEstimate: number;
}

class QuotaPoolFake {
  readonly calls: Array<{ readonly sql: string; readonly values: readonly unknown[] }> = [];
  constructor(private readonly exposures: readonly QuotaExposure[]) {}

  async connect() {
    return {
      query: async (sql: string, values: readonly unknown[] = []) => {
        this.calls.push({ sql, values });
        if (sql.includes("FROM omr_create_idempotency")) return { rows: [], rowCount: 0 };
        if (sql.includes("AS session_active")) {
          const ownerSessionId = String(values[0]); const ipOwnerHash = String(values[1]); const now = String(values[2]);
          const active = this.exposures.filter(hasActiveOmrVendorExposure);
          const day = now.slice(0, 10);
          return { rows: [{
            session_active: active.filter((job) => job.ownerSessionId === ownerSessionId).length,
            ip_active: active.filter((job) => job.ipOwnerHash === ipOwnerHash).length,
            session_hour: 0, ip_hour: 0,
            day_credit: this.exposures.filter((job) => job.creditState === "reserved"
              || (job.createdAt.startsWith(day) && job.creditState !== "released"))
              .reduce((sum, job) => sum + job.creditEstimate, 0),
          }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    };
  }
}

describe("PostgreSQL OMR transition fencing", () => {
  it("serializes racing state transitions with SELECT FOR UPDATE so only a legal winner persists", async () => {
    const pool = new LockedPoolFake();
    const store = new PostgresOmrStore(pool as unknown as Pool);
    const jobId = "1" as PrivateRowId;
    const results = await Promise.allSettled([
      store.transition(jobId, { state: "completed" }, "2026-01-01T00:00:00.000Z"),
      store.transition(jobId, { state: "cancel-pending" }, "2026-01-01T00:00:00.001Z"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(["completed", "cancel-pending"]).toContain(pool.row.state);
    expect(pool.calls.filter((sql) => sql === "SELECT state FROM omr_jobs WHERE id=$1 FOR UPDATE")).toHaveLength(2);
  });

  it("rejects stale operation lease tokens and clears the matching fence atomically", async () => {
    const pool = new LockedPoolFake();
    pool.row.state = "cancel-pending"; pool.row.operation_kind = "cancel"; pool.row.operation_lease_token = "lease-current";
    const store = new PostgresOmrStore(pool as unknown as Pool);
    const jobId = "1" as PrivateRowId;
    await expect(store.completeOperation({ jobId, kind: "cancel", leaseToken: "lease-stale", update: { state: "cancelled" }, now: "2026-01-01T00:00:00.000Z" })).resolves.toBe(false);
    expect(pool.row.state).toBe("cancel-pending");
    await expect(store.completeOperation({ jobId, kind: "cancel", leaseToken: "lease-current", update: { state: "cancelled" }, now: "2026-01-01T00:00:01.000Z" })).resolves.toBe(true);
    expect(pool.row).toMatchObject({ state: "cancelled", operation_kind: null, operation_lease_token: null });
  });

  it("binds abandoned submit-input claims to the same request digest before resuming", async () => {
    const pool = new LockedPoolFake();
    pool.row.state = "needs-input"; pool.row.operation_kind = "submit-input"; pool.row.operation_request_digest = "a".repeat(64);
    pool.row.operation_lease_token = "abandoned"; pool.row.operation_lease_expires_at = "2026-01-01T00:00:00.000Z";
    const store = new PostgresOmrStore(pool as unknown as Pool); const jobId = "1" as PrivateRowId;
    await expect(store.claimOperation({ jobId, kind: "submit-input", operationRequestDigest: "b".repeat(64) as never, expectedStates: ["needs-input"], leaseToken: "new", leaseExpiresAt: "2026-01-01T00:10:00.000Z", supportsIdempotency: true, now: "2026-01-01T00:05:00.000Z" })).resolves.toEqual({ status: "request-conflict" });
    await expect(store.claimOperation({ jobId, kind: "submit-input", operationRequestDigest: "a".repeat(64) as never, expectedStates: ["needs-input"], leaseToken: "new", leaseExpiresAt: "2026-01-01T00:10:00.000Z", supportsIdempotency: true, now: "2026-01-01T00:05:00.000Z" })).resolves.toMatchObject({ status: "resume", job: { operationRequestDigest: "a".repeat(64), operationLeaseToken: "new" } });
  });

  it("locks job and page state before completing a page and rejects deletion races", async () => {
    const pool = new LockedPoolFake(); pool.row.state = "uploading"; pool.row.upload_state = "pending"; pool.row.upload_lease_token = "page-current";
    const store = new PostgresOmrStore(pool as unknown as Pool); const jobId = "1" as PrivateRowId;
    await expect(store.completePage(jobId, 0, "page-stale", "9" as PrivateRowId, "2026-01-01T00:00:00.000Z")).resolves.toBe(false);
    await expect(store.completePage(jobId, 0, "page-current", "9" as PrivateRowId, "2026-01-01T00:00:01.000Z")).resolves.toBe(true);
    pool.row.state = "delete-pending";
    await expect(store.completePage(jobId, 0, "page-current", "10" as PrivateRowId, "2026-01-01T00:00:02.000Z")).resolves.toBe(false);
    expect(pool.calls.filter((sql) => sql === "SELECT state FROM omr_jobs WHERE id=$1 FOR UPDATE")).toHaveLength(3);
    expect(pool.calls.filter((sql) => sql.startsWith("SELECT upload_state,upload_lease_token FROM omr_pages") && sql.includes("FOR UPDATE"))).toHaveLength(3);
  });

  it("fences result capture and cleanup completion with dedicated lease tokens", async () => {
    const pool = new LockedPoolFake(); const store = new PostgresOmrStore(pool as unknown as Pool); const jobId = "1" as PrivateRowId;
    pool.row.state = "processing"; pool.row.result_capture_lease_token = "result-current";
    await expect(store.completeResultCapture({ jobId, leaseToken: "result-stale", update: { state: "completed" }, now: "2026-01-01T00:00:00.000Z" })).resolves.toBe(false);
    await expect(store.completeResultCapture({ jobId, leaseToken: "result-current", update: { state: "completed" }, now: "2026-01-01T00:00:01.000Z" })).resolves.toBe(true);
    expect(pool.row.result_capture_lease_token).toBeNull();
    pool.row.state = "expired"; pool.row.cleanup_lease_token = "cleanup-current";
    await expect(store.completeCleanup({ jobId, leaseToken: "cleanup-stale", update: { state: "delete-pending" }, now: "2026-01-01T00:00:02.000Z" })).resolves.toBe(false);
    await expect(store.completeCleanup({ jobId, leaseToken: "cleanup-current", update: { state: "delete-pending" }, now: "2026-01-01T00:00:03.000Z" })).resolves.toBe(true);
    expect(pool.row.cleanup_lease_token).toBeNull();
  });

  it("claims expired handles and due delete-pending retries in one SKIP LOCKED cleanup query", async () => {
    const pool = new LockedPoolFake();
    const store = new PostgresOmrStore(pool as unknown as Pool);
    await expect(store.claimCleanup({ now: "2026-01-01T00:00:00.000Z", limit: 10, leaseToken: "cleanup:1", leaseExpiresAt: "2026-01-01T00:05:00.000Z" })).resolves.toEqual([]);
    const sql = pool.calls.find((call) => call.includes("FOR UPDATE SKIP LOCKED"));
    expect(sql).toContain("handle_active=true AND expires_at <= $1");
    expect(sql).toContain("OR state='expired'");
    expect(sql).toContain("state='delete-pending'");
    expect(sql).toContain("vendor_delete_next_attempt_at");
    expect(sql).toContain("local_delete_next_attempt_at");
  });

  it("preserves uncertain create credit exposure in PostgreSQL cleanup claims and releases definitive no-job credit", async () => {
    const uncertainPool = new LockedPoolFake(); uncertainPool.cleanupCandidate = true;
    uncertainPool.row.state = "reconciliation-required";
    uncertainPool.row.vendor_create_outcome_state = "outcome-uncertain";
    const uncertainStore = new PostgresOmrStore(uncertainPool as unknown as Pool);
    await expect(uncertainStore.claimCleanup({
      now: "2026-01-03T00:00:00.000Z", limit: 10,
      leaseToken: "cleanup:uncertain", leaseExpiresAt: "2026-01-03T00:05:00.000Z",
    })).resolves.toMatchObject([{ creditState: "reserved", vendorCreateOutcomeState: "outcome-uncertain" }]);
    const claimSql = uncertainPool.calls.find((call) => call.includes("state=CASE WHEN state='delete-pending'"));
    expect(claimSql).toContain("vendor_create_outcome_state='outcome-uncertain'");
    expect(claimSql).toContain("vendor_delete_state<>'deleted'");

    const noJobPool = new LockedPoolFake(); noJobPool.cleanupCandidate = true;
    noJobPool.row.state = "failed"; noJobPool.row.vendor_create_outcome_state = "definitive-no-job";
    const noJobStore = new PostgresOmrStore(noJobPool as unknown as Pool);
    await expect(noJobStore.claimCleanup({
      now: "2026-01-03T00:00:00.000Z", limit: 10,
      leaseToken: "cleanup:no-job", leaseExpiresAt: "2026-01-03T00:05:00.000Z",
    })).resolves.toMatchObject([{ creditState: "released", vendorCreateOutcomeState: "definitive-no-job" }]);

    const settledPool = new LockedPoolFake(); settledPool.cleanupCandidate = true;
    settledPool.row.state = "completed"; settledPool.row.credit_state = "settled";
    const settledStore = new PostgresOmrStore(settledPool as unknown as Pool);
    await expect(settledStore.claimCleanup({
      now: "2026-01-01T12:00:00.000Z", limit: 10,
      leaseToken: "cleanup:settled", leaseExpiresAt: "2026-01-01T12:05:00.000Z",
    })).resolves.toMatchObject([{ creditState: "settled" }]);
    settledPool.row.state = "completed"; settledPool.row.handle_active = true; settledPool.row.credit_state = "settled";
    await expect(settledStore.markHandleDeleted("1" as PrivateRowId, "2026-01-01T12:01:00.000Z")).resolves.toBeUndefined();
    expect(settledPool.row).toMatchObject({ state: "delete-pending", credit_state: "settled" });
  });

  it("semantically applies the shared exposure predicate and settled daily credit in PostgreSQL claims", async () => {
    const quota = {
      maxConcurrentJobsPerSession: 1, maxConcurrentJobsPerIp: 2,
      maxJobsPerSessionPerHour: 100, maxJobsPerIpPerHour: 100, dailyGlobalCreditCeiling: 100,
      maxPagesPerJob: 12, maxRetriesPerPage: 3,
    };
    const claim = (store: PostgresOmrStore, ownerSessionId: string, ipOwnerHash: string, dailyGlobalCreditCeiling = 100) => store.claimCreate({
      ownerSessionId: ownerSessionId as PrivateRowId, ipOwnerHash,
      idempotencyKeyHash: `key:${ownerSessionId}`, requestDigest: "a".repeat(64) as never,
      record: { creditEstimate: 1 } as never,
      quota: { ...quota, dailyGlobalCreditCeiling }, now: "2026-01-01T12:00:00.000Z",
    });
    const uncertain = (ownerSessionId: string): QuotaExposure => ({
      ownerSessionId, ipOwnerHash: "ip:shared", state: "delete-pending",
      vendorCreateOutcomeState: "outcome-uncertain", vendorDeleteState: "failed",
      createdAt: "2025-12-31T23:00:00.000Z", creditState: "reserved", creditEstimate: 1,
    });

    const sessionPool = new QuotaPoolFake([uncertain("session:1")]);
    await expect(claim(new PostgresOmrStore(sessionPool as unknown as Pool), "session:1", "ip:new")).resolves.toEqual({ status: "quota-denied" });
    const sessionCount = sessionPool.calls.find((call) => call.sql.includes("AS session_active"));
    expect(sessionCount?.values[3]).toEqual(ACTIVE_OMR_LIFECYCLE_STATES);
    expect(sessionCount?.values[4]).toEqual(VENDOR_CLEANUP_EXPOSURE_STATES);

    const ipPool = new QuotaPoolFake([uncertain("session:1"), uncertain("session:2")]);
    await expect(claim(new PostgresOmrStore(ipPool as unknown as Pool), "session:3", "ip:shared")).resolves.toEqual({ status: "quota-denied" });

    const settledPool = new QuotaPoolFake([{
      ownerSessionId: "session:old", ipOwnerHash: "ip:old", state: "deleted",
      vendorCreateOutcomeState: "confirmed", vendorDeleteState: "deleted",
      createdAt: "2026-01-01T01:00:00.000Z", creditState: "settled", creditEstimate: 1,
    }]);
    await expect(claim(new PostgresOmrStore(settledPool as unknown as Pool), "session:new", "ip:new", 1))
      .resolves.toEqual({ status: "credit-denied" });
  });

  it("atomically restores created lifecycle and clears failure authority for PostgreSQL public recovery", async () => {
    const envelope = {
      version: 1 as const, algorithm: "aes-256-gcm" as const, nonce: "nonce",
      ciphertext: "ciphertext", authenticationTag: "tag", associatedDataVersion: "omr-vendor-job-id-v1",
    };
    for (const initialState of ["created", "reconciliation-required"] as const) {
      const pool = new LockedPoolFake();
      pool.row.state = initialState;
      pool.row.reconciliation_kind = initialState === "reconciliation-required" ? "create" : null;
      pool.row.public_failure_code = "OMR_VENDOR_CREATE_OUTCOME_UNCERTAIN";
      pool.row.public_failure_message_ko = "uncertain";
      pool.row.vendor_create_outcome_state = "outcome-uncertain";
      pool.row.vendor_create_lease_expires_at = "2026-01-01T00:05:00.000Z";
      const store = new PostgresOmrStore(pool as unknown as Pool);
      await expect(store.completeVendorCreation({
        jobId: "1" as PrivateRowId, vendorJobIdEnvelope: envelope, expectedState: initialState,
        expectedVendorCreateLeaseExpiresAt: "2026-01-01T00:05:00.000Z",
        completionMode: "public-handle-recovery", now: "2026-01-01T00:01:00.000Z",
      })).resolves.toBeUndefined();
      expect(pool.row).toMatchObject({
        state: "created", vendor_create_outcome_state: "confirmed", vendor_job_id_envelope: envelope,
        reconciliation_kind: null, public_failure_code: null, public_failure_message_ko: null, handle_active: true,
      });
      expect(pool.createIdempotencyState).toBe("complete");
      const confirmed = structuredClone(pool.row);
      await expect(store.markVendorCreationUnresolved({
        jobId: "1" as PrivateRowId, expectedState: initialState,
        expectedVendorCreateLeaseExpiresAt: "2026-01-01T00:05:00.000Z",
        code: "OMR_VENDOR_CREATE_OUTCOME_UNCERTAIN", messageKo: "stale", now: "2026-01-01T00:02:00.000Z",
      })).rejects.toThrow("OMR_CREATE_COMPLETION_SUPERSEDED");
      expect(pool.row).toEqual(confirmed);
    }
  });

  it("keeps cleanup reconciliation delete-pending, inactive, and fenced by the current cleanup lease", async () => {
    const pool = new LockedPoolFake();
    const store = new PostgresOmrStore(pool as unknown as Pool);
    const envelope = {
      version: 1 as const, algorithm: "aes-256-gcm" as const, nonce: "nonce",
      ciphertext: "ciphertext", authenticationTag: "tag", associatedDataVersion: "omr-vendor-job-id-v1",
    };
    pool.row.state = "delete-pending"; pool.row.handle_active = false;
    pool.row.vendor_create_outcome_state = "outcome-uncertain";
    pool.row.reconciliation_kind = "create";
    pool.row.public_failure_code = "OMR_VENDOR_CREATE_OUTCOME_UNCERTAIN";
    pool.row.public_failure_message_ko = "uncertain";
    pool.row.cleanup_lease_token = "cleanup:current";
    await expect(store.completeVendorCreation({
      jobId: "1" as PrivateRowId, vendorJobIdEnvelope: envelope, expectedState: "delete-pending",
      cleanupLeaseToken: "cleanup:stale", completionMode: "cleanup-reconciliation", now: "2026-01-01T00:01:00.000Z",
    })).rejects.toThrow("OMR_CREATE_COMPLETION_SUPERSEDED");
    await expect(store.completeVendorCreation({
      jobId: "1" as PrivateRowId, vendorJobIdEnvelope: envelope, expectedState: "delete-pending",
      cleanupLeaseToken: "cleanup:current", completionMode: "cleanup-reconciliation", now: "2026-01-01T00:02:00.000Z",
    })).resolves.toBeUndefined();
    expect(pool.row).toMatchObject({
      state: "delete-pending", handle_active: false, cleanup_lease_token: "cleanup:current",
      vendor_create_outcome_state: "confirmed", vendor_job_id_envelope: envelope,
      reconciliation_kind: "create", public_failure_code: "OMR_VENDOR_CREATE_OUTCOME_UNCERTAIN",
    });
    expect(pool.createIdempotencyState).toBe("complete");
  });

  it("semantically fences PostgreSQL unresolved writes by state, lease, envelope, cleanup, and idempotency authority", async () => {
    const pool = new LockedPoolFake();
    pool.row.state = "created";
    pool.row.vendor_create_outcome_state = "outcome-uncertain";
    pool.row.vendor_create_lease_expires_at = "2026-01-01T00:05:00.000Z";
    const store = new PostgresOmrStore(pool as unknown as Pool);
    const unresolved = {
      jobId: "1" as PrivateRowId, expectedState: "created" as const,
      code: "OMR_VENDOR_CREATE_OUTCOME_UNCERTAIN", messageKo: "uncertain", now: "2026-01-01T00:01:00.000Z",
    };
    await expect(store.markVendorCreationUnresolved({
      ...unresolved, expectedVendorCreateLeaseExpiresAt: "2026-01-01T00:04:59.000Z",
    })).rejects.toThrow("OMR_CREATE_COMPLETION_SUPERSEDED");
    expect(pool.row.state).toBe("created");
    await expect(store.markVendorCreationUnresolved({
      ...unresolved, expectedVendorCreateLeaseExpiresAt: "2026-01-01T00:05:00.000Z",
    })).resolves.toBeUndefined();
    expect(pool.row).toMatchObject({
      state: "reconciliation-required", reconciliation_kind: "create",
      vendor_create_outcome_state: "outcome-uncertain", vendor_job_id_envelope: null,
      public_failure_code: "OMR_VENDOR_CREATE_OUTCOME_UNCERTAIN", public_failure_message_ko: "uncertain",
    });
    expect(pool.createIdempotencyState).toBe("pending");

    pool.row.cleanup_lease_token = "cleanup:newer";
    await expect(store.markVendorCreationUnresolved({
      ...unresolved, expectedState: "reconciliation-required",
      expectedVendorCreateLeaseExpiresAt: "2026-01-01T00:05:00.000Z",
    })).rejects.toThrow("OMR_CREATE_COMPLETION_SUPERSEDED");
  });
});
