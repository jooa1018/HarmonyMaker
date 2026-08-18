import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Pool } from "pg";
import type { PrivateRowId } from "../persistence/store";
import { PostgresOmrStore } from "./postgres-store";

interface FakeJobRow extends Record<string, unknown> {
  state: string;
  operation_kind: string | null;
  operation_request_digest: string | null;
  operation_lease_token: string | null;
  operation_lease_expires_at: string | null;
  result_capture_lease_token: string | null;
  cleanup_lease_token: string | null;
  cleanup_lease_expires_at: string | null;
  vendor_create_outcome_state: string;
  upload_state: string | null;
  upload_lease_token: string | null;
}

class LockedPoolFake {
  readonly calls: string[] = [];
  cleanupCandidate = false;
  readonly row: FakeJobRow = {
    id: "1", owner_session_id: "1", ip_owner_hash: "ip:fixture", public_handle_hash: "handle:fixture",
    public_handle_replay_envelope: { version: "aead-v1", associatedDataVersion: "test", iv: "iv", ciphertext: "cipher", tag: "tag" },
    expires_at: "2026-01-02T00:00:00.000Z", source_kind: "camera-photo", page_count: 1,
    canonical_create_request: { pageCount: 1, pages: [], sourceKind: "camera-photo", rights: { basis: "user-confirmed-rights", allowedUses: ["provider-transfer"] }, providerTransferConsent: true, consentCapabilitySnapshotDigest: "a".repeat(64), idempotencyKey: "fixture" },
    rights_json: { basis: "user-confirmed-rights", allowedUses: ["provider-transfer"] }, provider_consent_recorded_at: "2026-01-01T00:00:00.000Z",
    capability_snapshot: { vendorId: "fixture" }, capability_snapshot_digest: "a".repeat(64), vendor_create_idempotency_key: "vendor-key",
    vendor_create_lease_expires_at: "2026-01-01T00:00:00.000Z", vendor_create_outcome_state: "confirmed", credit_estimate: 1, credit_state: "reserved",
    vendor_delete_state: "not-started", local_delete_state: "not-started", handle_active: true,
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    state: "processing", operation_kind: null, operation_request_digest: null, operation_lease_token: null, operation_lease_expires_at: null,
    result_capture_lease_token: null, cleanup_lease_token: null, cleanup_lease_expires_at: null, upload_state: null, upload_lease_token: null,
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
        if (sql.startsWith("UPDATE omr_jobs SET")) {
          if (sql.includes("state=CASE WHEN state='delete-pending'")) {
            if (this.row.state !== "delete-pending") this.row.state = "expired";
            this.row.handle_active = false;
            const preserve = this.row.credit_state === "reserved"
              && (this.row.vendor_create_outcome_state === "outcome-uncertain"
                || (this.row.vendor_create_outcome_state === "confirmed" && this.row.vendor_delete_state !== "deleted"));
            this.row.credit_state = preserve ? "reserved" : "released";
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
  });
});
