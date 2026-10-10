import "server-only";

import { Pool } from "pg";

import type { ProductionSubstrateConfig } from "./config";

export interface SubstrateCompatibilitySnapshot {
  readonly runtime: "nodejs";
  readonly postgresDriver: "pg";
  readonly checks: {
    readonly postgresPoolConstructedWithoutConnection: true;
  };
}

/**
 * Performs a no-network runtime proof for the remaining persistence dependency set.
 * No database connection occurs.
 */
export async function inspectSubstrateCompatibility(
  config: ProductionSubstrateConfig,
): Promise<SubstrateCompatibilitySnapshot> {
  const pool = new Pool({ connectionString: config.database.connectionString, max: 1 });
  const postgresPoolConstructedWithoutConnection = typeof pool.connect === "function";
  await pool.end();

  if (!postgresPoolConstructedWithoutConnection) {
    throw new Error("SUBSTRATE_COMPATIBILITY_PROBE_FAILED");
  }

  return {
    runtime: "nodejs",
    postgresDriver: "pg",
    checks: {
      postgresPoolConstructedWithoutConnection: true,
    },
  };
}
