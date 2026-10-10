import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export function createApiRequest(path: string) {
  const requestId = randomUUID();
  const respond = <T extends Response>(response: T): T => {
    response.headers.set("x-request-id", requestId);
    return response;
  };
  return {
    requestId, path, respond,
    json: (body: unknown, init?: ResponseInit) => respond(NextResponse.json(body, init)),
  };
}
export type ApiRequestContext = ReturnType<typeof createApiRequest>;

const safeMessages = new Set([
  "MIGRATION_REQUIRED", "MIGRATION_HISTORY_DIVERGED", "SHARE_ROUNDTRIP_FAILED",
  "AEAD_AUTHENTICATION_FAILED", "AEAD_ENVELOPE_MALFORMED", "AEAD_ENVELOPE_VERSION_UNSUPPORTED",
  "AEAD_KEY_LENGTH_INVALID", "HMAC_KEY_LENGTH_INVALID", "OBJECT_INTEGRITY_FAILED",
]);
/** Arbitrary exception messages can contain SQL values, credentials or share data. */
export function logUnexpectedApiError(error: unknown, context: ApiRequestContext): void {
  const kind = error instanceof RangeError ? "RangeError" : error instanceof TypeError ? "TypeError"
    : error instanceof SyntaxError ? "SyntaxError" : error instanceof Error ? "Error" : "NonError";
  const message = error instanceof Error && safeMessages.has(error.message) ? error.message : "UNEXPECTED_ERROR_MESSAGE_REDACTED";
  // Keep frame order and numeric source positions, never messages, function names,
  // absolute file paths, URLs or arbitrary driver-supplied stack text.
  const stack = error instanceof Error ? (error.stack ?? "").split("\n").slice(1, 21)
    .flatMap(line => { const position = /:(\d{1,8}):(\d{1,8})\)?$/u.exec(line); return position ? [`at [redacted]:${position[1]}:${position[2]}`] : []; }).join("\n") : "";
  console.error(JSON.stringify({ event: "api-unexpected-error", timestamp: new Date().toISOString(), requestId: context.requestId, path: context.path, kind, message, stack }));
}
