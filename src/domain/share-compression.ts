import { Gunzip, gzipSync, strToU8 } from "fflate";

import { decodePracticeShare, encodePracticeShare, PRACTICE_SHARE_LIMITS, type PracticeSharePayload } from "./share";

export const PRACTICE_SHARE_MAX_COMPRESSED_BYTES = 6_000;

export function practiceSharePlaintext(payload: PracticeSharePayload): Uint8Array {
  const plaintext = strToU8(encodePracticeShare(payload));
  if (plaintext.byteLength > PRACTICE_SHARE_LIMITS.maxPlaintextBytes) throw new RangeError("SHARE_PAYLOAD_TOO_LARGE");
  return plaintext;
}

export function compressPracticeShare(payload: PracticeSharePayload): Uint8Array {
  return gzipSync(practiceSharePlaintext(payload), { level: 9 });
}

export function decompressPracticeShare(compressed: Uint8Array): PracticeSharePayload {
  if (compressed.byteLength === 0 || compressed.byteLength > PRACTICE_SHARE_MAX_COMPRESSED_BYTES) {
    throw new RangeError("SHARE_PAYLOAD_TOO_LARGE");
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    const gunzip = new Gunzip((chunk, final) => {
      length += chunk.byteLength;
      if (length > PRACTICE_SHARE_LIMITS.maxPlaintextBytes) throw new RangeError("SHARE_PAYLOAD_TOO_LARGE");
      chunks.push(Uint8Array.from(chunk));
      if (final && length === 0) throw new RangeError("SHARE_PAYLOAD_INVALID");
    });
    gunzip.push(compressed, true);
  } catch (error) {
    if (error instanceof RangeError && error.message === "SHARE_PAYLOAD_TOO_LARGE") throw error;
    throw new RangeError("SHARE_PAYLOAD_INVALID");
  }
  const plaintext = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { plaintext.set(chunk, offset); offset += chunk.byteLength; }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext); }
  catch { throw new RangeError("SHARE_PAYLOAD_INVALID"); }
  return decodePracticeShare(text);
}
