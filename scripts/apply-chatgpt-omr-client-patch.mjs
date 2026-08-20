import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, before, after) {
  const current = readFileSync(path, "utf8");
  if (!current.includes(before)) throw new Error(`PATCH_CONTEXT_MISSING:${path}`);
  writeFileSync(path, current.replace(before, after));
}

replaceOnce(
  "src/server/omr/cross-session-create-recovery.ts",
  `       SELECT $2,'omr-session-alias-v1',$1,j.owner_session_id::text,'complete',
         jsonb_build_object('ownerSessionId',j.owner_session_id::text),$3,$3,j.expires_at
       FROM omr_jobs j WHERE j.id=$1`,
  `       SELECT $2,'omr-session-alias-v1',$1::text,j.owner_session_id::text,'complete',
         jsonb_build_object('ownerSessionId',j.owner_session_id::text),$3,$3,j.expires_at
       FROM omr_jobs j WHERE j.id=$1::bigint`,
);

replaceOnce(
  "src/server/omr/postgres-store.postgres.test.ts",
  `import { applyMigrationsWithClient, MIGRATIONS, OMR_PROVIDER_DELETE_AUTHORITY_SQL } from "../persistence/migrations";`,
  `import { applyMigrationsWithClient, MIGRATIONS, OMR_CLEANUP_FAIRNESS_SQL, OMR_PROVIDER_DELETE_AUTHORITY_SQL } from "../persistence/migrations";`,
);
replaceOnce(
  "src/server/omr/postgres-store.postgres.test.ts",
  `    await migrationPool.query(OMR_PROVIDER_DELETE_AUTHORITY_SQL);`,
  `    await migrationPool.query(OMR_PROVIDER_DELETE_AUTHORITY_SQL);
    await migrationPool.query(OMR_CLEANUP_FAIRNESS_SQL);`,
);
