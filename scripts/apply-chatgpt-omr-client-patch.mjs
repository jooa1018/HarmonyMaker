import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, before, after) {
  const current = readFileSync(path, "utf8");
  if (!current.includes(before)) throw new Error(`PATCH_CONTEXT_MISSING:${path}`);
  writeFileSync(path, current.replace(before, after));
}

replaceOnce(
  "src/server/omr/cross-session-create-recovery.test.ts",
  'import type { OmrVendorStatus } from "../../domain/omr/contracts";',
  'import type { VendorOmrStatus } from "../../domain/omr/contracts";',
);
replaceOnce(
  "src/server/omr/cross-session-create-recovery.test.ts",
  'statusScript: [{ kind: "created" } as OmrVendorStatus],',
  'statusScript: [{ kind: "created" } as VendorOmrStatus],',
);

replaceOnce(
  "src/server/omr/store.ts",
  '  readonly cleanupLeaseExpiresAt?: string;\n  readonly reconciliationKind?:',
  '  readonly cleanupLeaseExpiresAt?: string;\n  /** Durable fairness authority: most recent scheduler claim attempt. */\n  readonly cleanupLastAttemptAt?: string;\n  readonly reconciliationKind?:',
);
replaceOnce(
  "src/server/omr/store.ts",
  `      )).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit);
      return selected.map((job) => {
        const base = job.state === "delete-pending"
          ? job
          : { ...job, state: "expired" as const, handleActive: false, updatedAt: now };
        const creditState = creditStateAfterHandleDeactivation(base);
        const updated = { ...base, creditState, cleanupLeaseToken: input.leaseToken, cleanupLeaseExpiresAt: input.leaseExpiresAt };`,
  `      )).sort((a, b) => {
        const leftAttempt = a.cleanupLastAttemptAt;
        const rightAttempt = b.cleanupLastAttemptAt;
        if (leftAttempt === undefined && rightAttempt !== undefined) return -1;
        if (leftAttempt !== undefined && rightAttempt === undefined) return 1;
        if (leftAttempt !== rightAttempt) return (leftAttempt ?? "").localeCompare(rightAttempt ?? "");
        const expiry = a.handleExpiresAt.localeCompare(b.handleExpiresAt);
        return expiry !== 0 ? expiry : a.id.localeCompare(b.id);
      }).slice(0, limit);
      return selected.map((job) => {
        const base = job.state === "delete-pending"
          ? job
          : { ...job, state: "expired" as const, handleActive: false, updatedAt: now };
        const creditState = creditStateAfterHandleDeactivation(base);
        const updated = {
          ...base,
          creditState,
          cleanupLeaseToken: input.leaseToken,
          cleanupLeaseExpiresAt: input.leaseExpiresAt,
          cleanupLastAttemptAt: now,
        };`,
);

replaceOnce(
  "src/server/omr/postgres-store.ts",
  '    ...(row.cleanup_lease_expires_at ? { cleanupLeaseExpiresAt: iso(row.cleanup_lease_expires_at) } : {}),\n    ...(row.reconciliation_kind ?',
  '    ...(row.cleanup_lease_expires_at ? { cleanupLeaseExpiresAt: iso(row.cleanup_lease_expires_at) } : {}),\n    ...(row.cleanup_last_attempt_at ? { cleanupLastAttemptAt: iso(row.cleanup_last_attempt_at) } : {}),\n    ...(row.reconciliation_kind ?',
);
replaceOnce(
  "src/server/omr/postgres-store.ts",
  '  { key: "cleanupLeaseExpiresAt", column: "cleanup_lease_expires_at" },\n  { key: "reconciliationKind",',
  '  { key: "cleanupLeaseExpiresAt", column: "cleanup_lease_expires_at" },\n  { key: "cleanupLastAttemptAt", column: "cleanup_last_attempt_at" },\n  { key: "reconciliationKind",',
);
replaceOnce(
  "src/server/omr/postgres-store.ts",
  ') ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT $2`',
  ') ORDER BY cleanup_last_attempt_at NULLS FIRST,expires_at,id FOR UPDATE SKIP LOCKED LIMIT $2`',
);
replaceOnce(
  "src/server/omr/postgres-store.ts",
  'cleanup_lease_token=$3,cleanup_lease_expires_at=$4,updated_at=$2 WHERE id=$1',
  'cleanup_lease_token=$3,cleanup_lease_expires_at=$4,cleanup_last_attempt_at=$2,updated_at=$2 WHERE id=$1',
);

const migrationSql = `ALTER TABLE omr_jobs
  ADD COLUMN IF NOT EXISTS cleanup_last_attempt_at timestamptz;

CREATE INDEX IF NOT EXISTS omr_jobs_cleanup_fairness_idx
  ON omr_jobs (cleanup_last_attempt_at NULLS FIRST, expires_at, id)
  WHERE state <> 'deleted';
`;
writeFileSync("src/server/persistence/migrations/015_omr_cleanup_fairness.sql", migrationSql);
replaceOnce(
  "src/server/persistence/migrations.ts",
  'export const MIGRATIONS: readonly Migration[] = Object.freeze([',
  `export const OMR_CLEANUP_FAIRNESS_SQL = String.raw\`
${migrationSql}\`;

export const MIGRATIONS: readonly Migration[] = Object.freeze([`,
);
replaceOnce(
  "src/server/persistence/migrations.ts",
  '  { version: 14, name: "share_create_cross_session_recovery", sql: SHARE_CREATE_CROSS_SESSION_RECOVERY_SQL },\n]);',
  '  { version: 14, name: "share_create_cross_session_recovery", sql: SHARE_CREATE_CROSS_SESSION_RECOVERY_SQL },\n  { version: 15, name: "omr_cleanup_fairness", sql: OMR_CLEANUP_FAIRNESS_SQL },\n]);',
);

replaceOnce(
  "src/server/persistence/migrations.test.ts",
  'expect(MIGRATIONS.map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);',
  'expect(MIGRATIONS.map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);',
);
replaceOnce(
  "src/server/persistence/migrations.test.ts",
  '    for (const required of ["idempotency_share_create_recovery_idx", "operation", "key_hash", "expires_at", "share-create-v1"]) expect(MIGRATIONS[13].sql).toContain(required);',
  '    for (const required of ["idempotency_share_create_recovery_idx", "operation", "key_hash", "expires_at", "share-create-v1"]) expect(MIGRATIONS[13].sql).toContain(required);\n    for (const required of ["cleanup_last_attempt_at", "omr_jobs_cleanup_fairness_idx", "NULLS FIRST", "expires_at"]) expect(MIGRATIONS[14].sql).toContain(required);',
);
replaceOnce(
  "src/server/persistence/migrations.test.ts",
  'await expect(applyMigrationsWithClient(client)).resolves.toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);',
  'await expect(applyMigrationsWithClient(client)).resolves.toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);',
);
replaceOnce(
  "src/server/persistence/migrations.test.ts",
  '      [14, "bcb47b6c00099e24c215e829259def5e981f0e6757cc36e431f5f1b8f79f3140"],\n    ]);',
  '      [14, "bcb47b6c00099e24c215e829259def5e981f0e6757cc36e431f5f1b8f79f3140"],\n      [15, "1097517a33a1ca967e850aea6f4b42a9ce870ca719e20152e3a5f87474f2371c"],\n    ]);',
);