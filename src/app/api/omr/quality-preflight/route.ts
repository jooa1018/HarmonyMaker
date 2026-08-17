import { type NextRequest, NextResponse } from "next/server";

import { binaryDigest } from "../../../../domain/digest/canonical";
import { CORE_OMR_MAX_PAGE_BYTES } from "../../../../domain/omr/input";
import { mapApiFailure } from "../../../../server/http/api";
import { authorizeOmr } from "../../../../server/http/omr-api";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { application } = await authorizeOmr(request, true);
    const mimeType = request.headers.get("content-type");
    if (mimeType !== "image/png" && mimeType !== "image/jpeg") throw new RangeError("OMR_INPUT_FORMAT_UNSUPPORTED");
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > CORE_OMR_MAX_PAGE_BYTES) throw new RangeError("OMR_PAGE_SIZE_INVALID");
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength < 1 || bytes.byteLength > CORE_OMR_MAX_PAGE_BYTES) throw new RangeError("OMR_PAGE_SIZE_INVALID");
    const declaredDigest = request.headers.get("x-page-digest");
    const digest = await binaryDigest(bytes);
    if (declaredDigest !== digest) throw new RangeError("OMR_PAGE_DIGEST_MISMATCH");
    const inspection = await application.preflightPage({ pageIndex: 0, pageDigest: digest, mimeType, bytes: new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeType }) });
    return NextResponse.json({ ok: true, inspection });
  } catch (error) { return mapApiFailure(error); }
}
