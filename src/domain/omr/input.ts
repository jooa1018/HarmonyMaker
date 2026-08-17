import { binaryDigest, type BinaryDigest } from "../digest/canonical";
import { DEFAULT_IMPORT_SECURITY_LIMITS } from "../../import/musicxml/types";
import { extractMusicXmlFromMxl } from "../../import/mxl/archive";
import { parseSafeXml } from "../../import/musicxml/xml";

export type InputSourceKind =
  | "musicxml"
  | "mxl"
  | "digital-pdf"
  | "scanned-pdf"
  | "camera-photo";

export const OMR_INPUT_POLICY_VERSION = "omr-input-policy-v1" as const;
export const CORE_OMR_MAX_FILE_BYTES = 32 * 1024 * 1024;
export const CORE_OMR_MAX_PAGE_BYTES = 12 * 1024 * 1024;
export const CORE_OMR_MAX_DIMENSION = 12_000;
export const CORE_OMR_MAX_PIXELS = 60_000_000;

const MUSICXML_MIME_TYPES = new Set([
  "application/vnd.recordare.musicxml+xml",
  "application/xml",
  "text/xml",
]);
const MXL_MIME_TYPES = new Set([
  "application/vnd.recordare.musicxml",
  "application/zip",
]);
const PDF_MIME_TYPES = new Set(["application/pdf"]);
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

export interface SourceClassification {
  readonly policyVersion: typeof OMR_INPUT_POLICY_VERSION;
  readonly detectedKind: "musicxml" | "mxl" | "pdf" | "camera-photo";
  readonly sourceKind?: InputSourceKind;
  readonly mimeType: string;
  readonly originalBinaryDigest: BinaryDigest;
  readonly originalFileName?: string;
  readonly requiresPdfKindConfirmation: boolean;
}

export interface PdfContentProbe {
  readonly pageCount: number;
  readonly textItemCount: number;
  readonly textCharacterCount: number;
  readonly vectorOperatorCount: number;
  readonly imageOperatorCount: number;
}

function normalizedMime(value: string): string {
  return value.split(";", 1)[0].trim().toLowerCase();
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function boundedXmlRoot(bytes: Uint8Array): boolean {
  const inspected = bytes.subarray(0, Math.min(bytes.byteLength, 256 * 1024));
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(inspected).replace(/^\uFEFF/u, "");
  } catch {
    return false;
  }
  if (!/<(?:score-partwise|score-timewise)(?:\s|>)/u.test(text)) return false;
  return parseSafeXml(bytes, DEFAULT_IMPORT_SECURITY_LIMITS).status !== "blocked";
}

export async function classifyInputSource(input: {
  readonly bytes: Uint8Array;
  readonly declaredMimeType: string;
  readonly originalFileName?: string;
}): Promise<SourceClassification> {
  const bytes = Uint8Array.from(input.bytes);
  if (bytes.byteLength === 0 || bytes.byteLength > CORE_OMR_MAX_FILE_BYTES) {
    throw new RangeError("OMR_INPUT_SIZE_INVALID");
  }
  const mimeType = normalizedMime(input.declaredMimeType);
  const digest = await binaryDigest(bytes);
  const provenance = {
    policyVersion: OMR_INPUT_POLICY_VERSION,
    mimeType,
    originalBinaryDigest: digest,
    ...(input.originalFileName ? { originalFileName: input.originalFileName.normalize("NFC").slice(0, 255) } : {}),
  } as const;

  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    if (!PDF_MIME_TYPES.has(mimeType)) throw new RangeError("OMR_INPUT_MIME_MISMATCH");
    return { ...provenance, detectedKind: "pdf", requiresPdfKindConfirmation: true };
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    if (!MXL_MIME_TYPES.has(mimeType)) throw new RangeError("OMR_INPUT_MIME_MISMATCH");
    const extracted = extractMusicXmlFromMxl(bytes, DEFAULT_IMPORT_SECURITY_LIMITS);
    if (extracted.status === "blocked") throw new RangeError("OMR_INPUT_ARCHIVE_INVALID");
    return { ...provenance, detectedKind: "mxl", sourceKind: "mxl", requiresPdfKindConfirmation: false };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    if (mimeType !== "image/jpeg") throw new RangeError("OMR_INPUT_MIME_MISMATCH");
    return { ...provenance, detectedKind: "camera-photo", sourceKind: "camera-photo", requiresPdfKindConfirmation: false };
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    if (mimeType !== "image/png") throw new RangeError("OMR_INPUT_MIME_MISMATCH");
    return { ...provenance, detectedKind: "camera-photo", sourceKind: "camera-photo", requiresPdfKindConfirmation: false };
  }
  if (MUSICXML_MIME_TYPES.has(mimeType) && boundedXmlRoot(bytes)) {
    return { ...provenance, detectedKind: "musicxml", sourceKind: "musicxml", requiresPdfKindConfirmation: false };
  }
  if (IMAGE_MIME_TYPES.has(mimeType) || PDF_MIME_TYPES.has(mimeType) || MXL_MIME_TYPES.has(mimeType)) {
    throw new RangeError("OMR_INPUT_MAGIC_MISMATCH");
  }
  throw new RangeError("OMR_INPUT_FORMAT_UNSUPPORTED");
}

export function classifyPdfContent(probe: PdfContentProbe): {
  readonly suggestedKind?: "digital-pdf" | "scanned-pdf";
  readonly requiresConfirmation: boolean;
} {
  if (!Number.isSafeInteger(probe.pageCount) || probe.pageCount < 1
    || ![probe.textItemCount, probe.textCharacterCount, probe.vectorOperatorCount, probe.imageOperatorCount]
      .every((value) => Number.isSafeInteger(value) && value >= 0)) throw new RangeError("OMR_PDF_PROBE_INVALID");
  const digital = probe.textCharacterCount >= probe.pageCount * 24
    || (probe.textItemCount >= probe.pageCount * 4 && probe.vectorOperatorCount > probe.imageOperatorCount);
  const scanned = probe.textCharacterCount === 0
    && probe.textItemCount === 0
    && probe.imageOperatorCount >= probe.pageCount;
  if (digital && !scanned) return { suggestedKind: "digital-pdf", requiresConfirmation: false };
  if (scanned && !digital) return { suggestedKind: "scanned-pdf", requiresConfirmation: false };
  return { requiresConfirmation: true };
}

export function validateConfirmedPageOrder(pageIndices: readonly number[], pageCount: number): boolean {
  return Number.isSafeInteger(pageCount) && pageCount > 0
    && pageIndices.length === pageCount
    && new Set(pageIndices).size === pageCount
    && pageIndices.every((value) => Number.isSafeInteger(value) && value >= 0 && value < pageCount);
}
