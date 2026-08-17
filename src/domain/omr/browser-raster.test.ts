import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const pdfState = vi.hoisted(() => ({ pageCount: 2, failLoad: false, failRenderPage: 0, destroyCount: 0 }));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  OPS: { paintImageXObject: 1, paintInlineImageXObject: 2, constructPath: 3, stroke: 4, fill: 5 },
  getDocument: () => {
    const destroy = async () => { pdfState.destroyCount += 1; };
    const promise = pdfState.failLoad
      ? Promise.reject(new RangeError("OMR_PDF_RASTER_FAILED"))
      : Promise.resolve({
        numPages: pdfState.pageCount,
        getPage: async (pageNumber: number) => ({
          rotate: 0,
          getTextContent: async () => ({ items: [{ str: `deterministic digital score page ${pageNumber}` }] }),
          getOperatorList: async () => ({ fnArray: [3, 4, 5] }),
          getViewport: ({ scale }: { readonly scale: number }) => ({ width: pageNumber * 100 * scale, height: pageNumber * 150 * scale }),
          render: ({ canvas }: { readonly canvas: HTMLCanvasElement }) => ({
            promise: pdfState.failRenderPage === pageNumber
              ? Promise.reject(new RangeError("OMR_PDF_RASTER_FAILED"))
              : Promise.resolve().then(() => { (canvas as HTMLCanvasElement & { __pageBytes: Uint8Array }).__pageBytes = new TextEncoder().encode(`page:${pageNumber}:${canvas.width}x${canvas.height}`); }),
          }),
          cleanup: vi.fn(),
        }),
      });
    return { promise, destroy };
  },
}));

import { OMR_RASTER_POLICY_VERSION, OMR_RASTER_SCALE, rasterizePdfPages } from "./browser-raster";

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalDevicePixelRatio = Object.getOwnPropertyDescriptor(globalThis, "devicePixelRatio");

beforeAll(() => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => ({
        width: 0, height: 0, __pageBytes: new Uint8Array(),
        getContext: () => ({ save: () => undefined, restore: () => undefined, fillRect: () => undefined, fillStyle: "" }),
        toBlob(callback: (blob: Blob | null) => void) { callback(new Blob([this.__pageBytes], { type: "image/png" })); },
      }),
    },
  });
});

afterAll(() => {
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument); else Reflect.deleteProperty(globalThis, "document");
  if (originalDevicePixelRatio) Object.defineProperty(globalThis, "devicePixelRatio", originalDevicePixelRatio); else Reflect.deleteProperty(globalThis, "devicePixelRatio");
});

beforeEach(() => {
  pdfState.pageCount = 2; pdfState.failLoad = false; pdfState.failRenderPage = 0; pdfState.destroyCount = 0;
});

describe("deterministic browser PDF.js raster policy", () => {
  it("orders pages, fixes scale and dimensions, and ignores devicePixelRatio", async () => {
    Object.defineProperty(globalThis, "devicePixelRatio", { configurable: true, value: 1 });
    const first = await rasterizePdfPages({ bytes: new Uint8Array([1]), maxPages: 2 });
    Object.defineProperty(globalThis, "devicePixelRatio", { configurable: true, value: 3 });
    const second = await rasterizePdfPages({ bytes: new Uint8Array([1]), maxPages: 2 });
    expect(OMR_RASTER_SCALE).toBe(2);
    expect(first.pages.map(({ pageIndex, width, height, policyVersion }) => ({ pageIndex, width, height, policyVersion }))).toEqual([
      { pageIndex: 0, width: 200, height: 300, policyVersion: OMR_RASTER_POLICY_VERSION },
      { pageIndex: 1, width: 400, height: 600, policyVersion: OMR_RASTER_POLICY_VERSION },
    ]);
    expect(second.pages.map((page) => page.pageDigest)).toEqual(first.pages.map((page) => page.pageDigest));
    expect(first.classification).toEqual({ suggestedKind: "digital-pdf", requiresConfirmation: false });
    expect(pdfState.destroyCount).toBe(2);
  });

  it("rejects corrupt, over-page, cancelled, and partial raster results", async () => {
    pdfState.failLoad = true;
    await expect(rasterizePdfPages({ bytes: new Uint8Array([1]), maxPages: 2 })).rejects.toThrow("OMR_PDF_RASTER_FAILED");
    pdfState.failLoad = false; pdfState.pageCount = 3;
    await expect(rasterizePdfPages({ bytes: new Uint8Array([1]), maxPages: 2 })).rejects.toThrow("OMR_PAGE_LIMIT_EXCEEDED");
    pdfState.pageCount = 2; pdfState.failRenderPage = 2;
    await expect(rasterizePdfPages({ bytes: new Uint8Array([1]), maxPages: 2 })).rejects.toThrow("OMR_PDF_RASTER_FAILED");
    pdfState.failRenderPage = 0;
    const controller = new AbortController(); controller.abort();
    await expect(rasterizePdfPages({ bytes: new Uint8Array([1]), maxPages: 2, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    await expect(rasterizePdfPages({ bytes: new Uint8Array([1]), maxPages: 0 })).rejects.toThrow("OMR_PAGE_LIMIT_INVALID");
  });
});
