import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { decodeOmrImagePage, validateOmrImageDimensions } from "./page-decoder";
import { referenceOmrPageBytes } from "../../domain/omr/reference-fixture-data";

describe("authoritative OMR image decode", () => {
  it("normalizes JPEG bytes to one deterministic metadata-free PNG page", async () => {
    const source = Uint8Array.from(await sharp({ create: { width: 80, height: 60, channels: 3, background: "white" } })
      .jpeg({ quality: 90 }).toBuffer());
    const first = await decodeOmrImagePage({ bytes: source, declaredMimeType: "image/jpeg", pageIndex: 0 });
    const second = await decodeOmrImagePage({ bytes: source, declaredMimeType: "image/jpeg", pageIndex: 0 });
    expect(first).toEqual(second);
    expect(first).toMatchObject({ pageIndex: 0, width: 80, height: 60, mimeType: "image/png", policyVersion: "omr-image-policy-v1" });
    expect(first.pageDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.originalBinaryDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects a declared MIME that disagrees with decoded bytes", async () => {
    const source = Uint8Array.from(await sharp({ create: { width: 16, height: 16, channels: 3, background: "white" } }).png().toBuffer());
    await expect(decodeOmrImagePage({ bytes: source, declaredMimeType: "image/jpeg", pageIndex: 0 }))
      .rejects.toThrow("OMR_INPUT_MIME_MISMATCH");
  });

  it("normalizes EXIF orientation and rejects unsupported or oversized dimensions", async () => {
    const rotated = Uint8Array.from(await sharp({ create: { width: 40, height: 20, channels: 3, background: "white" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer());
    const normalized = await decodeOmrImagePage({ bytes: rotated, declaredMimeType: "image/jpeg", pageIndex: 0 });
    expect(normalized).toMatchObject({ width: 20, height: 40, mimeType: "image/png" });
    const oversized = Uint8Array.from(await sharp({ create: { width: 12_001, height: 8, channels: 3, background: "white" } }).png().toBuffer());
    await expect(decodeOmrImagePage({ bytes: oversized, declaredMimeType: "image/png", pageIndex: 0 })).rejects.toThrow("OMR_IMAGE_DIMENSIONS_INVALID");
    expect(() => validateOmrImageDimensions(12_000, 5_001)).toThrow("OMR_IMAGE_DIMENSIONS_INVALID");
    expect(() => validateOmrImageDimensions(10_000, 6_000)).not.toThrow();
  });

  it("keeps the shared client/server reference fixture quality decision stable", async () => {
    const decoded = await decodeOmrImagePage({ bytes: referenceOmrPageBytes(), declaredMimeType: "image/png", pageIndex: 0 });
    expect(decoded.quality).toMatchObject({ status: "pass", reasons: [] });
  });
});
