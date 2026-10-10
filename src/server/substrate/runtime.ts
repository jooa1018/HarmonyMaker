import "server-only";

import { S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";

import type { ProductionSubstrateConfig } from "./config";

export interface SubstrateCompatibilitySnapshot {
  readonly runtime: "nodejs";
  readonly postgresDriver: "pg";
  readonly objectStoreClient: "@aws-sdk/client-s3";
  readonly checks: {
    readonly postgresPoolConstructedWithoutConnection: true;
    readonly s3ClientConstructedWithoutRequest: true;
  };
}

/**
 * Performs a no-network runtime proof for the remaining persistence dependency set.
 * No database connection or S3 request occurs.
 */
export async function inspectSubstrateCompatibility(
  config: ProductionSubstrateConfig,
): Promise<SubstrateCompatibilitySnapshot> {
  const pool = new Pool({ connectionString: config.database.connectionString, max: 1 });
  const postgresPoolConstructedWithoutConnection = typeof pool.connect === "function";
  await pool.end();

  const s3 = new S3Client({
    endpoint: config.objectStore.endpoint,
    region: config.objectStore.region,
    credentials: {
      accessKeyId: config.objectStore.accessKeyId,
      secretAccessKey: config.objectStore.secretAccessKey,
    },
  });
  const s3ClientConstructedWithoutRequest = typeof s3.send === "function";
  s3.destroy();

  if (
    !postgresPoolConstructedWithoutConnection
    || !s3ClientConstructedWithoutRequest
  ) {
    throw new Error("SUBSTRATE_COMPATIBILITY_PROBE_FAILED");
  }

  return {
    runtime: "nodejs",
    postgresDriver: "pg",
    objectStoreClient: "@aws-sdk/client-s3",
    checks: {
      postgresPoolConstructedWithoutConnection: true,
      s3ClientConstructedWithoutRequest: true,
    },
  };
}
