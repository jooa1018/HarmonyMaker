import { describe, expect, it } from "vitest";

import {
  canCancelOmrStatus, nextOmrMonitorTarget, OMR_MONITOR_MAX_SYNC_ATTEMPTS,
  OMR_MONITOR_SESSION_BUDGET_MS, omrDeletionDisposition, omrInputReplacementDisposition,
  nextOmrUploadBindingRetryTarget, omrBrowserAuthorityAction, shouldPauseOmrMonitorSession,
} from "./browser-job-lifecycle";

describe("durable OMR browser retry lifecycle", () => {
  const now = Date.parse("2026-08-19T00:00:00.000Z");

  it.each([
    [60_000, "2026-08-19T00:01:00.000Z"],
    [5 * 60_000, "2026-08-19T00:05:00.000Z"],
    [30 * 60_000, "2026-08-19T00:30:00.000Z"],
  ])("preserves a %i ms server retry target without a fixed browser timeout", (delay, nextAttemptAt) => {
    const status = { kind: "retry-pending" as const, operation: "sync" as const, attempt: 1, nextAttemptAt, messageKo: "retry" };
    expect(nextOmrMonitorTarget(status, now)).toBe(now + delay);
    expect(nextOmrMonitorTarget(status, now + Math.floor(delay / 2))).toBe(now + delay);
    expect(canCancelOmrStatus(status)).toBe(true);
  });

  it("schedules durable upload-binding recovery at 60s, 5m, then a capped 30m", () => {
    expect([1, 2, 3, 4].map((attempt) => nextOmrUploadBindingRetryTarget(attempt, now) - now))
      .toEqual([60_000, 5 * 60_000, 30 * 60_000, 30 * 60_000]);
    expect(() => nextOmrUploadBindingRetryTarget(0, now)).toThrow("OMR_BROWSER_UPLOAD_RETRY_INVALID");
  });

  it("resumes the same durable target after reload and becomes due without rotating handle state", () => {
    const status = { kind: "retry-pending" as const, operation: "capture" as const, attempt: 4, nextAttemptAt: "2026-08-19T00:30:00.000Z", messageKo: "retry" };
    const persisted = structuredClone(status);
    expect(nextOmrMonitorTarget(persisted, now + 29 * 60_000)).toBe(now + 30 * 60_000);
    expect(nextOmrMonitorTarget(persisted, now + 31 * 60_000)).toBe(now + 31 * 60_000);
  });

  it("keeps replacement locked until the live handle is deleted, while cancel remains available", () => {
    expect(omrInputReplacementDisposition({ hasManifest: true, hasHandle: true, deletionResolved: false })).toBe("delete-first");
    expect(omrInputReplacementDisposition({ hasManifest: true, hasHandle: false, deletionResolved: false })).toBe("manifest-locked");
    expect(omrInputReplacementDisposition({ hasManifest: true, hasHandle: false, deletionResolved: true })).toBe("allowed");
    expect(canCancelOmrStatus({ kind: "processing" })).toBe(true);
    expect(canCancelOmrStatus({ kind: "cancel-pending", messageKo: "pending" })).toBe(false);
    expect(canCancelOmrStatus({ kind: "cancelled" })).toBe(false);
  });

  it("ends only the active polling session at its time/attempt budget and preserves the handle authority", () => {
    const authority = { handle: "opaque-handle", manifestDigest: "a".repeat(64) };
    const deadline = now + OMR_MONITOR_SESSION_BUDGET_MS;
    expect(shouldPauseOmrMonitorSession({
      nowEpochMs: now, deadlineEpochMs: deadline,
      completedSyncAttempts: OMR_MONITOR_MAX_SYNC_ATTEMPTS - 1, nextTargetEpochMs: now + 750,
    })).toBe(false);
    expect(shouldPauseOmrMonitorSession({
      nowEpochMs: now, deadlineEpochMs: deadline,
      completedSyncAttempts: OMR_MONITOR_MAX_SYNC_ATTEMPTS, nextTargetEpochMs: now + 750,
    })).toBe(true);
    expect(shouldPauseOmrMonitorSession({
      nowEpochMs: now, deadlineEpochMs: deadline,
      completedSyncAttempts: 1, nextTargetEpochMs: now + 5 * 60_000,
    })).toBe(true);
    expect(authority).toEqual({ handle: "opaque-handle", manifestDigest: "a".repeat(64) });
  });

  it("clears only fully resolved local+vendor deletion and preserves every pending outcome", () => {
    expect(omrDeletionDisposition()).toBe("pending-preserve");
    expect(omrDeletionDisposition({ localHandleDeleted: true, vendor: { status: "deleted" }, cleanupState: "resolved" })).toBe("resolved-clear");
    expect(omrDeletionDisposition({ localHandleDeleted: true, vendor: { status: "failed", code: "PENDING", message: "pending" }, cleanupState: "pending", nextAttemptAt: "2026-08-19T00:05:00.000Z" })).toBe("pending-preserve");
    expect(omrDeletionDisposition({ localHandleDeleted: true, vendor: { status: "not-supported", retentionInfo: { canDeleteImmediately: false, vendorDeletesAt: "2026-08-19T00:30:00.000Z" } }, cleanupState: "pending", nextAttemptAt: "2026-08-19T00:30:00.000Z" })).toBe("pending-preserve");
    expect(omrDeletionDisposition({ localHandleDeleted: false, vendor: { status: "deleted" }, cleanupState: "resolved" })).toBe("pending-preserve");
  });

  it.each([
    ["create-pending", undefined, false, "create-or-replay"],
    ["create-pending", undefined, true, "unlock-correction"],
    ["bound", "created", false, "resume-upload"],
    ["bound", "uploading", false, "resume-upload"],
    ["bound", "queued", false, "monitor"],
    ["bound", "processing", false, "monitor"],
    ["bound", "needs-input", false, "needs-input"],
    ["bound", "retry-pending", false, "monitor"],
    ["completed", "completed", false, "quick-review"],
    ["terminal", "reconciliation-required", false, "terminal-controls"],
    ["delete-pending", "completed", false, "delete-retry"],
  ] as const)("maps durable %s/%s/correction=%s to %s without silent fallback", (lifecycle, statusKind, correctionLocked, expected) => {
    expect(omrBrowserAuthorityAction({ lifecycle, statusKind, correctionLocked })).toBe(expected);
  });
});
