import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { applyMigrationsWithClient, MIGRATIONS, migrationChecksum, validateMigrationInventory } from "./migrations";

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
    expect(MIGRATIONS.map((migration) => migration.version)).toEqual([1, 2]);
    const sql = MIGRATIONS[0].sql;
    for (const required of ["anonymous_sessions", "quota_windows", "idempotency_records", "share_records", "object_references", "omr_jobs", "omr_pages", "omr_evidence", "omr_review_metadata", "REFERENCES", "UNIQUE", "expires_at"]) expect(sql).toContain(required);
    expect(sql).not.toContain("vendor_name");
    expect(MIGRATIONS[1].sql).toContain("claim_expires_at");
    expect(MIGRATIONS[1].sql).toContain("state = 'pending'");
  });

  it("applies transactionally once and safely re-applies", async () => {
    const client = new MigrationClientFake();
    await expect(applyMigrationsWithClient(client)).resolves.toEqual([1, 2]);
    await expect(applyMigrationsWithClient(client)).resolves.toEqual([]);
    expect(client.calls.filter((call) => call === "COMMIT")).toHaveLength(2);
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
