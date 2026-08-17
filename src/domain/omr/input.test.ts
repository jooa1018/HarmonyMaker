import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";

import { classifyInputSource, classifyPdfContent, validateConfirmedPageOrder } from "./input";
import { CORE_OMR_MAX_FILE_BYTES } from "./input";

const xml = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Lead</part-name></score-part></part-list><part id="P1"><measure number="1"/></part></score-partwise>`);

describe("OMR source classification", () => {
  it("uses bounded content and MIME together for MusicXML, MXL, PDF, JPEG, and PNG", async () => {
    await expect(classifyInputSource({ bytes: xml, declaredMimeType: "application/vnd.recordare.musicxml+xml", originalFileName: "song.bin" }))
      .resolves.toMatchObject({ detectedKind: "musicxml", sourceKind: "musicxml", requiresPdfKindConfirmation: false });
    const container = `<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;
    const mxl = zipSync({ "META-INF/container.xml": strToU8(container), "score.musicxml": xml }, { level: 0 });
    await expect(classifyInputSource({ bytes: mxl, declaredMimeType: "application/vnd.recordare.musicxml" }))
      .resolves.toMatchObject({ detectedKind: "mxl", sourceKind: "mxl" });
    await expect(classifyInputSource({ bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]), declaredMimeType: "application/pdf" }))
      .resolves.toMatchObject({ detectedKind: "pdf", requiresPdfKindConfirmation: true });
    await expect(classifyInputSource({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xdb]), declaredMimeType: "image/jpeg" }))
      .resolves.toMatchObject({ detectedKind: "camera-photo" });
    await expect(classifyInputSource({ bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), declaredMimeType: "image/png" }))
      .resolves.toMatchObject({ detectedKind: "camera-photo" });
  });

  it("rejects MIME/magic mismatches and archives masquerading as images", async () => {
    await expect(classifyInputSource({ bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), declaredMimeType: "image/png" }))
      .rejects.toThrow("OMR_INPUT_MIME_MISMATCH");
    await expect(classifyInputSource({ bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]), declaredMimeType: "image/jpeg" }))
      .rejects.toThrow("OMR_INPUT_MIME_MISMATCH");
    await expect(classifyInputSource({ bytes: new Uint8Array([1, 2, 3]), declaredMimeType: "image/png" }))
      .rejects.toThrow("OMR_INPUT_MAGIC_MISMATCH");
    await expect(classifyInputSource({ bytes: new Uint8Array(CORE_OMR_MAX_FILE_BYTES + 1), declaredMimeType: "image/png" }))
      .rejects.toThrow("OMR_INPUT_SIZE_INVALID");
    await expect(classifyInputSource({ bytes: new Uint8Array(), declaredMimeType: "image/png" }))
      .rejects.toThrow("OMR_INPUT_SIZE_INVALID");
    await expect(classifyInputSource({ bytes: new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), declaredMimeType: "image/gif" }))
      .rejects.toThrow("OMR_INPUT_FORMAT_UNSUPPORTED");
    await expect(classifyInputSource({ bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), declaredMimeType: "application/vnd.recordare.musicxml" }))
      .rejects.toThrow("OMR_INPUT_ARCHIVE_INVALID");
  });

  it("keeps digital/scanned PDF classification a deterministic suggestion", () => {
    expect(classifyPdfContent({ pageCount: 2, textItemCount: 20, textCharacterCount: 200, vectorOperatorCount: 10, imageOperatorCount: 0 }))
      .toEqual({ suggestedKind: "digital-pdf", requiresConfirmation: false });
    expect(classifyPdfContent({ pageCount: 2, textItemCount: 0, textCharacterCount: 0, vectorOperatorCount: 0, imageOperatorCount: 2 }))
      .toEqual({ suggestedKind: "scanned-pdf", requiresConfirmation: false });
    expect(classifyPdfContent({ pageCount: 2, textItemCount: 1, textCharacterCount: 3, vectorOperatorCount: 1, imageOperatorCount: 1 }))
      .toEqual({ requiresConfirmation: true });
    expect(validateConfirmedPageOrder([2, 0, 1], 3)).toBe(true);
    expect(validateConfirmedPageOrder([0, 0, 2], 3)).toBe(false);
    expect(() => classifyPdfContent({ pageCount: 0, textItemCount: 0, textCharacterCount: 0, vectorOperatorCount: 0, imageOperatorCount: 0 })).toThrow("OMR_PDF_PROBE_INVALID");
  });
});
