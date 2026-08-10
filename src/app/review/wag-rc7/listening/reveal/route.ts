import { NextRequest, NextResponse } from "next/server";
import { buildRc7InternalListeningCorpus } from "../../../../../review/wag-rc7/listening/corpus";
import {
  RC7_COMPLETION_COOKIE,
  RC7_SESSION_COOKIE,
  createRc7RevealArtifact,
  decodeRc7CompletionCookie,
  decodeRc7SessionCookie,
} from "../../../../../review/wag-rc7/listening/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const sessionToken = request.cookies.get(RC7_SESSION_COOKIE)?.value;
    const completionToken = request.cookies.get(RC7_COMPLETION_COOKIE)?.value;
    if (!sessionToken || !completionToken) {
      return NextResponse.json({ error: "LISTENING_COMPLETION_REQUIRED" }, { status: 403 });
    }
    const session = decodeRc7SessionCookie(sessionToken);
    const completion = decodeRc7CompletionCookie(completionToken);
    const corpus = await buildRc7InternalListeningCorpus();
    return NextResponse.json(createRc7RevealArtifact(corpus, session, completion), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "LISTENING_COMPLETION_REQUIRED" }, { status: 403 });
  }
}
