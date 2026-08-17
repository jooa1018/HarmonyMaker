import { type NextRequest, NextResponse } from "next/server";

import { mapApiFailure } from "../../../../server/http/api";
import { authorizeOmr, parseCreateJobBody, readBoundedJson } from "../../../../server/http/omr-api";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { record, application } = await authorizeOmr(request, true);
    const body = parseCreateJobBody(await readBoundedJson(request));
    const handle = await application.createJob({ ...body, sessionId: record.id });
    return NextResponse.json({ ok: true, handle }, { status: 201 });
  } catch (error) { return mapApiFailure(error); }
}
