import "server-only";

import { createApiRequest, logUnexpectedApiError, type ApiRequestContext } from "../http/request-context";
import { timingSafeHashEquals } from "../security/crypto-core";
import { CLEANUP_MAX_BATCHES } from "./retention";
import type { CleanupRunResult } from "./cleanup-service";
import type { CleanupService } from "./cleanup-service";

export const SCHEDULED_CLEANUP_BATCH_SIZE = 50;
export const SCHEDULED_CLEANUP_RUNTIME_BUDGET_MS = 25_000;

export interface ScheduledCleanupResult {
  readonly ok: boolean;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly runtimeBudgetMs: number;
  readonly batchSize: number;
  readonly generic: { readonly status: "fulfilled"; readonly batches: number; readonly removedQuota: number; readonly removedIdempotency: number; readonly removedShares: number; readonly removedSessions: number; readonly removedReports: number; readonly removedAudits: number; readonly expiredSessions: number; readonly expiredShares: number; readonly expiredObjects: number; readonly attemptedItems: number; readonly completedItems: number; readonly failedItems: number; readonly skippedItems: number }
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
  return reason instanceof Error && reason.message === "CLEANUP_GENERIC_TIMEOUT" ? reason.message : "CLEANUP_DOMAIN_FAILED";
}

export async function runScheduledCleanup(input: {
  readonly generic: Pick<CleanupService, "run">;
  readonly requestContext?: ApiRequestContext;
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
  const deadline = performance.now() + runtimeBudgetMs;
  const deadlineAt = Date.now() + runtimeBudgetMs;
  let stopped = false;
  let batches = 0;
  const runBatches = async (): Promise<CleanupRunResult> => {
    const totals = { expiredSessionIds: new Set<CleanupRunResult["expiredSessionIds"][number]>(), expiredShareIds: new Set<CleanupRunResult["expiredSessionIds"][number]>(), expiredObjectIds: new Set<CleanupRunResult["expiredSessionIds"][number]>() };
    const objects = new Map<string, CleanupRunResult["pendingObjectReferences"][number]>();
    let removedQuotaCount = 0, removedIdempotencyCount = 0, removedShareCount = 0, removedSessionCount = 0, removedReportCount = 0, removedAuditCount = 0;
    let skippedObjects = 0;
    const failures: { scope: string; message: string }[] = [];
    while (!stopped && performance.now() < deadline && batches < CLEANUP_MAX_BATCHES) {
      const value = await input.generic.run({ now: startedAt, batchSize, deadlineAt, ...(input.requestContext ? { requestContext: input.requestContext } : {}) });
      batches++;
      for (const key of ["expiredSessionIds", "expiredShareIds", "expiredObjectIds"] as const) for (const id of value[key]) totals[key].add(id);
      for (const obj of value.pendingObjectReferences) objects.set(obj.id, obj);
      removedQuotaCount += value.removedQuotaCount;
      removedIdempotencyCount += value.removedIdempotencyCount;
      removedShareCount += value.removedShareCount ?? 0;
      removedSessionCount += value.removedSessionCount ?? 0;
      removedReportCount += value.removedReportCount ?? 0;
      removedAuditCount += value.removedAuditCount ?? 0;
      skippedObjects = Math.max(skippedObjects, value.skippedObjects ?? 0);
      failures.push(...value.failures);
      const backlog = [value.expiredSessionIds.length, value.expiredShareIds.length, value.removedQuotaCount, value.removedIdempotencyCount,
        value.removedShareCount ?? 0, value.removedSessionCount ?? 0, value.removedReportCount ?? 0, value.removedAuditCount ?? 0].some(count => count >= batchSize);
      if (!backlog || failures.length) break;
    }
    return { expiredSessionIds: [...totals.expiredSessionIds] as CleanupRunResult["expiredSessionIds"],
      expiredShareIds: [...totals.expiredShareIds] as CleanupRunResult["expiredShareIds"], expiredObjectIds: [...totals.expiredObjectIds] as CleanupRunResult["expiredObjectIds"],
      pendingObjectReferences: [...objects.values()], removedQuotaCount, removedIdempotencyCount, removedShareCount, removedSessionCount, removedReportCount, removedAuditCount,
      skippedObjects, failures };
  };

  const bounded = async <T>(domain: "GENERIC", operation: () => Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { stopped = true; reject(new RangeError(`CLEANUP_${domain}_TIMEOUT`)); }, runtimeBudgetMs);
    });
    try {
      return await Promise.race([Promise.resolve().then(operation), timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  const [generic] = await Promise.allSettled([
    bounded("GENERIC", runBatches),
  ]);
  if (generic.status === "rejected") logUnexpectedApiError(generic.reason, input.requestContext ?? createApiRequest("/api/internal/cleanup"));
  const genericResult: ScheduledCleanupResult["generic"] = generic.status === "fulfilled"
    ? {
      status: "fulfilled", batches,
      removedQuota: generic.value.removedQuotaCount, removedIdempotency: generic.value.removedIdempotencyCount,
      removedShares: generic.value.removedShareCount ?? 0, removedSessions: generic.value.removedSessionCount ?? 0,
      removedReports: generic.value.removedReportCount ?? 0, removedAudits: generic.value.removedAuditCount ?? 0,
      expiredSessions: generic.value.expiredSessionIds.length,
      expiredShares: generic.value.expiredShareIds.length,
      expiredObjects: generic.value.expiredObjectIds.length,
      attemptedItems: generic.value.pendingObjectReferences.length - (generic.value.skippedObjects ?? 0),
      completedItems: Math.max(0, generic.value.pendingObjectReferences.length - (generic.value.skippedObjects ?? 0) - generic.value.failures.length),
      failedItems: generic.value.failures.length,
      skippedItems: generic.value.skippedObjects ?? 0,
    }
    : { status: "rejected", code: errorCode(generic.reason) };
  const result: ScheduledCleanupResult = {
    ok: genericResult.status === "fulfilled" && genericResult.failedItems === 0,
    startedAt: startedAt.toISOString(),
    completedAt: now().toISOString(),
    runtimeBudgetMs,
    batchSize,
    generic: genericResult,
  };
  console.info(JSON.stringify({ event: "scheduled-cleanup", ...result }));
  return result;
}
