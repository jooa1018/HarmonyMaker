import "server-only";

import { timingSafeHashEquals } from "../security/crypto-core";
import type { CleanupService } from "./cleanup-service";

export const SCHEDULED_CLEANUP_BATCH_SIZE = 25;
export const SCHEDULED_CLEANUP_RUNTIME_BUDGET_MS = 25_000;

export interface ScheduledOmrCleanup {
  cleanupExpiredJobs(limit: number): Promise<{ readonly attemptedJobs: number; readonly completedJobs: number; readonly pendingJobs: number; readonly failedJobs: number }>;
}

export interface ScheduledCleanupResult {
  readonly ok: boolean;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly runtimeBudgetMs: number;
  readonly batchSize: number;
  readonly generic: { readonly status: "fulfilled"; readonly expiredSessions: number; readonly expiredShares: number; readonly expiredObjects: number; readonly attemptedItems: number; readonly completedItems: number; readonly failedItems: number }
    | { readonly status: "rejected"; readonly code: string };
  readonly omr: { readonly status: "fulfilled"; readonly attemptedJobs: number; readonly completedJobs: number; readonly pendingJobs: number; readonly failedJobs: number }
    | { readonly status: "rejected"; readonly code: string };
}

export function scheduledCleanupHttpStatus(result: Pick<ScheduledCleanupResult, "ok">): 200 | 207 {
  return result.ok ? 200 : 207;
}

export function authorizeScheduledCleanup(request: Request, environment: Readonly<Record<string, string | undefined>> = process.env): void {
  const configured = environment.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!configured || configured.length < 32 || !timingSafeHashEquals(configured, supplied)) throw new RangeError("CRON_AUTHORITY_INVALID");
}

function errorCode(reason: unknown): string {
  return reason instanceof Error && /^[A-Z][A-Z0-9_:-]{1,127}$/u.test(reason.message) ? reason.message : "CLEANUP_DOMAIN_FAILED";
}

export async function runScheduledCleanup(input: {
  readonly generic: Pick<CleanupService, "run">;
  readonly omr: ScheduledOmrCleanup;
  readonly now?: () => Date;
  readonly batchSize?: number;
  /** Tests may shorten the deadline; production callers use the frozen 25s budget. */
  readonly runtimeBudgetMs?: number;
}): Promise<ScheduledCleanupResult> {
  const batchSize = input.batchSize ?? SCHEDULED_CLEANUP_BATCH_SIZE;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 50) throw new RangeError("CLEANUP_BATCH_INVALID");
  const runtimeBudgetMs = input.runtimeBudgetMs ?? SCHEDULED_CLEANUP_RUNTIME_BUDGET_MS;
  if (!Number.isSafeInteger(runtimeBudgetMs) || runtimeBudgetMs < 1 || runtimeBudgetMs > SCHEDULED_CLEANUP_RUNTIME_BUDGET_MS) {
    throw new RangeError("CLEANUP_RUNTIME_BUDGET_INVALID");
  }
  const now = input.now ?? (() => new Date());
  const startedAt = now();

  const bounded = async <T>(domain: "GENERIC" | "OMR", operation: () => Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new RangeError(`CLEANUP_${domain}_TIMEOUT`)), runtimeBudgetMs);
    });
    try {
      return await Promise.race([Promise.resolve().then(operation), timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  const [generic, omr] = await Promise.allSettled([
    bounded("GENERIC", () => input.generic.run({ now: startedAt, batchSize })),
    bounded("OMR", () => input.omr.cleanupExpiredJobs(batchSize)),
  ]);
  const genericResult: ScheduledCleanupResult["generic"] = generic.status === "fulfilled"
    ? {
      status: "fulfilled",
      expiredSessions: generic.value.expiredSessionIds.length,
      expiredShares: generic.value.expiredShareIds.length,
      expiredObjects: generic.value.expiredObjectIds.length,
      attemptedItems: generic.value.pendingObjectReferences.length,
      completedItems: Math.max(0, generic.value.pendingObjectReferences.length - generic.value.failures.length),
      failedItems: generic.value.failures.length,
    }
    : { status: "rejected", code: errorCode(generic.reason) };
  const omrResult: ScheduledCleanupResult["omr"] = omr.status === "fulfilled"
    ? { status: "fulfilled", attemptedJobs: omr.value.attemptedJobs, completedJobs: omr.value.completedJobs, pendingJobs: omr.value.pendingJobs, failedJobs: omr.value.failedJobs }
    : { status: "rejected", code: errorCode(omr.reason) };
  const result: ScheduledCleanupResult = {
    ok: genericResult.status === "fulfilled" && genericResult.failedItems === 0
      && omrResult.status === "fulfilled" && omrResult.pendingJobs === 0 && omrResult.failedJobs === 0,
    startedAt: startedAt.toISOString(),
    completedAt: now().toISOString(),
    runtimeBudgetMs,
    batchSize,
    generic: genericResult,
    omr: omrResult,
  };
  console.info(JSON.stringify({ event: "scheduled-cleanup", ...result }));
  return result;
}
