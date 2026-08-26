import "server-only";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function decodeXmlText(value: string): string {
  return value
    .replace(/<[^>]+>/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, "\"")
    .replace(/&apos;/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

function elementTexts(xml: string, name: string): readonly string[] {
  const expression = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "gu");
  return [...xml.matchAll(expression)]
    .map((match) => decodeXmlText(match[1] ?? ""))
    .filter((value) => value.length > 0);
}

/** Temporary Preview-only structural probe. Never returns raw MusicXML or secrets. */
export async function GET(request: Request): Promise<Response> {
  if (process.env.VERCEL_ENV !== "preview") return new Response(null, { status: 404 });
  const jobId = new URL(request.url).searchParams.get("job") ?? "";
  if (!JOB_ID.test(jobId)) return NextResponse.json({ error: "invalid job" }, { status: 400 });
  const baseUrl = process.env.OMR_AUDIVERIS_BASE_URL?.replace(/\/$/u, "");
  const apiKey = process.env.OMR_AUDIVERIS_API_KEY;
  if (!baseUrl || !apiKey) return NextResponse.json({ error: "provider unavailable" }, { status: 503 });

  const response = await fetch(`${baseUrl}/v1/jobs/${encodeURIComponent(jobId)}/result`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  if (!response.ok) return NextResponse.json({ error: `provider ${response.status}` }, { status: 502 });
  const xml = await response.text();
  const words = elementTexts(xml, "words");
  const creditWords = elementTexts(xml, "credit-words");
  const rehearsal = elementTexts(xml, "rehearsal");
  const lyricText = elementTexts(xml, "text");

  return NextResponse.json({
    byteSize: Buffer.byteLength(xml, "utf8"),
    harmonyCount: (xml.match(/<harmony(?:\s|>)/gu) ?? []).length,
    directionWordsCount: words.length,
    directionWords: [...new Set(words)].slice(0, 100),
    creditWords: [...new Set(creditWords)].slice(0, 50),
    rehearsal: [...new Set(rehearsal)].slice(0, 50),
    lyricTextCount: lyricText.length,
  });
}
