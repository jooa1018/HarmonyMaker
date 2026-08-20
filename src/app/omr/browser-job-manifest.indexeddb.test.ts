import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import { binaryDigest } from "../../domain/digest/canonical";
import { basisPoints } from "../../domain/rates";
import {
  bindOmrBrowserJobManifest,
  clearOmrBrowserJobManifest,
  createOmrBrowserJobManifest,
  markOmrBrowserJobDeletePending,
  markOmrBrowserJobManifest,
  persistNewOmrBrowserJobManifest,
  readOmrBrowserJobManifest,
  setOmrBrowserUploadRetry,
  type OmrBrowserJobManifest,
} from "./browser-job-manifest";

const quality = {
  blurBp: basisPoints(100),
  perspectiveBp: basisPoints(200),
  glareBp: basisPoints(300),
  cropRiskBp: basisPoints(400),
  estimatedStaffSpacePixels: 20,
  status: "pass" as const,
  reasons: [],
};

function immutablePageAuthority(manifest: OmrBrowserJobManifest) {
  return manifest.pages.map((page) => ({
    pageIndex: page.pageIndex,
    rawDigest: page.rawDigest,
    canonicalPageDigest: page.canonicalPageDigest,
    previewIdentity: page.previewIdentity,
    uploadIdentity: page.uploadIdentity,
  }));
}

describe("actual browser manifest API against fake IndexedDB reloads", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: new IDBFactory(),
    });
  });

  it("preserves [A,B] identity through persist/read/bind/retry/complete/delete-pending/clear", async () => {
    const bytesA = Uint8Array.of(1, 3, 5, 7);
    const bytesB = Uint8Array.of(2, 4, 6, 8);
    const rawA = await binaryDigest(bytesA);
    const rawB = await binaryDigest(bytesB);
    const manifest = await createOmrBrowserJobManifest({
      sourceKind: "camera-photo",
      capabilitySnapshotDigest: "d".repeat(64) as never,
      createStorageKey: "omr-create:indexeddb-lifecycle",
      now: "2026-08-19T00:00:00.000Z",
      pages: [
        {
          pageIndex: 0, rawDigest: rawA, canonicalPageDigest: "a".repeat(64) as never,
          mimeType: "image/png", bytes: bytesA, width: 100, height: 120,
          clientQuality: quality, quality, warnAcknowledged: false, duplicateConfirmed: false,
        },
        {
          pageIndex: 1, rawDigest: rawB, canonicalPageDigest: "b".repeat(64) as never,
          mimeType: "image/jpeg", bytes: bytesB, width: 110, height: 130,
          clientQuality: quality, quality, warnAcknowledged: false, duplicateConfirmed: false,
        },
      ],
    });
    const immutableAuthority = immutablePageAuthority(manifest);

    await persistNewOmrBrowserJobManifest(manifest);
    const afterPersistReload = await readOmrBrowserJobManifest();
    expect(afterPersistReload?.lifecycle).toBe("create-pending");
    expect(afterPersistReload && immutablePageAuthority(afterPersistReload)).toEqual(immutableAuthority);

    const bound = await bindOmrBrowserJobManifest(manifest.manifestDigest, "H-indexeddb-reload");
    expect(bound.lifecycle).toBe("bound");
    expect((await readOmrBrowserJobManifest())?.jobHandle).toBe("H-indexeddb-reload");

    const retry = await setOmrBrowserUploadRetry(manifest.manifestDigest, {
      code: "OMR_PROVIDER_BINDING_UNAVAILABLE",
      attempt: 2,
      nextAttemptAt: "2026-08-19T00:05:00.000Z",
    });
    expect(retry.pendingUploadRetry?.attempt).toBe(2);
    const afterRetryReload = await readOmrBrowserJobManifest();
    expect(afterRetryReload?.pendingUploadRetry?.nextAttemptAt).toBe("2026-08-19T00:05:00.000Z");
    expect(afterRetryReload && immutablePageAuthority(afterRetryReload)).toEqual(immutableAuthority);

    const completed = await markOmrBrowserJobManifest(manifest.manifestDigest, "completed");
    expect(completed.lifecycle).toBe("completed");
    expect(completed.pendingUploadRetry).toBeUndefined();
    const afterCompletedReload = await readOmrBrowserJobManifest();
    expect(afterCompletedReload?.lifecycle).toBe("completed");
    expect(afterCompletedReload && immutablePageAuthority(afterCompletedReload)).toEqual(immutableAuthority);

    const deletePending = await markOmrBrowserJobDeletePending(manifest.manifestDigest, {
      vendorStatus: "failed",
      nextAttemptAt: "2026-08-19T00:30:00.000Z",
    });
    expect(deletePending.lifecycle).toBe("delete-pending");
    const afterDeletePendingReload = await readOmrBrowserJobManifest();
    expect(afterDeletePendingReload?.pendingDeletion).toEqual({
      vendorStatus: "failed",
      nextAttemptAt: "2026-08-19T00:30:00.000Z",
    });
    expect(afterDeletePendingReload && immutablePageAuthority(afterDeletePendingReload)).toEqual(immutableAuthority);

    await expect(clearOmrBrowserJobManifest(manifest.manifestDigest)).resolves.toEqual({
      createStorageKey: "omr-create:indexeddb-lifecycle",
      recoveryStorageKey: "omr-create:indexeddb-lifecycle:recovered-handle",
    });
    await expect(readOmrBrowserJobManifest()).resolves.toBeUndefined();
  });
});
