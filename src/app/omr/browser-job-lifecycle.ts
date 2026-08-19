import type { OmrDeleteResult, OmrPublicStatus } from "../../domain/omr/contracts";

export const OMR_MONITOR_SESSION_BUDGET_MS = 60_000;
export const OMR_MONITOR_MAX_SYNC_ATTEMPTS = 80;
const OMR_UPLOAD_BINDING_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;

const MONITOR_TERMINAL = new Set<OmrPublicStatus["kind"]>([
  "completed", "failed", "cancelled", "needs-input", "cancel-failed", "reconciliation-required",
]);

export function isOmrMonitorTerminal(status: OmrPublicStatus): boolean {
  return MONITOR_TERMINAL.has(status.kind);
}

export function nextOmrMonitorTarget(status: OmrPublicStatus, nowEpochMs: number): number | undefined {
  if (!Number.isFinite(nowEpochMs)) throw new RangeError("OMR_BROWSER_MONITOR_TIME_INVALID");
  if (isOmrMonitorTerminal(status)) return undefined;
  if (status.kind !== "retry-pending") return nowEpochMs + 750;
  const retryAt = Date.parse(status.nextAttemptAt);
  if (!Number.isFinite(retryAt)) throw new RangeError("OMR_BROWSER_RETRY_TIME_INVALID");
  return Math.max(nowEpochMs, retryAt);
}

export function nextOmrUploadBindingRetryTarget(attempt: number, nowEpochMs: number): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1 || !Number.isFinite(nowEpochMs)) {
    throw new RangeError("OMR_BROWSER_UPLOAD_RETRY_INVALID");
  }
  const delay = OMR_UPLOAD_BINDING_RETRY_DELAYS_MS[Math.min(attempt, OMR_UPLOAD_BINDING_RETRY_DELAYS_MS.length) - 1];
  return nowEpochMs + delay;
}

export function canCancelOmrStatus(status: OmrPublicStatus): boolean {
  return !["completed", "failed", "cancelled", "cancel-pending", "reconciliation-required"].includes(status.kind);
}

export function shouldPauseOmrMonitorSession(input: {
  readonly nowEpochMs: number;
  readonly deadlineEpochMs: number;
  readonly completedSyncAttempts: number;
  readonly nextTargetEpochMs: number;
}): boolean {
  if (![input.nowEpochMs, input.deadlineEpochMs, input.nextTargetEpochMs].every(Number.isFinite)
    || !Number.isSafeInteger(input.completedSyncAttempts) || input.completedSyncAttempts < 0) {
    throw new RangeError("OMR_BROWSER_MONITOR_TIME_INVALID");
  }
  return input.nowEpochMs >= input.deadlineEpochMs
    || input.completedSyncAttempts >= OMR_MONITOR_MAX_SYNC_ATTEMPTS
    || input.nextTargetEpochMs > input.deadlineEpochMs;
}

export function omrDeletionDisposition(result?: OmrDeleteResult): "resolved-clear" | "pending-preserve" {
  return result?.localHandleDeleted === true && result.cleanupState === "resolved" && result.vendor.status === "deleted"
    ? "resolved-clear" : "pending-preserve";
}

export type OmrBrowserAuthorityAction =
  | "create-or-replay" | "unlock-correction" | "resume-upload" | "monitor"
  | "needs-input" | "quick-review" | "terminal-controls" | "delete-retry";

export function omrBrowserAuthorityAction(input: {
  readonly lifecycle: "create-pending" | "bound" | "completed" | "terminal" | "delete-pending";
  readonly statusKind?: OmrPublicStatus["kind"];
  readonly correctionLocked: boolean;
}): OmrBrowserAuthorityAction {
  if (input.correctionLocked) return "unlock-correction";
  if (input.lifecycle === "delete-pending") return "delete-retry";
  if (input.lifecycle === "create-pending") return "create-or-replay";
  if (input.statusKind === "created" || input.statusKind === "uploading") return "resume-upload";
  if (input.statusKind === "needs-input") return "needs-input";
  if (input.lifecycle === "completed" && input.statusKind === "completed") return "quick-review";
  if (input.lifecycle === "terminal" || input.statusKind === "failed" || input.statusKind === "cancelled"
    || input.statusKind === "cancel-failed" || input.statusKind === "reconciliation-required") return "terminal-controls";
  return "monitor";
}

export function omrInputReplacementDisposition(input: {
  readonly hasManifest: boolean;
  readonly hasHandle: boolean;
  readonly deletionResolved: boolean;
}): "allowed" | "delete-first" | "manifest-locked" {
  if (input.deletionResolved || !input.hasManifest) return "allowed";
  return input.hasHandle ? "delete-first" : "manifest-locked";
}
