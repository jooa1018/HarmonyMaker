import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Pool } from "pg";
import type { PrivateRowId } from "../persistence/store";
import { PostgresOmrStore } from "./postgres-store";

interface FakeJobRow {
  state: string;
  operation_kind: string | null;
  operation_lease_token: string | null;
}

class LockedPoolFake {
  readonly calls: string[] = [];
  readonly row: FakeJobRow = { state: "processing", operation_kind: null, operation_lease_token: null };
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
          releaseLock = await this.acquire();
          if (sql.startsWith("SELECT id FROM omr_jobs")) return { rows: [], rowCount: 0 };
          return { rows: [{ ...this.row }], rowCount: 1 };
        }
        if (sql.startsWith("UPDATE omr_jobs SET")) {
          const assignments = sql.slice(sql.indexOf(" SET ") + 5, sql.indexOf(" WHERE ")).split(",");
          for (const assignment of assignments) {
            const match = /^([a-z_]+)=\$(\d+)$/u.exec(assignment.trim());
            if (!match) continue;
            const value = values[Number(match[2]) - 1];
            if (match[1] === "state") this.row.state = String(value);
            if (match[1] === "operation_kind") this.row.operation_kind = value === null ? null : String(value);
            if (match[1] === "operation_lease_token") this.row.operation_lease_token = value === null ? null : String(value);
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

  it("claims expired handles and due delete-pending retries in one SKIP LOCKED cleanup query", async () => {
    const pool = new LockedPoolFake();
    const store = new PostgresOmrStore(pool as unknown as Pool);
    await expect(store.claimCleanup("2026-01-01T00:00:00.000Z", 10)).resolves.toEqual([]);
    const sql = pool.calls.find((call) => call.includes("FOR UPDATE SKIP LOCKED"));
    expect(sql).toContain("handle_active=true AND expires_at <= $1");
    expect(sql).toContain("state='delete-pending'");
    expect(sql).toContain("vendor_delete_next_attempt_at");
    expect(sql).toContain("local_delete_next_attempt_at");
  });
});
