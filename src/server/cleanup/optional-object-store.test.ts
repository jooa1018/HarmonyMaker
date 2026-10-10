import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { MemoryGovernanceStore } from "../persistence/memory-store.test-adapter";
import { MemoryOwnedObjectStore } from "../storage/memory-owned-object-store.test-adapter";
import { CleanupService } from "./cleanup-service";
import { runScheduledCleanup } from "./scheduled-cleanup";

describe("cleanup without an object store", () => {
  it("keeps pending object references recoverable and does not claim a physical deletion", async () => {
    const store = new MemoryGovernanceStore();
    const session = await store.createSession({ tokenHash: "expired", csrfNonce: "nonce", createdAt: "2025-01-01T00:00:00.000Z", expiresAt: "2025-02-01T00:00:00.000Z" });
    const objects = new MemoryOwnedObjectStore(store);
    const object = await objects.put({ ownerSessionId: session.id, publicationId: "legacy-object", bytes: Uint8Array.of(1), contentType: "application/octet-stream", expiresAt: "2025-02-01T00:00:00.000Z" });
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const cleanup = new CleanupService(store);
      const result = await runScheduledCleanup({ generic: cleanup, now: () => new Date("2026-01-01T00:00:00.000Z") });
      expect(result.generic).toMatchObject({ status: "fulfilled", expiredSessions: 1, expiredObjects: 1, attemptedItems: 0, completedItems: 0, failedItems: 0, skippedItems: 1 });
      expect(store.objects.get(object.id)?.lifecycle).toBe("delete-pending");
      expect(store.audits.filter(a => a.eventKind === "object-delete")).toEqual([]);
      const retry = await cleanup.run({ now: new Date("2026-01-01T00:00:01.000Z") });
      expect(retry.skippedObjects).toBe(1);
      // A later explicitly supplied object-store adapter can still complete deletion.
      await new CleanupService(store, objects).run({ now: new Date("2026-01-01T00:00:02.000Z") });
      expect(store.objects.get(object.id)?.lifecycle).toBe("deleted");
    } finally { info.mockRestore(); }
  });
});
