import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { authorizeScheduledCleanup, runScheduledCleanup, SCHEDULED_CLEANUP_BATCH_SIZE, scheduledCleanupHttpStatus } from "./scheduled-cleanup";

const emptyGeneric = {
  expiredSessionIds: [], expiredShareIds: [], expiredObjectIds: [], pendingObjectReferences: [],
  removedIdempotencyCount: 0, removedQuotaCount: 0, failures: [],
} as const;

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("production scheduled cleanup entrypoint", () => {
  it("fails closed before work unless the exact CRON_SECRET bearer is present", () => {
    const secret = "s".repeat(32);
    expect(() => authorizeScheduledCleanup(new Request("https://hm.test/api/internal/cleanup"), { CRON_SECRET: secret })).toThrow("CRON_AUTHORITY_INVALID");
    expect(() => authorizeScheduledCleanup(new Request("https://hm.test/api/internal/cleanup", { headers: { authorization: `Bearer ${"x".repeat(32)}` } }), { CRON_SECRET: secret })).toThrow("CRON_AUTHORITY_INVALID");
    expect(() => authorizeScheduledCleanup(new Request("https://hm.test/api/internal/cleanup", { headers: { authorization: `Bearer ${secret}` } }), { CRON_SECRET: secret })).not.toThrow();
    expect(() => authorizeScheduledCleanup(new Request("https://hm.test/api/internal/cleanup", { headers: { authorization: `Bearer ${secret}` } }), {})).toThrow("CRON_AUTHORITY_INVALID");
  });

  it("invokes generic and provider-aware OMR cleanup in one bounded structured run", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const generic = { run: vi.fn(async ({ batchSize }: { batchSize: number }) => ({ ...emptyGeneric, expiredSessionIds: ["1"], pendingObjectReferences: [{ id: "2" }], failures: [{ scope: "object:2", message: "retry" }], batchSize })) };
    const omr = { cleanupExpiredJobs: vi.fn(async () => ({ attemptedJobs: 1, completedJobs: 1, failedJobs: 0 })) };
    const result = await runScheduledCleanup({ generic: generic as never, omr, now: () => new Date("2026-01-01T00:00:00.000Z") });
    expect(generic.run).toHaveBeenCalledWith({ now: new Date("2026-01-01T00:00:00.000Z"), batchSize: SCHEDULED_CLEANUP_BATCH_SIZE });
    expect(omr.cleanupExpiredJobs).toHaveBeenCalledWith(SCHEDULED_CLEANUP_BATCH_SIZE);
    expect(result).toMatchObject({ ok: false, batchSize: 25, generic: { status: "fulfilled", expiredSessions: 1, attemptedItems: 1, completedItems: 0, failedItems: 1 }, omr: { status: "fulfilled", attemptedJobs: 1, completedJobs: 1, failedJobs: 0 } });
    expect(scheduledCleanupHttpStatus(result)).toBe(207);
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('"event":"scheduled-cleanup"'));
  });

  it("returns before a never-resolving domain exceeds the enforced deadline", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const never = new Promise<never>(() => undefined);
    const run = runScheduledCleanup({
      generic: { run: () => never } as never,
      omr: { cleanupExpiredJobs: async () => ({ attemptedJobs: 0, completedJobs: 0, failedJobs: 0 }) },
      runtimeBudgetMs: 25,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    await vi.advanceTimersByTimeAsync(25);
    await expect(run).resolves.toMatchObject({ ok: false, runtimeBudgetMs: 25, generic: { status: "rejected", code: "CLEANUP_GENERIC_TIMEOUT" }, omr: { status: "fulfilled" } });
  });

  it("isolates domain failures and accepts concurrent bounded invocations", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const generic = { run: vi.fn(async () => { throw new RangeError("GENERIC_ITEM_FAILURE"); }) };
    const omr = { cleanupExpiredJobs: vi.fn(async () => ({ attemptedJobs: 0, completedJobs: 0, failedJobs: 0 })) };
    const results = await Promise.all([runScheduledCleanup({ generic: generic as never, omr }), runScheduledCleanup({ generic: generic as never, omr })]);
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.omr.status === "fulfilled" && result.generic.status === "rejected")).toBe(true);
    expect(generic.run).toHaveBeenCalledTimes(2);
    expect(omr.cleanupExpiredJobs).toHaveBeenCalledTimes(2);
  });

  it("surfaces isolated OMR item failures as a partial scheduler result", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await runScheduledCleanup({
      generic: { run: async () => emptyGeneric } as never,
      omr: { cleanupExpiredJobs: async () => ({ attemptedJobs: 3, completedJobs: 2, failedJobs: 1 }) },
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(result).toMatchObject({ ok: false, omr: { status: "fulfilled", attemptedJobs: 3, completedJobs: 2, failedJobs: 1 } });
    expect(scheduledCleanupHttpStatus(result)).toBe(207);
  });

  it("returns an exact successful 200-ready result when both domains complete without item failures", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await runScheduledCleanup({
      generic: { run: async () => emptyGeneric } as never,
      omr: { cleanupExpiredJobs: async () => ({ attemptedJobs: 2, completedJobs: 2, failedJobs: 0 }) },
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(result).toMatchObject({
      ok: true,
      generic: { status: "fulfilled", attemptedItems: 0, completedItems: 0, failedItems: 0 },
      omr: { status: "fulfilled", attemptedJobs: 2, completedJobs: 2, failedJobs: 0 },
    });
    expect(scheduledCleanupHttpStatus(result)).toBe(200);
  });

  it("rejects attempts to expand one invocation beyond the fixed limits", async () => {
    await expect(runScheduledCleanup({ generic: { run: async () => emptyGeneric } as never, omr: { cleanupExpiredJobs: async () => ({ attemptedJobs: 0, completedJobs: 0, failedJobs: 0 }) }, batchSize: 51 })).rejects.toThrow("CLEANUP_BATCH_INVALID");
    await expect(runScheduledCleanup({ generic: { run: async () => emptyGeneric } as never, omr: { cleanupExpiredJobs: async () => ({ attemptedJobs: 0, completedJobs: 0, failedJobs: 0 }) }, runtimeBudgetMs: 25_001 })).rejects.toThrow("CLEANUP_RUNTIME_BUDGET_INVALID");
  });
});
