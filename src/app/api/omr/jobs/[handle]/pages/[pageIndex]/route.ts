import { type NextRequest, NextResponse } from "next/server";

import { binaryDigest } from "../../../../../../../domain/digest/canonical";
import { CORE_OMR_MAX_PAGE_BYTES } from "../../../../../../../domain/omr/input";
import { mapApiFailure } from "../../../../../../../server/http/api";
import { authorizeOmr, omrHandle } from "../../../../../../../server/http/omr-api";

export const runtime = "nodejs";

export async function PUT(request: NextRequest, context: { readonly params: Promise<{ readonly handle: string; readonly pageIndex: string }> }): Promise<NextResponse> {
  try {
    const { handle, pageIndex: rawPageIndex } = await context.params;
    const pageIndex = Number(rawPageIndex);
    const { application } = await authorizeOmr(request, true);
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || !Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > CORE_OMR_MAX_PAGE_BYTES) throw new RangeError("OMR_PAGE_SIZE_INVALID");
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength !== contentLength) throw new RangeError("OMR_PAGE_SIZE_INVALID");
    const suppliedDigest = request.headers.get("x-page-digest");
    if (suppliedDigest !== await binaryDigest(bytes)) throw new RangeError("OMR_PAGE_DIGEST_MISMATCH");
    const idempotencyKey = request.headers.get("x-idempotency-key");
    const mimeType = request.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase();
    if (!idempotencyKey || (mimeType !== "image/png" && mimeType !== "image/jpeg")) throw new RangeError("OMR_REQUEST_INVALID");
    await application.uploadPage(omrHandle(handle), {
      pageIndex, pageDigest: suppliedDigest as never, mimeType, idempotencyKey,
      bytes: new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeType }),
      warnAcknowledged: request.headers.get("x-quality-warning-acknowledged") === "true",
      duplicateConfirmed: request.headers.get("x-duplicate-page-confirmed") === "true",
    });
    return NextResponse.json({ ok: true });
  } catch (error) { return mapApiFailure(error); }
}

export async function GET(request: NextRequest, context: { readonly params: Promise<{ readonly handle: string; readonly pageIndex: string }> }): Promise<Response> {
  try {
    const { handle, pageIndex: rawPageIndex } = await context.params;
    const pageIndex = Number(rawPageIndex);
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) throw new RangeError("OMR_PAGE_UNAVAILABLE");
    const { application } = await authorizeOmr(request, false);
    const image = await application.getPageImage(omrHandle(handle), pageIndex);
    return new Response(image.bytes.slice().buffer as ArrayBuffer, { headers: { "content-type": image.contentType, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) { return mapApiFailure(error); }
}
