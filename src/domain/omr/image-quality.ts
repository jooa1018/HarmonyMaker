import type { BasisPoints } from "../rates";

export const OMR_IMAGE_QUALITY_POLICY_VERSION = "omr-image-quality-policy-v1" as const;

export const IMAGE_QUALITY_REASON_CODES = Object.freeze([
  "OMR_QUALITY_STAFF_SPACE_TOO_SMALL",
  "OMR_QUALITY_STAFF_SPACE_BORDERLINE",
  "OMR_QUALITY_BLUR_SEVERE",
  "OMR_QUALITY_BLUR_WARNING",
  "OMR_QUALITY_PERSPECTIVE_SEVERE",
  "OMR_QUALITY_PERSPECTIVE_WARNING",
  "OMR_QUALITY_GLARE_SEVERE",
  "OMR_QUALITY_GLARE_WARNING",
  "OMR_QUALITY_CROP_SEVERE",
  "OMR_QUALITY_CROP_WARNING",
] as const);

export interface ImageQualityReport {
  readonly blurBp: BasisPoints;
  readonly perspectiveBp: BasisPoints;
  readonly glareBp: BasisPoints;
  readonly cropRiskBp: BasisPoints;
  readonly estimatedStaffSpacePixels?: number;
  readonly status: "pass" | "warn" | "retake";
  readonly reasons: readonly string[];
}

export interface DecodedLumaImage {
  readonly width: number;
  readonly height: number;
  readonly luma: Uint8Array;
}

function bp(value: number): BasisPoints {
  return Math.max(0, Math.min(10_000, Math.round(value))) as BasisPoints;
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function estimateStaffSpace(image: DecodedLumaImage): number | undefined {
  const { width, height, luma } = image;
  const rows: number[] = [];
  for (let y = 0; y < height; y += 1) {
    let ink = 0;
    for (let x = 0; x < width; x += 1) if (luma[y * width + x] < 96) ink += 1;
    if (ink * 5 >= width) rows.push(y);
  }
  const centers: number[] = [];
  for (const row of rows) {
    if (centers.length === 0 || row > centers[centers.length - 1] + 1) centers.push(row);
    else centers[centers.length - 1] = Math.floor((centers[centers.length - 1] + row + 1) / 2);
  }
  const gaps = centers.slice(1).map((value, index) => value - centers[index]).filter((gap) => gap >= 3 && gap <= 64);
  const candidate = median(gaps);
  if (candidate === undefined) return undefined;
  const matching = gaps.filter((gap) => Math.abs(gap - candidate) <= Math.max(1, Math.floor(candidate / 4)));
  return matching.length >= 3 ? Math.round(median(matching) ?? candidate) : undefined;
}

export function analyzeImageQuality(image: DecodedLumaImage): ImageQualityReport {
  const { width, height, luma } = image;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 8 || height < 8
    || luma.byteLength !== width * height) throw new RangeError("OMR_IMAGE_QUALITY_INPUT_INVALID");

  const stride = Math.max(1, Math.floor(Math.min(width, height) / 900));
  let laplacian = 0;
  let laplacianSamples = 0;
  let white = 0;
  let dark = 0;
  let samples = 0;
  let firstInkX = 0;
  let firstInkY = 0;
  let lastInkX = 0;
  let lastInkY = 0;
  let firstInkCount = 0;
  let lastInkCount = 0;
  const border = Math.max(2, Math.floor(Math.min(width, height) / 50));
  let borderInk = 0;
  let borderSamples = 0;
  for (let y = stride; y < height - stride; y += stride) {
    for (let x = stride; x < width - stride; x += stride) {
      const value = luma[y * width + x];
      const local = Math.abs(4 * value
        - luma[y * width + x - stride] - luma[y * width + x + stride]
        - luma[(y - stride) * width + x] - luma[(y + stride) * width + x]);
      if (local > 4) {
        laplacian += Math.min(255, local);
        laplacianSamples += 1;
      }
      if (value >= 250) white += 1;
      if (value < 96) {
        dark += 1;
        if (y < height / 3) { firstInkX += x; firstInkY += y; firstInkCount += 1; }
        if (y > height * 2 / 3) { lastInkX += x; lastInkY += y; lastInkCount += 1; }
      }
      samples += 1;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < border || x >= width - border || y < border || y >= height - border) {
        borderSamples += 1;
        if (luma[y * width + x] < 128) borderInk += 1;
      }
    }
  }
  const averageLaplacian = laplacianSamples === 0 ? 0 : Math.floor(laplacian / laplacianSamples);
  const blurBp = bp(10_000 - averageLaplacian * 145);
  const whiteBp = samples === 0 ? 0 : Math.floor(white * 10_000 / samples);
  const darkBp = samples === 0 ? 0 : Math.floor(dark * 10_000 / samples);
  const glareBp = bp(Math.max(0, whiteBp - 9_800) * 20 + (darkBp < 80 ? 2_000 : 0));
  const cropRiskBp = bp(borderSamples === 0 ? 0 : borderInk * 40_000 / borderSamples);
  const topCentroid = firstInkCount === 0 ? undefined : [Math.floor(firstInkX / firstInkCount), Math.floor(firstInkY / firstInkCount)] as const;
  const bottomCentroid = lastInkCount === 0 ? undefined : [Math.floor(lastInkX / lastInkCount), Math.floor(lastInkY / lastInkCount)] as const;
  const perspectiveBp = bp(!topCentroid || !bottomCentroid ? 0
    : Math.abs(topCentroid[0] - bottomCentroid[0]) * 20_000 / Math.max(width, 1));
  const estimatedStaffSpacePixels = estimateStaffSpace(image);

  const reasons: string[] = [];
  let status: ImageQualityReport["status"] = "pass";
  const retake = (reason: string) => { reasons.push(reason); status = "retake"; };
  const warn = (reason: string) => { reasons.push(reason); if (status === "pass") status = "warn"; };
  if (estimatedStaffSpacePixels !== undefined && estimatedStaffSpacePixels < 12) retake("OMR_QUALITY_STAFF_SPACE_TOO_SMALL");
  else if (estimatedStaffSpacePixels !== undefined && estimatedStaffSpacePixels < 18) warn("OMR_QUALITY_STAFF_SPACE_BORDERLINE");
  if (blurBp >= 8_000) retake("OMR_QUALITY_BLUR_SEVERE"); else if (blurBp >= 5_500) warn("OMR_QUALITY_BLUR_WARNING");
  if (perspectiveBp >= 6_500) retake("OMR_QUALITY_PERSPECTIVE_SEVERE"); else if (perspectiveBp >= 3_500) warn("OMR_QUALITY_PERSPECTIVE_WARNING");
  if (glareBp >= 7_000) retake("OMR_QUALITY_GLARE_SEVERE"); else if (glareBp >= 3_500) warn("OMR_QUALITY_GLARE_WARNING");
  if (cropRiskBp >= 7_000) retake("OMR_QUALITY_CROP_SEVERE"); else if (cropRiskBp >= 2_500) warn("OMR_QUALITY_CROP_WARNING");
  return {
    blurBp, perspectiveBp, glareBp, cropRiskBp,
    ...(estimatedStaffSpacePixels === undefined ? {} : { estimatedStaffSpacePixels }),
    status, reasons,
  };
}
