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
    const request = (value?: string) => new Request("https://hm.test/api/internal/cleanup", { headers: value ? { authorization: value } : {} });
    expect(() => authorizeScheduledCleanup(request(), { CRON_SECRET: secret })).toThrow("CRON_AUTHORITY_INVALID");
    expect(() => authorizeScheduledCleanup(request("Bearer " + "x".repeat(32)), { CRON_SECRET: secret })).toThrow("CRON_AUTHORITY_INVALID");
    expect(() => authorizeScheduledCleanup(request("Bearer " + secret), { CRON_SECRET: secret })).not.toThrow();
    expect(() => authorizeScheduledCleanup(request("Bearer " + secret), {})).toThrow("CRON_AUTHORITY_INVALID");
  });

  it("runs generic cleanup and returns 207 for individual object deletion failures", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const generic = { run: vi.fn(async () => ({ ...emptyGeneric, expiredSessionIds: ["1"], pendingObjectReferences: [{ id: "2" }], failures: [{ scope: "object:2", message: "retry" }] })) };
    const result = await runScheduledCleanup({ generic: generic as never, now: () => new Date("2026-01-01T00:00:00.000Z") });
    expect(generic.run).toHaveBeenCalledWith({ now: new Date("2026-01-01T00:00:00.000Z"), batchSize: SCHEDULED_CLEANUP_BATCH_SIZE });
    expect(result).toMatchObject({ ok: false, batchSize: 25, generic: { status: "fulfilled", expiredSessions: 1, attemptedItems: 1, completedItems: 0, failedItems: 1 } });
    expect(result).not.toHaveProperty("omr");
    expect(scheduledCleanupHttpStatus(result)).toBe(207);
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('"event":"scheduled-cleanup"'));
  });

  it("returns before a never-resolving cleanup exceeds the enforced deadline", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const run = runScheduledCleanup({ generic: { run: () => new Promise<never>(() => undefined) }, runtimeBudgetMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    await expect(run).resolves.toMatchObject({ ok: false, runtimeBudgetMs: 25, generic: { status: "rejected", code: "CLEANUP_GENERIC_TIMEOUT" } });
  });

  it("reports failures and accepts concurrent bounded invocations", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const generic = { run: vi.fn(async () => { throw new RangeError("GENERIC_ITEM_FAILURE"); }) };
    const results = await Promise.all([runScheduledCleanup({ generic }), runScheduledCleanup({ generic })]);
    expect(results).toHaveLength(2);
    expect(results.every(result => !result.ok && result.generic.status === "rejected" && result.generic.code === "CLEANUP_DOMAIN_FAILED")).toBe(true);
    expect(generic.run).toHaveBeenCalledTimes(2);
  });

  it("does not expose unexpected exception text in scheduler responses", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await runScheduledCleanup({ generic: { run: async () => { throw new Error("private detail"); } } });
    expect(result.generic).toEqual({ status: "rejected", code: "CLEANUP_DOMAIN_FAILED" });
  });

  it("returns a successful 200-ready result without an OMR service", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await runScheduledCleanup({ generic: { run: async () => emptyGeneric } as never });
    expect(result).toMatchObject({ ok: true, generic: { status: "fulfilled", attemptedItems: 0, completedItems: 0, failedItems: 0 } });
    expect(result).not.toHaveProperty("omr");
    expect(scheduledCleanupHttpStatus(result)).toBe(200);
  });

  it("rejects attempts to expand one invocation beyond the fixed limits", async () => {
    const generic = { run: async () => emptyGeneric } as never;
    await expect(runScheduledCleanup({ generic, batchSize: 51 })).rejects.toThrow("CLEANUP_BATCH_INVALID");
    await expect(runScheduledCleanup({ generic, runtimeBudgetMs: 25_001 })).rejects.toThrow("CLEANUP_RUNTIME_BUDGET_INVALID");
  });
});
