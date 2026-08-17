import "server-only";

import sharp from "sharp";

import { binaryDigest, type BinaryDigest } from "../../domain/digest/canonical";
import { analyzeImageQuality, type ImageQualityReport } from "../../domain/omr/image-quality";
import {
  CORE_OMR_MAX_DIMENSION, CORE_OMR_MAX_PAGE_BYTES, CORE_OMR_MAX_PIXELS,
} from "../../domain/omr/input";

export const OMR_IMAGE_POLICY_VERSION = "omr-image-policy-v1" as const;

export interface DecodedOmrPage {
  readonly pageIndex: number;
  readonly width: number;
  readonly height: number;
  readonly mimeType: "image/png";
  readonly bytes: Uint8Array;
  readonly pageDigest: BinaryDigest;
  readonly originalBinaryDigest: BinaryDigest;
  readonly quality: ImageQualityReport;
  readonly policyVersion: typeof OMR_IMAGE_POLICY_VERSION;
}

export function validateOmrImageDimensions(width: number | undefined, height: number | undefined): void {
  if (!width || !height || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width > CORE_OMR_MAX_DIMENSION || height > CORE_OMR_MAX_DIMENSION
    || width * height > CORE_OMR_MAX_PIXELS) throw new RangeError("OMR_IMAGE_DIMENSIONS_INVALID");
}

export async function decodeOmrImagePage(input: {
  readonly bytes: Uint8Array;
  readonly declaredMimeType: "image/jpeg" | "image/png";
  readonly pageIndex: number;
}): Promise<DecodedOmrPage> {
  if (!Number.isSafeInteger(input.pageIndex) || input.pageIndex < 0) throw new RangeError("OMR_PAGE_INDEX_INVALID");
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > CORE_OMR_MAX_PAGE_BYTES) throw new RangeError("OMR_PAGE_SIZE_INVALID");
  const source = sharp(input.bytes, { failOn: "error", limitInputPixels: CORE_OMR_MAX_PIXELS, sequentialRead: true });
  const metadata = await source.metadata();
  const expected = input.declaredMimeType === "image/jpeg" ? "jpeg" : "png";
  if (metadata.format !== expected) throw new RangeError("OMR_INPUT_MIME_MISMATCH");
  validateOmrImageDimensions(metadata.width, metadata.height);
  const normalized = sharp(input.bytes, { failOn: "error", limitInputPixels: CORE_OMR_MAX_PIXELS, sequentialRead: true })
    .rotate().toColourspace("srgb").removeAlpha();
  const bytes = Uint8Array.from(await normalized.clone().png({ compressionLevel: 9, adaptiveFiltering: false, palette: false, force: true }).toBuffer());
  const { data, info } = await sharp(bytes).greyscale().raw().toBuffer({ resolveWithObject: true });
  const originalBinaryDigest = await binaryDigest(input.bytes);
  return {
    pageIndex: input.pageIndex, width: info.width, height: info.height,
    mimeType: "image/png", bytes, pageDigest: await binaryDigest(bytes), originalBinaryDigest,
    quality: analyzeImageQuality({ width: info.width, height: info.height, luma: Uint8Array.from(data) }),
    policyVersion: OMR_IMAGE_POLICY_VERSION,
  };
}
