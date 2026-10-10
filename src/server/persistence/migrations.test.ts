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
    expect(MIGRATIONS.map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
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
    await expect(applyMigrationsWithClient(client)).resolves.toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    await expect(applyMigrationsWithClient(client)).resolves.toEqual([]);
    await expect(verifyMigrationsWithClient(client)).resolves.toBeUndefined();
    expect(client.calls.filter((call) => call === "COMMIT")).toHaveLength(2);
  });

  it("pins the version, name and exact SQL checksum of migrations 1–16", () => {
    // Approved deployed-history baseline. Never regenerate to accommodate an SQL edit.
    const expected = [
      [1, "segment_c_foundation", "eb91c7e50c00277a965b7732124602b2e175b3da0317990f140d1b07ac933c98"],
      [2, "idempotency_recovery", "39e9804d3816351383458b38e3220500b0dddcdc04c13a4a7a5c7a14cd30925e"],
      [3, "share_replay_envelope", "28b691d68ca83da2babc41e05688e9fea76f009fea83329e06b40f24b9a1c1e1"],
      [4, "omr_core", "1988920e0c2f23809f5fe54cc3c533b3cfd3ade5e7b4ffb237305b39fd2bbdfa"],
      [5, "omr_recovery", "592c3defe170239d1d174e3ee037d167194e1e3093ead307d73bc25b32c8d60f"],
      [6, "omr_correctness_closure", "b2449e17d64e757e1188171cd457257f5d109497446a09b9590c056b2b8069d8"],
      [7, "omr_provider_safety", "8c021c5f1fbb32703fdc0289645fc632894424cc226d3e567acbc47c1d12d3a0"],
      [8, "omr_create_outcome_certainty", "bba5c4a48fdd50f653251acf24f6471ad6036a6d01715d8d880cb60607a9df52"],
      [9, "omr_resaturation_closure", "c0200adbbdcde4fa057e4e8905ad51d6d4f1a9571b6b8a7775ab58b33a3837d3"],
      [10, "object_publication_late_put_fencing", "73dc27392da51c5dcdd94dcdcd31f0773ce284a65691a57a7fa142fff333f527"],
      [11, "object_publication_physical_key_isolation", "52a32d7168a031ac0dbd1e83f8a22aa7d71124943902abd28546faf8813c0089"],
      [12, "share_moderation_lifecycle", "68fae44f5fb02cbdf42bb0a4d510627a4a5b8b29b279378590ab41d776ed44d2"],
      [13, "omr_provider_delete_authority", "d86e98a41a0e72f121e7bd12a89bbca7b8c7fa4578a9f09cec3a7778d7d3ccb5"],
      [14, "share_create_cross_session_recovery", "bcb47b6c00099e24c215e829259def5e981f0e6757cc36e431f5f1b8f79f3140"],
      [15, "omr_cleanup_fairness", "1097517a33a1ca967e850aea6f4b42a9ce870ca719e20152e3a5f87474f2371c"],
      [16, "share_retention", "d067c02cdb14ca712979f7765b2bbea12a3f0f646d40d3adaca4dd1827721e9c"],
    ];
    expect(MIGRATIONS.slice(0, 16).map(m => [m.version, m.name, migrationChecksum(m)])).toEqual(expected);
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(16);
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
