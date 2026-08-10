import { NextRequest, NextResponse } from "next/server";
import { buildRc7InternalListeningCorpus } from "../../../../../review/wag-rc7/listening/corpus";
import {
  RC7_COMPLETION_COOKIE,
  RC7_SESSION_COOKIE,
  assertRc7EvaluatorResultComplete,
  createRc7CompletionMaterial,
  decodeRc7SessionCookie,
  encodeRc7CompletionCookie,
} from "../../../../../review/wag-rc7/listening/session";
import type { Rc7EvaluatorResult } from "../../../../../review/wag-rc7/listening/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get(RC7_SESSION_COOKIE)?.value;
    if (!token) return NextResponse.json({ error: "LISTENING_SESSION_REQUIRED" }, { status: 401 });
    const session = decodeRc7SessionCookie(token);
    const result = await request.json() as Rc7EvaluatorResult;
    const corpus = await buildRc7InternalListeningCorpus();
    assertRc7EvaluatorResultComplete(result, corpus, session);
    const response = NextResponse.json({ result }, {
      headers: { "Cache-Control": "no-store" },
    });
    response.cookies.set({
      name: RC7_COMPLETION_COOKIE,
      value: encodeRc7CompletionCookie(createRc7CompletionMaterial(session, result)),
      httpOnly: true,
      sameSite: "strict",
      secure: request.nextUrl.protocol === "https:",
      path: "/review/wag-rc7/listening",
      maxAge: 60 * 60 * 4,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "LISTENING_RESPONSES_INCOMPLETE" }, { status: 400 });
  }
}
