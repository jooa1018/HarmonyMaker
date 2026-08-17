"use client";

import { binaryDigest, type BinaryDigest } from "../digest/canonical";
import { classifyPdfContent, type PdfContentProbe } from "./input";

export const OMR_RASTER_POLICY_VERSION = "omr-raster-policy-v1" as const;
export const OMR_RASTER_SCALE = 2 as const;
export const OMR_RASTER_MIME_TYPE = "image/png" as const;

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
      const canvas = globalThis.document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
      if (!context) throw new RangeError("OMR_PDF_CANVAS_UNAVAILABLE");
      context.save(); context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); context.restore();
      await page.render({ canvas, canvasContext: context, viewport, background: "rgb(255,255,255)" }).promise;
      const bytes = await canvasPng(canvas);
      pages.push({ pageIndex, width: canvas.width, height: canvas.height, mimeType: OMR_RASTER_MIME_TYPE, bytes, pageDigest: await binaryDigest(bytes), policyVersion: OMR_RASTER_POLICY_VERSION });
      page.cleanup();
    }
    const probe = { pageCount: pdfDocument.numPages, textItemCount, textCharacterCount, vectorOperatorCount, imageOperatorCount };
    return { pages, probe, classification: classifyPdfContent(probe) };
  } finally {
    input.signal?.removeEventListener("abort", abort);
    await task.destroy().catch(() => undefined);
  }
}
