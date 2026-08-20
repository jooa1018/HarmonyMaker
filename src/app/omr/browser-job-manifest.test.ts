import { describe, expect, it } from "vitest";

import { binaryDigest } from "../../domain/digest/canonical";
import { validateOmrHandoffPageBinding } from "../../domain/omr/browser-handoff";
import { basisPoints } from "../../domain/rates";
import { omrBrowserAuthorityAction } from "./browser-job-lifecycle";
import { createOmrBrowserJobManifest, recoverableOmrManifestStorageKeys, validateOmrBrowserJobManifest } from "./browser-job-manifest";

const quality = {
  blurBp: basisPoints(100), perspectiveBp: basisPoints(200), glareBp: basisPoints(300), cropRiskBp: basisPoints(400),
  estimatedStaffSpacePixels: 20, status: "pass" as const, reasons: [],
};

describe("durable browser OMR page manifest", () => {
  it("freezes ordered raw/canonical/mime/preview/upload identities and verifies bytes after reload cloning", async () => {
    const first = Uint8Array.of(1, 2, 3); const second = Uint8Array.of(4, 5, 6);
    const rawFirst = await binaryDigest(first); const rawSecond = await binaryDigest(second);
    const manifest = await createOmrBrowserJobManifest({
      sourceKind: "camera-photo",
      capabilitySnapshotDigest: "a".repeat(64) as never,
      createStorageKey: "create:manifest",
      now: "2026-08-19T00:00:00.000Z",
      pages: [
        { pageIndex: 0, rawDigest: rawFirst, canonicalPageDigest: "b".repeat(64) as never, mimeType: "image/png", bytes: first, width: 100, height: 120, clientQuality: quality, quality, warnAcknowledged: false, duplicateConfirmed: false },
        { pageIndex: 1, rawDigest: rawSecond, canonicalPageDigest: "c".repeat(64) as never, mimeType: "image/jpeg", bytes: second, width: 110, height: 130, clientQuality: quality, quality, warnAcknowledged: false, duplicateConfirmed: false },
      ],
    });
    await expect(validateOmrBrowserJobManifest(structuredClone(manifest))).resolves.toBe(true);
    expect(manifest.pages.map((page) => ({ pageIndex: page.pageIndex, previewIdentity: page.previewIdentity }))).toEqual([
      { pageIndex: 0, previewIdentity: `omr-preview:0:${rawFirst}` },
      { pageIndex: 1, previewIdentity: `omr-preview:1:${rawSecond}` },
    ]);
    expect(new Set(manifest.pages.map((page) => page.uploadIdentity)).size).toBe(2);
  });

  it("rejects reorder, byte replacement, and immutable identity mutation", async () => {
    const bytes = Uint8Array.of(7, 8, 9); const rawDigest = await binaryDigest(bytes);
    const manifest = await createOmrBrowserJobManifest({
      sourceKind: "scanned-pdf", capabilitySnapshotDigest: "a".repeat(64) as never,
      createStorageKey: "create:tamper", pages: [{ pageIndex: 0, rawDigest, canonicalPageDigest: "b".repeat(64) as never, mimeType: "image/png", bytes, width: 10, height: 20, clientQuality: quality, quality, warnAcknowledged: false, duplicateConfirmed: false }],
    });
    await expect(validateOmrBrowserJobManifest({ ...manifest, pages: [{ ...manifest.pages[0], pageIndex: 1 }] })).resolves.toBe(false);
    await expect(validateOmrBrowserJobManifest({ ...manifest, pages: [{ ...manifest.pages[0], bytes: new Blob([Uint8Array.of(0)], { type: "image/png" }) }] })).resolves.toBe(false);
    await expect(validateOmrBrowserJobManifest({ ...manifest, pages: [{ ...manifest.pages[0], canonicalPageDigest: "c".repeat(64) }] })).resolves.toBe(false);
  });

  it("retains only bounded localStorage keys for explicit disposal of an invalid IndexedDB record", () => {
    expect(recoverableOmrManifestStorageKeys({
      createStorageKey: "create:corrupt", recoveryStorageKey: "create:corrupt:recovered-handle",
      manifestDigest: "invalid",
    })).toEqual({ createStorageKey: "create:corrupt", recoveryStorageKey: "create:corrupt:recovered-handle" });
    expect(recoverableOmrManifestStorageKeys({
      createStorageKey: "x".repeat(2_049), recoveryStorageKey: "untrusted",
    })).toEqual({});
  });

  it("binds ordered [A,B] bytes while evidence page 0 stays A and rejects any reorder", async () => {
    const bytesA = Uint8Array.of(10, 11, 12); const bytesB = Uint8Array.of(20, 21, 22);
    const rawA = await binaryDigest(bytesA); const rawB = await binaryDigest(bytesB);
    const canonicalA = "a".repeat(64) as typeof rawA; const canonicalB = "b".repeat(64) as typeof rawB;
    const manifest = await createOmrBrowserJobManifest({
      sourceKind: "camera-photo", capabilitySnapshotDigest: "c".repeat(64) as never,
      createStorageKey: "create:ordered-a-b",
      pages: [
        { pageIndex: 0, rawDigest: rawA, canonicalPageDigest: canonicalA, mimeType: "image/png", bytes: bytesA, width: 10, height: 20, clientQuality: quality, quality, warnAcknowledged: false, duplicateConfirmed: false },
        { pageIndex: 1, rawDigest: rawB, canonicalPageDigest: canonicalB, mimeType: "image/png", bytes: bytesB, width: 10, height: 20, clientQuality: quality, quality, warnAcknowledged: false, duplicateConfirmed: false },
      ],
    });
    const result = {
      vendorId: "provider", vendorResultDigest: "d".repeat(64) as typeof rawA, rawMusicXml: "<score-partwise/>",
      evidence: {
        granularity: "page" as const,
        frames: [{ id: "frame:A", pageIndex: 0, coordinateSpace: "normalized-original" as const, widthPixels: 10, heightPixels: 20, imageDigest: canonicalA }],
        transforms: [], evidence: [], providerBundleDigest: "e".repeat(64) as never,
      },
      normalizationMapping: {} as never, retentionInfo: { canDeleteImmediately: true },
    };
    const handoffPages = manifest.pages.map((page) => ({
      pageIndex: page.pageIndex, rawDigest: page.rawDigest, canonicalPageDigest: page.canonicalPageDigest,
      mimeType: page.mimeType, blob: page.bytes,
    }));
    await expect(validateOmrBrowserJobManifest(manifest)).resolves.toBe(true);
    await expect(validateOmrHandoffPageBinding(handoffPages, result)).resolves.toBe(true);
    await expect(validateOmrHandoffPageBinding([handoffPages[1], handoffPages[0]], result)).resolves.toBe(false);
    await expect(validateOmrBrowserJobManifest({ ...manifest, pages: [manifest.pages[1], manifest.pages[0]] })).resolves.toBe(false);

    const boundBeforeHistoricalBindingLoss = {
      ...manifest, lifecycle: "bound" as const, jobHandle: "opaque-handle-A",
      pendingUploadRetry: {
        code: "OMR_PROVIDER_BINDING_UNAVAILABLE" as const,
        attempt: 2,
        nextAttemptAt: "2026-08-19T00:05:00.000Z",
      },
    };
    const reloadedWhileBindingUnavailable = structuredClone(boundBeforeHistoricalBindingLoss);
    await expect(validateOmrBrowserJobManifest(reloadedWhileBindingUnavailable)).resolves.toBe(true);
    expect(omrBrowserAuthorityAction({
      lifecycle: reloadedWhileBindingUnavailable.lifecycle,
      statusKind: "created",
      correctionLocked: false,
    })).toBe("resume-upload");
    const afterHistoricalBindingRestore = structuredClone(reloadedWhileBindingUnavailable);
    expect(afterHistoricalBindingRestore.pages.map((page) => ({
      pageIndex: page.pageIndex,
      rawDigest: page.rawDigest,
      canonicalPageDigest: page.canonicalPageDigest,
      uploadIdentity: page.uploadIdentity,
    }))).toEqual(boundBeforeHistoricalBindingLoss.pages.map((page) => ({
      pageIndex: page.pageIndex,
      rawDigest: page.rawDigest,
      canonicalPageDigest: page.canonicalPageDigest,
      uploadIdentity: page.uploadIdentity,
    })));
    expect(afterHistoricalBindingRestore.pendingUploadRetry).toEqual({
      code: "OMR_PROVIDER_BINDING_UNAVAILABLE", attempt: 2, nextAttemptAt: "2026-08-19T00:05:00.000Z",
    });
  });
});
