import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { applyMigrationsWithClient, MIGRATIONS, migrationChecksum, validateMigrationInventory, verifyMigrationsWithClient } from "./migrations";

class MigrationClientFake {
  readonly calls: string[] = [];
  readonly applied: Array<{ version: number; name: string; checksum: string }> = [];
  failFoundation = false;
  async query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    this.calls.push(text);
    if (text.startsWith("SELECT version")) return { rows: this.applied.map((row) => ({ ...row })), rowCount: this.applied.length };
    if (text.startsWith("INSERT INTO schema_migrations")) {
      this.applied.push({ version: values?.[0] as number, name: values?.[1] as string, checksum: values?.[2] as string });
    }
    if (this.failFoundation && text.includes("CREATE TABLE IF NOT EXISTS anonymous_sessions")) throw new Error("fixture failure");
    return { rows: [], rowCount: 0 };
  }
}

describe("versioned PostgreSQL migrations", () => {
  it("has a monotonic inventory with durable constraints and Segment-D-only foundation", () => {
    expect(() => validateMigrationInventory(MIGRATIONS)).not.toThrow();
    expect(MIGRATIONS.map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const sql = MIGRATIONS[0].sql;
    for (const required of ["anonymous_sessions", "quota_windows", "idempotency_records", "share_records", "object_references", "omr_jobs", "omr_pages", "omr_evidence", "omr_review_metadata", "REFERENCES", "UNIQUE", "expires_at"]) expect(sql).toContain(required);
    expect(sql).not.toContain("vendor_name");
    expect(MIGRATIONS[1].sql).toContain("claim_expires_at");
    expect(MIGRATIONS[1].sql).toContain("state = 'pending'");
    expect(MIGRATIONS[2].sql).toContain("share-create-v1");
    expect(MIGRATIONS[2].sql).toContain("share-create-replay-v1");
    expect(MIGRATIONS[2].sql).toContain("ciphertext");
    for (const required of ["omr_create_idempotency", "provider_transfer_consent", "credit_estimate", "quality_report", "vendor_result_digest", "delete-pending"]) expect(MIGRATIONS[3].sql).toContain(required);
    for (const required of ["operation_lease_token", "reconciliation-required", "vendor_delete_next_attempt_at", "upload_lease_token", "normalization_mapping"]) expect(MIGRATIONS[4].sql).toContain(required);
    for (const required of ["canonical_create_request", "operation_request_digest", "result_capture_lease_token", "cleanup_lease_token"]) expect(MIGRATIONS[5].sql).toContain(required);
    for (const required of ["provider_binding_id", "adapter_contract_version", "sync-retry-pending", "capture-retry-pending", "retry_next_attempt_at"]) expect(MIGRATIONS[6].sql).toContain(required);
    for (const required of ["vendor_create_outcome_state", "not-attempted", "definitive-no-job", "outcome-uncertain", "confirmed", "omr_create_idempotency"]) expect(MIGRATIONS[7].sql).toContain(required);
    for (const required of ["status_observation_lease_token", "accepted_input_digest", "publication_token", "upload-pending", "2147483647"]) expect(MIGRATIONS[8].sql).toContain(required);
    for (const required of ["publication_generation", "publication_put_may_still_complete", "publication_predecessor_token", "publication_cleanup_token", "tombstone-pending"]) expect(MIGRATIONS[9].sql).toContain(required);
    for (const required of ["logical_publication_key", "object_publication_generations", "physical_object_key", "outcome-uncertain", "cleanup_lease_expires_at"]) expect(MIGRATIONS[10].sql).toContain(required);
    for (const required of ["abuse_reports_status_check", "claim_token", "claim_expires_at", "claimed_by", "resolution", "abuse_report_id"]) expect(MIGRATIONS[11].sql).toContain(required);
    for (const required of ["omr_provider_delete_operations", "operation_generation", "provider_binding_id", "idempotency_key", "dispatch_outcome", "reconciliation_required", "claim_lease_expires_at"]) expect(MIGRATIONS[12].sql).toContain(required);
    for (const required of ["idempotency_share_create_recovery_idx", "operation", "key_hash", "expires_at", "share-create-v1"]) expect(MIGRATIONS[13].sql).toContain(required);
    for (const required of ["cleanup_last_attempt_at", "omr_jobs_cleanup_fairness_idx", "NULLS FIRST", "expires_at"]) expect(MIGRATIONS[14].sql).toContain(required);
  });

  it("applies transactionally once and safely re-applies", async () => {
    const client = new MigrationClientFake();
    await expect(applyMigrationsWithClient(client)).resolves.toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    await expect(applyMigrationsWithClient(client)).resolves.toEqual([]);
    await expect(verifyMigrationsWithClient(client)).resolves.toBeUndefined();
    expect(client.calls.filter((call) => call === "COMMIT")).toHaveLength(2);
  });

  it("keeps additive Ultra SQL artifacts semantic with their checksummed runtime migrations", async () => {
    const expectedChecksums = new Map([
      [12, "68fae44f5fb02cbdf42bb0a4d510627a4a5b8b29b279378590ab41d776ed44d2"],
      [13, "d86e98a41a0e72f121e7bd12a89bbca7b8c7fa4578a9f09cec3a7778d7d3ccb5"],
      [14, "bcb47b6c00099e24c215e829259def5e981f0e6757cc36e431f5f1b8f79f3140"],
      [15, "1097517a33a1ca967e850aea6f4b42a9ce870ca719e20152e3a5f87474f2371c"],
    ]);
    for (const migration of MIGRATIONS.filter(({ version }) => version >= 12)) {
      const filename = `${String(migration.version).padStart(3, "0")}_${migration.name}.sql`;
      const checkedIn = await readFile(join(process.cwd(), "src/server/persistence/migrations", filename), "utf8");
      const normalizeSql = (sql: string) => sql.replace(/\s+/g, " ").trim();
      expect(normalizeSql(checkedIn), filename).toBe(normalizeSql(migration.sql));
      expect(migrationChecksum(migration), filename).toBe(expectedChecksums.get(migration.version));
    }
  });

  it("runtime verification is read-only and rejects stale schema", async () => {
    const current = new MigrationClientFake();
    current.applied.push(...MIGRATIONS.map((migration) => ({ version: migration.version, name: migration.name, checksum: migrationChecksum(migration) })));
    await expect(verifyMigrationsWithClient(current)).resolves.toBeUndefined();
    expect(current.calls).toEqual([expect.stringMatching(/^SELECT version/u)]);
    const stale = new MigrationClientFake();
    stale.applied.push(...current.applied.slice(0, -1));
    await expect(verifyMigrationsWithClient(stale)).rejects.toThrow("MIGRATION_REQUIRED");
    expect(stale.calls).toEqual([expect.stringMatching(/^SELECT version/u)]);
  });

  it("rejects skipped/reordered history and rolls back failures", async () => {
    const diverged = new MigrationClientFake();
    diverged.applied.push({ version: 1, name: "wrong", checksum: migrationChecksum(MIGRATIONS[0]) });
    await expect(applyMigrationsWithClient(diverged)).rejects.toThrow("MIGRATION_HISTORY_DIVERGED");
    expect(diverged.calls.at(-1)).toBe("ROLLBACK");
    const failed = new MigrationClientFake();
    failed.failFoundation = true;
    await expect(applyMigrationsWithClient(failed)).rejects.toThrow("fixture failure");
    expect(failed.calls.at(-1)).toBe("ROLLBACK");
  });

  it("rejects a locally reordered or skipped inventory", () => {
    expect(() => validateMigrationInventory([{ ...MIGRATIONS[0], version: 2 }])).toThrow("MIGRATION_INVENTORY_INVALID");
  });
});
