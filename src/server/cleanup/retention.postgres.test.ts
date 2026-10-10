import { afterAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { Pool } from "pg";
import { applyMigrations, applyMigrationsWithClient, MIGRATIONS, verifyMigrationsWithClient } from "../persistence/migrations";
import { PostgresGovernanceStore } from "../persistence/postgres-store";
import { CleanupService } from "./cleanup-service";
import { runScheduledCleanup } from "./scheduled-cleanup";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL_REQUIRED_FOR_POSTGRES_INTEGRATION");
const admin = new Pool({ connectionString: databaseUrl, max: 1 });
let sequence = 0;
afterAll(async () => { await admin.end(); });
async function fixture() {
  const schema = `hm_retention_${process.pid}_${Date.now()}_${++sequence}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: databaseUrl, max: 3, options: `-c search_path=${schema} -c timezone=UTC` });
  await applyMigrations(pool);
  const store = new PostgresGovernanceStore(pool);
  const session = await store.createSession({ tokenHash: "owner", csrfNonce: "nonce", createdAt: "2024-01-01T00:00:00.000Z", expiresAt: "2024-02-01T00:00:00.000Z" });
  return { pool, store, session, close: async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); } };
}
const now = new Date("2026-10-10T00:00:00.000Z");

describe("retention and old/new schema coexistence", () => {
  it("clears ciphertext even for old-code deletion SQL and permits old runtime verification", async () => {
    const f = await fixture();
    try {
      await f.pool.query(`INSERT INTO share_records(owner_session_id,token_hash,delete_secret_verifier,payload_digest,encrypted_payload,plaintext_size,rights_basis,lifecycle,created_at,expires_at)
        VALUES($1,'share','verifier','digest','{"ciphertext":"secret"}',1,'self-authored','active','2026-01-01','2027-01-01')`, [f.session.id]);
      // This is the pre-016 writer: it does not know about ciphertext erasure.
      await f.pool.query("UPDATE share_records SET lifecycle='deleted',deleted_at=$1 WHERE token_hash='share'", [now]);
      expect((await f.pool.query("SELECT encrypted_payload FROM share_records")).rows[0].encrypted_payload).toBeNull();
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      await expect(verifyMigrationsWithClient(f.pool, MIGRATIONS.slice(0, 15))).resolves.toBeUndefined();
      const client = await f.pool.connect();
      try { await expect(applyMigrationsWithClient(client, MIGRATIONS.slice(0, 15))).rejects.toThrow("MIGRATION_HISTORY_DIVERGED"); }
      finally { client.release(); }
      const row = await f.store.findShareByTokenHash("share");
      expect(row).toMatchObject({ lifecycle: "deleted", encryptedPayload: null });
    } finally { vi.restoreAllMocks(); await f.close(); }
  });
  it("honors cutoff boundaries, preserves active shares and referenced sessions, and supports dry run", async () => {
    const f = await fixture();
    try {
      for (const [token, lifecycle, expiry, disabled] of [
        ["old-expired", "expired", "2026-09-10", null], ["recent-expired", "expired", "2026-09-11", null],
        ["old-disabled", "disabled", "2027-01-01", "2026-09-10"], ["active", "active", "2027-01-01", null],
      ]) await f.pool.query(`INSERT INTO share_records(owner_session_id,token_hash,delete_secret_verifier,payload_digest,encrypted_payload,plaintext_size,rights_basis,lifecycle,created_at,expires_at,disabled_at)
        VALUES($1,$2,'verifier','digest','{}',1,'self-authored',$3,'2026-01-01',$4,$5)`, [f.session.id, token, lifecycle, expiry, disabled]);
      await f.pool.query("INSERT INTO abuse_reports(reporter_session_id,opaque_reference_hash,category,created_at,updated_at) VALUES($1,'old','test','2025-10-10','2025-10-10'),($1,'recent','test','2025-10-11','2025-10-11')", [f.session.id]);
      await f.pool.query("INSERT INTO audit_events(event_kind,outcome,created_at) VALUES('old','accepted','2025-10-10'),('recent','accepted','2025-10-11')");
      const dry = await f.store.cleanup({ now: now.toISOString(), batchSize: 50, dryRun: true });
      expect(dry).toMatchObject({ removedShareCount: 2, removedReportCount: 1, removedAuditCount: 1, removedSessionCount: 0 });
      expect(Number((await f.pool.query("SELECT count(*) FROM share_records")).rows[0].count)).toBe(4);
      const result = await f.store.cleanup({ now: now.toISOString(), batchSize: 50, dryRun: false });
      expect(result).toMatchObject({ removedShareCount: 2, removedReportCount: 1, removedAuditCount: 1, removedSessionCount: 0 });
      const active = await f.store.findShareByTokenHash("active");
      await f.store.transitionShare({ id: active!.id, lifecycle: "disabled", at: now.toISOString() });
      await f.store.transitionShare({ id: active!.id, lifecycle: "deleted", at: now.toISOString() });
      expect(await f.store.findShareByTokenHash("active")).toMatchObject({ lifecycle: "disabled", encryptedPayload: null });
      const orphan = await f.store.createSession({ tokenHash: "orphan", csrfNonce: "nonce", createdAt: "2024-01-01T00:00:00.000Z", expiresAt: "2024-02-01T00:00:00.000Z" });
      await f.store.cleanup({ now: now.toISOString(), batchSize: 50, dryRun: false });
      expect(await f.store.findSessionByTokenHash(orphan.tokenHash)).toBeUndefined();
      expect(await f.store.findSessionByTokenHash(f.session.tokenHash)).toBeDefined();
    } finally { await f.close(); }
  });
  it("drains 5000 quota and 5000 idempotency rows in one bounded invocation", async () => {
    const f = await fixture();
    try {
      await f.pool.query(`INSERT INTO quota_windows(owner_kind,owner_hash,policy_key,window_started_at,used_count,expires_at)
        SELECT 'ip-hmac',n::text,'test','2026-01-01',1,'2026-01-02' FROM generate_series(1,5000) n`);
      await f.pool.query(`INSERT INTO idempotency_records(session_id,operation,key_hash,request_digest,state,created_at,expires_at,claim_expires_at)
        SELECT $1,'test',n::text,'digest','pending','2026-01-01','2026-01-02','2026-01-02' FROM generate_series(1,5000) n`, [f.session.id]);
      const start = performance.now();
      const result = await runScheduledCleanup({ generic: new CleanupService(f.store), now: () => now });
      const elapsedMs = Math.round(performance.now() - start);
      console.info(JSON.stringify({ event: "retention-throughput-fixture", quotaRows: 5000, idempotencyRows: 5000, elapsedMs }));
      expect(result).toMatchObject({ ok: true, generic: { batches: 100, removedQuota: 5000, removedIdempotency: 5000 } });
      expect(elapsedMs).toBeLessThan(25_000);
      expect(Number((await f.pool.query("SELECT count(*) FROM quota_windows")).rows[0].count)).toBe(0);
      expect(Number((await f.pool.query("SELECT count(*) FROM idempotency_records")).rows[0].count)).toBe(0);
    } finally { await f.close(); }
  });
});
