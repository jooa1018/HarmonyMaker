import { binaryDigest, type BinaryDigest } from "../digest/canonical";
import { hasExactKeys, isPlainRecord } from "../validation";
import { parseSafeXml } from "../../import/musicxml/xml";
import { DEFAULT_IMPORT_SECURITY_LIMITS } from "../../import/musicxml/types";

export const REJECTED_OUTPUT_CODES = ["AUDIVERIS_OUTPUT_INCOMPLETE", "AUDIVERIS_OUTPUT_AMBIGUOUS", "AUDIVERIS_OUTPUT_INVALID"] as const;
export const MAX_REJECTED_OUTPUT_BYTES = 4_000_000;
export interface OmrRejectedOutput {
  readonly version: "hm-omr-rejected-output-v1";
  readonly status: "incomplete";
  readonly code: typeof REJECTED_OUTPUT_CODES[number];
  readonly engineVersion: string;
  readonly pages: readonly { readonly pageIndex: number; readonly pageDigest: BinaryDigest; readonly widthPixels: number; readonly heightPixels: number }[];
  /** Opaque fragments. Their order does not assert musical continuity. */
  readonly documents: readonly { readonly id: string; readonly rawMusicXml: string; readonly sha256: BinaryDigest }[];
}

export async function parseOmrRejectedOutput(bytes: Uint8Array): Promise<OmrRejectedOutput> {
  const fail = (): never => { throw new RangeError("OMR_REJECTED_OUTPUT_INVALID"); };
  if (bytes.length === 0 || bytes.length > MAX_REJECTED_OUTPUT_BYTES) fail();
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!isPlainRecord(value) || !hasExactKeys(value, ["version", "status", "code", "engineVersion", "pages", "documents"])
    || value.version !== "hm-omr-rejected-output-v1" || value.status !== "incomplete"
    || !REJECTED_OUTPUT_CODES.includes(value.code as typeof REJECTED_OUTPUT_CODES[number])
    || typeof value.engineVersion !== "string" || !/^[A-Za-z0-9._-]{1,64}$/u.test(value.engineVersion)
    || !Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 12
    || !Array.isArray(value.documents) || value.documents.length < 1 || value.documents.length > 32) return fail();
  for (const [i, page] of value.pages.entries()) {
    if (!isPlainRecord(page) || !hasExactKeys(page, ["pageIndex", "pageDigest", "widthPixels", "heightPixels"])
      || page.pageIndex !== i || typeof page.pageDigest !== "string" || !/^[0-9a-f]{64}$/u.test(page.pageDigest)
      || !Number.isSafeInteger(page.widthPixels) || Number(page.widthPixels) < 1 || Number(page.widthPixels) > 100_000
      || !Number.isSafeInteger(page.heightPixels) || Number(page.heightPixels) < 1 || Number(page.heightPixels) > 100_000) fail();
  }
  for (const [i, doc] of value.documents.entries()) {
    if (!isPlainRecord(doc) || !hasExactKeys(doc, ["id", "rawMusicXml", "sha256"])
      || doc.id !== `fragment-${i + 1}` || typeof doc.rawMusicXml !== "string" || typeof doc.sha256 !== "string") return fail();
    const raw = new TextEncoder().encode(doc.rawMusicXml);
    if (await binaryDigest(raw) !== doc.sha256) fail();
    const parsed = parseSafeXml(raw, DEFAULT_IMPORT_SECURITY_LIMITS);
    if (parsed.status !== "complete" || parsed.root.name !== "score-partwise") fail();
  }
  return value as unknown as OmrRejectedOutput;
}
