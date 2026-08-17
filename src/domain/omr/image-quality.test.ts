import { describe, expect, it } from "vitest";

import { analyzeImageQuality } from "./image-quality";

function staffFixture(space: number, offset = 20, width = 240, height = 180) {
  const luma = new Uint8Array(width * height).fill(255);
  for (let staff = 0; staff < 2; staff += 1) {
    const top = offset + staff * space * 7;
    for (let line = 0; line < 5; line += 1) {
      const y = top + line * space;
      for (let x = 10; x < width - 10; x += 1) luma[y * width + x] = 0;
    }
  }
  return { width, height, luma };
}

describe("deterministic OMR image-quality policy", () => {
  it("applies the exact initial staff-space status thresholds", () => {
    const small = analyzeImageQuality(staffFixture(10));
    const borderline = analyzeImageQuality(staffFixture(15));
    const adequate = analyzeImageQuality(staffFixture(20, 10, 260, 340));
    expect(small.estimatedStaffSpacePixels).toBe(10);
    expect(small.status).toBe("retake");
    expect(small.reasons).toContain("OMR_QUALITY_STAFF_SPACE_TOO_SMALL");
    expect(borderline.estimatedStaffSpacePixels).toBe(15);
    expect(borderline.status).toBe("warn");
    expect(borderline.reasons).toContain("OMR_QUALITY_STAFF_SPACE_BORDERLINE");
    expect(adequate.estimatedStaffSpacePixels).toBe(20);
    expect(adequate.reasons).not.toContain("OMR_QUALITY_STAFF_SPACE_BORDERLINE");
  });

  it("returns only bounded integer basis points and stable reason ordering", () => {
    const first = analyzeImageQuality(staffFixture(15));
    const second = analyzeImageQuality(staffFixture(15));
    expect(second).toEqual(first);
    for (const value of [first.blurBp, first.perspectiveBp, first.glareBp, first.cropRiskBp]) {
      expect(Number.isSafeInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(10_000);
    }
  });

  it("detects severe blur and border crop risk with deterministic proxies", () => {
    const blurred = new Uint8Array(120 * 120).fill(128);
    const blurReport = analyzeImageQuality({ width: 120, height: 120, luma: blurred });
    expect(blurReport.status).toBe("retake");
    expect(blurReport.reasons).toContain("OMR_QUALITY_BLUR_SEVERE");
    const cropped = staffFixture(18, 0, 240, 300);
    for (let y = 0; y < 6; y += 1) for (let x = 0; x < cropped.width; x += 1) cropped.luma[y * cropped.width + x] = 0;
    const cropReport = analyzeImageQuality(cropped);
    expect(cropReport.cropRiskBp).toBeGreaterThanOrEqual(2_500);
    expect(cropReport.reasons.some((reason) => reason.includes("CROP"))).toBe(true);
  });

  it("reports glare and perspective through bounded deterministic geometry", () => {
    const white = new Uint8Array(200 * 200).fill(255);
    const glare = analyzeImageQuality({ width: 200, height: 200, luma: white });
    expect(glare.glareBp).toBeGreaterThanOrEqual(3_500);
    expect(glare.reasons).toContain("OMR_QUALITY_GLARE_WARNING");

    const width = 260; const height = 300;
    const skewed = new Uint8Array(width * height).fill(255);
    for (let y = 20; y < 90; y += 1) for (let x = 15; x < 35; x += 1) skewed[y * width + x] = 0;
    for (let y = 210; y < 280; y += 1) for (let x = 215; x < 235; x += 1) skewed[y * width + x] = 0;
    const perspective = analyzeImageQuality({ width, height, luma: skewed });
    expect(perspective.perspectiveBp).toBeGreaterThanOrEqual(6_500);
    expect(perspective.reasons).toContain("OMR_QUALITY_PERSPECTIVE_SEVERE");
  });
});
