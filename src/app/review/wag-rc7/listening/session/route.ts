import { NextRequest, NextResponse } from "next/server";
import { buildRc7InternalListeningCorpus } from "../../../../../review/wag-rc7/listening/corpus";
import {
  RC7_COMPLETION_COOKIE,
  RC7_SESSION_COOKIE,
  createRc7EvaluatorSessionPayload,
  createRc7SessionMaterial,
  encodeRc7SessionCookie,
} from "../../../../../review/wag-rc7/listening/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const corpus = await buildRc7InternalListeningCorpus();
  const session = createRc7SessionMaterial();
  const response = NextResponse.json(createRc7EvaluatorSessionPayload(corpus, session), {
    headers: { "Cache-Control": "no-store" },
  });
  const secure = request.nextUrl.protocol === "https:";
  response.cookies.set({
    name: RC7_SESSION_COOKIE,
    value: encodeRc7SessionCookie(session),
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/review/wag-rc7/listening",
    maxAge: 60 * 60 * 4,
  });
  response.cookies.set({
    name: RC7_COMPLETION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/review/wag-rc7/listening",
    maxAge: 0,
  });
  return response;
}
