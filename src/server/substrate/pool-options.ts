import type { PoolConfig } from "pg";
/** Limits apply to each application instance; deploy with a pooled PostgreSQL URL. */
export const APPLICATION_POOL_OPTIONS = Object.freeze({
  max: 3,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 10_000,
  statement_timeout: 5_000,
  query_timeout: 6_000,
} satisfies PoolConfig);
