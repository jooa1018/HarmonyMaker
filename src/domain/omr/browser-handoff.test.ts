import { describe, expect, it } from "vitest";

import { evaluateOmrHandoffRecovery, OMR_HANDOFF_MAX_RECOVERY_ATTEMPTS, OMR_HANDOFF_TTL_MS } from "./browser-handoff";

describe("IndexedDB OMR handoff recovery policy", () => {
  it("keeps a bounded handoff recoverable until TTL or the third failed recovery", () => {
    const created = Date.parse("2026-01-01T00:00:00.000Z");
    const expiresAt = new Date(created + OMR_HANDOFF_TTL_MS).toISOString();
    expect(evaluateOmrHandoffRecovery(expiresAt, 0, "2026-01-01T00:00:01.000Z")).toBe("available");
    expect(evaluateOmrHandoffRecovery(expiresAt, OMR_HANDOFF_MAX_RECOVERY_ATTEMPTS - 1, "2026-01-01T00:29:59.999Z")).toBe("available");
    expect(evaluateOmrHandoffRecovery(expiresAt, OMR_HANDOFF_MAX_RECOVERY_ATTEMPTS, "2026-01-01T00:29:59.999Z")).toBe("attempts-exhausted");
    expect(evaluateOmrHandoffRecovery(expiresAt, 0, expiresAt)).toBe("expired");
    expect(() => evaluateOmrHandoffRecovery("invalid", 0, expiresAt)).toThrow("OMR_HANDOFF_RECORD_INVALID");
  });
});
