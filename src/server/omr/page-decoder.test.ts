import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { decodeOmrImagePage, validateOmrImageDimensions } from "./page-decoder";
import { referenceOmrPageBytes } from "../../domain/omr/reference-fixture-data";
import { REFERENCE_OMR_DUPLICATE_JPEG_CANONICAL_DIGEST, REFERENCE_OMR_DUPLICATE_JPEG_RAW_DIGESTS, referenceOmrDuplicateJpegPages } from "../../domain/omr/reference-duplicate-jpeg-fixture-data";
import { binaryDigest } from "../../domain/digest/canonical";
import { analyzeImageQuality } from "../../domain/omr/image-quality";

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

  it("keeps distinct raw JPEG fixture bytes bound to one canonical decoded page", async () => {
    const pages = referenceOmrDuplicateJpegPages();
    expect(await Promise.all(pages.map(binaryDigest))).toEqual(REFERENCE_OMR_DUPLICATE_JPEG_RAW_DIGESTS);
    const decoded = await Promise.all(pages.map((bytes, pageIndex) => decodeOmrImagePage({ bytes, declaredMimeType: "image/jpeg", pageIndex })));
    expect(decoded.map((page) => page.pageDigest)).toEqual([REFERENCE_OMR_DUPLICATE_JPEG_CANONICAL_DIGEST, REFERENCE_OMR_DUPLICATE_JPEG_CANONICAL_DIGEST]);
    expect(decoded.map((page) => page.quality.status)).toEqual(["pass", "pass"]);
  });

  it("uses the server report as authority across actual high-resolution client downscales at 12/18px staff space", async () => {
    const fixture = async (staffSpace: 12 | 18) => {
      const lines = Array.from({ length: 80 }, (_, index) => `<line x1="180" x2="2220" y1="${200 + index * staffSpace}" y2="${200 + index * staffSpace}" stroke="black" stroke-width="2"/>`).join("");
      const bytes = Uint8Array.from(await sharp(Buffer.from(`<svg width="2400" height="3200" xmlns="http://www.w3.org/2000/svg"><rect width="2400" height="3200" fill="white"/>${lines}<polygon points="250,250 2100,280 2050,2800 300,2750" fill="none" stroke="#555" stroke-width="3"/><circle cx="1200" cy="900" r="120" fill="white"/></svg>`)).png().toBuffer());
      const server = await decodeOmrImagePage({ bytes, declaredMimeType: "image/png", pageIndex: 0 });
      const scale = 1800 / 3200; const width = Math.round(2400 * scale); const height = 1800;
      const clientPlane = await sharp(server.bytes).resize(width, height, { fit: "fill" }).greyscale().raw().toBuffer();
      const client = analyzeImageQuality({ width, height, luma: Uint8Array.from(clientPlane), originalWidth: 2400, originalHeight: 3200 });
      return { server: server.quality, client };
    };
    const borderline = await fixture(12); const valid = await fixture(18);
    expect(borderline.server).toMatchObject({ blurBp: 0, perspectiveBp: 75, glareBp: 0, cropRiskBp: 0, estimatedStaffSpacePixels: 12, status: "warn", reasons: ["OMR_QUALITY_STAFF_SPACE_BORDERLINE"] });
    expect(borderline.client).toMatchObject({ blurBp: 0, perspectiveBp: 44, glareBp: 0, cropRiskBp: 0, estimatedStaffSpacePixels: 12, status: "warn", reasons: ["OMR_QUALITY_STAFF_SPACE_BORDERLINE"] });
    expect(valid.server).toMatchObject({ blurBp: 0, perspectiveBp: 75, glareBp: 0, cropRiskBp: 0, estimatedStaffSpacePixels: 18, status: "pass", reasons: [] });
    expect(valid.client).toMatchObject({ blurBp: 0, perspectiveBp: 44, glareBp: 0, cropRiskBp: 0, estimatedStaffSpacePixels: 18, status: "pass", reasons: [] });
    for (const pair of [borderline, valid]) for (const report of [pair.client, pair.server]) {
      for (const metric of [report.blurBp, report.perspectiveBp, report.glareBp, report.cropRiskBp]) expect(metric).toBeGreaterThanOrEqual(0);
      expect(["pass", "warn", "retake"]).toContain(report.status);
    }
    expect(valid.server.reasons).not.toContain("OMR_QUALITY_STAFF_SPACE_BORDERLINE");
    expect(borderline.server.reasons).toContain("OMR_QUALITY_STAFF_SPACE_BORDERLINE");
  });
});
