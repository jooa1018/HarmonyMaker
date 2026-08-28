import { describe, expect, it } from "vitest";

import type { OmrPublicStatus } from "../../domain/omr/contracts";
import {
  abortOmrBrowserAuthorityRequests,
  runOmrBrowserMonitorSession,
  runOmrBrowserRecoverySession,
  scheduleOmrMonitorRetryResume,
  shouldStartOmrMonitorNow,
  type OmrBrowserMonitorGeneration,
} from "./browser-job-lifecycle";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("production OMR monitor generation fencing", () => {
  it("drops a deferred H1 sync after delete/clear and H2 supersession without any stale mutation", async () => {
    const h1 = { jobHandle: "H1", manifestDigest: "a".repeat(64), lifecycle: "bound" } satisfies OmrBrowserMonitorGeneration;
    const h2 = { jobHandle: "H2", manifestDigest: "b".repeat(64), lifecycle: "bound" } satisfies OmrBrowserMonitorGeneration;
    let current: OmrBrowserMonitorGeneration | undefined = h1;
    const sync = deferred<OmrPublicStatus>();
    const controller = new AbortController();
    const mutations = { status: 0, result: 0, manifest: 0 };

    const running = runOmrBrowserMonitorSession({
      authority: h1,
      currentAuthority: () => current,
      signal: controller.signal,
      sync: async () => sync.promise,
      applyStatus: async (status) => {
        mutations.status += 1;
        if (status.kind === "completed") {
          mutations.result += 1;
          mutations.manifest += 1;
        }
      },
      waitUntil: async () => undefined,
    });

    controller.abort();
    current = undefined; // exact H1 manifest deletion/clear
    current = h2; // a new immutable manifest generation becomes authoritative
    sync.resolve({ kind: "completed" });

    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    expect(mutations).toEqual({ status: 0, result: 0, manifest: 0 });
    expect(current).toBe(h2);
  });

  it("does zero pre-due reload syncs and resumes the exact handle once at the durable due target", async () => {
    const now = Date.parse("2026-08-19T00:00:00.000Z");
    const retry = {
      kind: "retry-pending",
      operation: "sync",
      attempt: 2,
      nextAttemptAt: "2026-08-19T00:01:00.000Z",
      messageKo: "retry",
    } satisfies OmrPublicStatus;
    const authority = { jobHandle: "H-reload", manifestDigest: "c".repeat(64), lifecycle: "bound" } satisfies OmrBrowserMonitorGeneration;
    let syncCount = 0;
    expect(shouldStartOmrMonitorNow(retry, now)).toBe(false);
    expect(syncCount).toBe(0);

    let dueCallback: (() => void) | undefined;
    let resumed: Promise<void> | undefined;
    const cancel = scheduleOmrMonitorRetryResume({
      status: retry,
      nowEpochMs: now,
      setTimer: (callback, delayMs) => {
        expect(delayMs).toBe(60_000);
        dueCallback = callback;
        return 41;
      },
      clearTimer: () => undefined,
      resume: () => {
        resumed = runOmrBrowserMonitorSession({
          authority,
          currentAuthority: () => authority,
          signal: new AbortController().signal,
          sync: async () => {
            syncCount += 1;
            expect(authority.jobHandle).toBe("H-reload");
            return { kind: "completed" };
          },
          applyStatus: async () => undefined,
          waitUntil: async () => undefined,
          nowEpochMs: () => now + 60_000,
        });
      },
    });

    dueCallback?.();
    await resumed;
    expect(syncCount).toBe(1);
    cancel();
  });

  it.each(["terminal", "delete-pending"] as const)(
    "drops a deferred same-H1 recovery after the manifest becomes %s",
    async (nextLifecycle) => {
      const bound = {
        jobHandle: "H-same",
        manifestDigest: "d".repeat(64),
        lifecycle: "bound",
      } satisfies OmrBrowserMonitorGeneration;
      let current: OmrBrowserMonitorGeneration | undefined = bound;
      const recovered = deferred<OmrPublicStatus>();
      const controller = new AbortController();
      const mutations = { status: 0, result: 0, manifest: 0, upload: 0 };
      const running = runOmrBrowserRecoverySession({
        authority: bound,
        currentAuthority: () => current,
        signal: controller.signal,
        recover: async () => recovered.promise,
        applyStatus: async () => {
          mutations.status += 1;
          mutations.result += 1;
          mutations.manifest += 1;
        },
        continueAfterStatus: async () => { mutations.upload += 1; },
      });

      current = { ...bound, lifecycle: nextLifecycle };
      recovered.resolve({ kind: "uploading", uploadedPages: 0, totalPages: 2 });

      await expect(running).rejects.toMatchObject({ name: "AbortError" });
      expect(mutations).toEqual({ status: 0, result: 0, manifest: 0, upload: 0 });
    },
  );

  it("aborts both monitor and recovery ownership on authority exit", () => {
    const monitor = new AbortController();
    const recovery = new AbortController();
    abortOmrBrowserAuthorityRequests({ monitor, recovery });
    expect({ monitor: monitor.signal.aborted, recovery: recovery.signal.aborted })
      .toEqual({ monitor: true, recovery: true });
  });

  it.each(["completed", "failed", "cancelled"] as const)(
    "applies a successful %s terminal monitor status exactly once",
    async (kind) => {
      const authority = {
        jobHandle: "H-terminal",
        manifestDigest: "e".repeat(64),
        lifecycle: "bound",
      } satisfies OmrBrowserMonitorGeneration;
      let current: OmrBrowserMonitorGeneration | undefined = authority;
      let applied = 0;
      await expect(runOmrBrowserMonitorSession({
        authority,
        currentAuthority: () => current,
        signal: new AbortController().signal,
        sync: async () => kind === "completed"
          ? { kind }
          : kind === "cancelled"
            ? { kind }
            : { kind, code: "OMR_FAILED", messageKo: "failed" },
        applyStatus: async () => {
          applied += 1;
          current = { ...authority, lifecycle: kind === "completed" ? "completed" : "terminal" };
        },
        waitUntil: async () => undefined,
      })).resolves.toBeUndefined();
      expect(applied).toBe(1);
    },
  );
});
