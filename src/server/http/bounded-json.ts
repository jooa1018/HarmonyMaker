import "server-only";

export interface BoundedJsonPolicy {
  readonly maxBytes: number;
  readonly invalidCode: string;
  readonly tooLargeCode: string;
}

export async function readBoundedStructuredJson(request: Request, policy: BoundedJsonPolicy): Promise<unknown> {
  if (!Number.isSafeInteger(policy.maxBytes) || policy.maxBytes < 1) throw new RangeError("REQUEST_LIMIT_INVALID");
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^(0|[1-9][0-9]*)$/u.test(contentLength)) throw new RangeError(policy.invalidCode);
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared)) throw new RangeError(policy.invalidCode);
    if (declared > policy.maxBytes) throw new RangeError(policy.tooLargeCode);
  }
  if (!request.body) throw new RangeError(policy.invalidCode);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > policy.maxBytes) {
        await reader.cancel(policy.tooLargeCode).catch(() => undefined);
        throw new RangeError(policy.tooLargeCode);
      }
      chunks.push(Uint8Array.from(value));
    }
  } catch (error) {
    if (error instanceof RangeError && error.message === policy.tooLargeCode) throw error;
    throw new RangeError(policy.invalidCode);
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new RangeError(policy.invalidCode); }
  try { return JSON.parse(text); }
  catch { throw new RangeError(policy.invalidCode); }
}

export async function assertBodylessRequest(request: Request): Promise<void> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && !/^(0|[1-9][0-9]*)$/u.test(contentLength)) throw new RangeError("SESSION_REQUEST_INVALID");
  if (contentLength !== null && Number(contentLength) > 0) throw new RangeError("SESSION_REQUEST_TOO_LARGE");
  if (!request.body) return;
  const reader = request.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value.byteLength > 0) {
        await reader.cancel("SESSION_REQUEST_TOO_LARGE").catch(() => undefined);
        throw new RangeError("SESSION_REQUEST_TOO_LARGE");
      }
    }
  } finally { reader.releaseLock(); }
}

export function hasExactRequestOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost ?? request.headers.get("host")?.trim();
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}
