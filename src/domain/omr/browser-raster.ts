"use client";

import { binaryDigest, type BinaryDigest } from "../digest/canonical";
import { classifyPdfContent, CORE_OMR_MAX_DIMENSION, CORE_OMR_MAX_PIXELS, type PdfContentProbe } from "./input";

export const OMR_RASTER_POLICY_VERSION = "omr-raster-policy-v1" as const;
export const OMR_RASTER_SCALE = 2 as const;
export const OMR_RASTER_MIME_TYPE = "image/png" as const;
export const OMR_RASTER_MAX_CANVAS_BYTES = 240_000_000 as const;

export interface RasterizedOmrPage {
  readonly pageIndex: number;
  readonly width: number;
  readonly height: number;
  readonly mimeType: typeof OMR_RASTER_MIME_TYPE;
  readonly bytes: Uint8Array;
  readonly pageDigest: BinaryDigest;
  readonly policyVersion: typeof OMR_RASTER_POLICY_VERSION;
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => canvas.toBlob(async (blob) => {
    if (!blob) { reject(new RangeError("OMR_PDF_RASTER_FAILED")); return; }
    resolve(new Uint8Array(await blob.arrayBuffer()));
  }, OMR_RASTER_MIME_TYPE));
}

export async function rasterizePdfPages(input: {
  readonly bytes: Uint8Array;
  readonly maxPages: number;
  readonly signal?: AbortSignal;
}): Promise<{ readonly pages: readonly RasterizedOmrPage[]; readonly probe: PdfContentProbe; readonly classification: ReturnType<typeof classifyPdfContent> }> {
  if (!Number.isSafeInteger(input.maxPages) || input.maxPages < 1) throw new RangeError("OMR_PAGE_LIMIT_INVALID");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({
    data: Uint8Array.from(input.bytes), disableAutoFetch: true, disableRange: true,
    disableStream: true, stopAtErrors: true, useWorkerFetch: false,
  });
  const abort = () => task.destroy();
  input.signal?.addEventListener("abort", abort, { once: true });
  try {
    const pdfDocument = await task.promise;
    if (pdfDocument.numPages < 1 || pdfDocument.numPages > input.maxPages) throw new RangeError("OMR_PAGE_LIMIT_EXCEEDED");
    const pages: RasterizedOmrPage[] = [];
    let textItemCount = 0;
    let textCharacterCount = 0;
    let vectorOperatorCount = 0;
    let imageOperatorCount = 0;
    for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex += 1) {
      if (input.signal?.aborted) throw new DOMException("Rasterization cancelled", "AbortError");
      const page = await pdfDocument.getPage(pageIndex + 1);
      const text = await page.getTextContent({ disableNormalization: false });
      textItemCount += text.items.length;
      textCharacterCount += text.items.reduce((count, item) => count + ("str" in item ? item.str.length : 0), 0);
      const operators = await page.getOperatorList();
      for (const operator of operators.fnArray) {
        if (operator === pdfjs.OPS.paintImageXObject || operator === pdfjs.OPS.paintInlineImageXObject) imageOperatorCount += 1;
        else if (operator === pdfjs.OPS.constructPath || operator === pdfjs.OPS.stroke || operator === pdfjs.OPS.fill) vectorOperatorCount += 1;
      }
      const viewport = page.getViewport({ scale: OMR_RASTER_SCALE, rotation: page.rotate });
      const width = Math.ceil(viewport.width); const height = Math.ceil(viewport.height);
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
        || width > CORE_OMR_MAX_DIMENSION || height > CORE_OMR_MAX_DIMENSION
        || width * height > CORE_OMR_MAX_PIXELS || width * height * 4 > OMR_RASTER_MAX_CANVAS_BYTES) {
        throw new RangeError("OMR_IMAGE_DIMENSIONS_INVALID");
      }
      const canvas = globalThis.document.createElement("canvas");
      try {
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
        if (!context) throw new RangeError("OMR_PDF_CANVAS_UNAVAILABLE");
        context.save(); context.fillStyle = "#ffffff"; context.fillRect(0, 0, width, height); context.restore();
        await page.render({ canvas, canvasContext: context, viewport, background: "rgb(255,255,255)" }).promise;
        const bytes = await canvasPng(canvas);
        pages.push({ pageIndex, width, height, mimeType: OMR_RASTER_MIME_TYPE, bytes, pageDigest: await binaryDigest(bytes), policyVersion: OMR_RASTER_POLICY_VERSION });
      } finally {
        canvas.width = 0; canvas.height = 0; page.cleanup();
      }
    }
    const probe = { pageCount: pdfDocument.numPages, textItemCount, textCharacterCount, vectorOperatorCount, imageOperatorCount };
    return { pages, probe, classification: classifyPdfContent(probe) };
  } catch (error) {
    // Never expose a prefix of a failed document raster.
    throw error;
  } finally {
    input.signal?.removeEventListener("abort", abort);
    await task.destroy().catch(() => undefined);
  }
}
