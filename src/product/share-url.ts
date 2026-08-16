import { gunzipSync, gzipSync, strFromU8, strToU8 } from "fflate";
import { decodePracticeShare, encodePracticeShare, type PracticeSharePayload } from "../domain/share";

export const PRODUCT_URL_SHARE_LIMIT = 6000;
function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + 0x8000, bytes.length)));
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}
function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new RangeError("SHARE_PAYLOAD_INVALID");
  const base64 = value.replace(/-/gu, "+").replace(/_/gu, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
export function encodeProductUrlShare(payload: PracticeSharePayload): string { return base64Url(gzipSync(strToU8(encodePracticeShare(payload)), { level: 9 })); }
export function decodeProductUrlShare(encoded: string): PracticeSharePayload {
  try { return decodePracticeShare(strFromU8(gunzipSync(fromBase64Url(encoded)))); } catch { throw new RangeError("SHARE_PAYLOAD_INVALID"); }
}
export function urlShareFits(encoded: string): boolean { return new TextEncoder().encode(encoded).byteLength <= PRODUCT_URL_SHARE_LIMIT; }
