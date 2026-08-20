import { Pool } from "pg";

import { applyMigrations, MIGRATIONS, verifyMigrations } from "../src/server/persistence/migrations.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for npm run migrate");

const pool = new Pool({ connectionString, max: 1 });
try {
  const installed = await applyMigrations(pool);
  await verifyMigrations(pool);
  process.stdout.write(`${JSON.stringify({ ok: true, installed, latestVersion: MIGRATIONS.at(-1)?.version ?? 0 })}\n`);
} finally {
  await pool.end();
}
