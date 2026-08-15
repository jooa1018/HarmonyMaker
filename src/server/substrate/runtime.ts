import "server-only";

import { S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import sharp from "sharp";

import type { ProductionSubstrateConfig } from "./config";

export interface SubstrateCompatibilitySnapshot {
  readonly runtime: "nodejs";
  readonly postgresDriver: "pg";
  readonly objectStoreClient: "@aws-sdk/client-s3";
  readonly pdfRasterizer: "pdfjs-dist";
  readonly imageNormalizer: "sharp";
  readonly checks: {
    readonly postgresPoolConstructedWithoutConnection: true;
    readonly s3ClientConstructedWithoutRequest: true;
    readonly pdfDocumentLoaderAvailable: true;
    readonly sharpNativePipelineAvailable: true;
  };
}

/**
 * Performs a no-network runtime proof for the frozen Segment-A dependency set.
 * No database connection, S3 request, PDF rasterization, or OMR flow occurs.
 */
export async function inspectSubstrateCompatibility(
  config: ProductionSubstrateConfig,
): Promise<SubstrateCompatibilitySnapshot> {
  const pool = new Pool({ connectionString: config.database.connectionString, max: 1 });
  const postgresPoolConstructedWithoutConnection = typeof pool.connect === "function";
  await pool.end();

  const s3 = new S3Client({
    endpoint: config.objectStore.endpoint,
    region: config.objectStore.region,
    credentials: {
      accessKeyId: config.objectStore.accessKeyId,
      secretAccessKey: config.objectStore.secretAccessKey,
    },
  });
  const s3ClientConstructedWithoutRequest = typeof s3.send === "function";
  s3.destroy();

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfDocumentLoaderAvailable = typeof pdfjs.getDocument === "function";

  const normalizedImage = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  }).png().toBuffer();
  const metadata = await sharp(normalizedImage).metadata();
  const sharpNativePipelineAvailable = metadata.width === 1 && metadata.height === 1;

  if (
    !postgresPoolConstructedWithoutConnection
    || !s3ClientConstructedWithoutRequest
    || !pdfDocumentLoaderAvailable
    || !sharpNativePipelineAvailable
  ) {
    throw new Error("SUBSTRATE_COMPATIBILITY_PROBE_FAILED");
  }

  return {
    runtime: "nodejs",
    postgresDriver: "pg",
    objectStoreClient: "@aws-sdk/client-s3",
    pdfRasterizer: "pdfjs-dist",
    imageNormalizer: "sharp",
    checks: {
      postgresPoolConstructedWithoutConnection: true,
      s3ClientConstructedWithoutRequest: true,
      pdfDocumentLoaderAvailable: true,
      sharpNativePipelineAvailable: true,
    },
  };
}
