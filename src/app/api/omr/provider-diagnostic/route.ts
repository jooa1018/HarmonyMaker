import "server-only";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`, "u").exec(tag)?.[1];
}

function numberElement(xml: string, name: string): number | undefined {
  const raw = new RegExp(`<${name}>([^<]+)</${name}>`, "u").exec(xml)?.[1];
  const value = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function measureStructure(xml: string): readonly unknown[] {
  const measures: unknown[] = [];
  const expression = /<measure\b([^>]*)>([\s\S]*?)<\/measure>/gu;
  for (const match of xml.matchAll(expression)) {
    const tag = match[1] ?? "";
    const body = match[2] ?? "";
    const noteXs = [...body.matchAll(/<note\b([^>]*)>/gu)]
      .map((note) => Number(attribute(note[1] ?? "", "default-x")))
      .filter(Number.isFinite);
    const noteYs = [...body.matchAll(/<note\b([^>]*)>/gu)]
      .map((note) => Number(attribute(note[1] ?? "", "default-y")))
      .filter(Number.isFinite);
    measures.push({
      number: attribute(tag, "number"),
      width: Number(attribute(tag, "width")),
      newSystem: /<print\b[^>]*\bnew-system="yes"/u.test(body),
      noteCount: (body.match(/<note(?:\s|>)/gu) ?? []).length,
      noteXMin: noteXs.length ? Math.min(...noteXs) : undefined,
      noteXMax: noteXs.length ? Math.max(...noteXs) : undefined,
      noteYMin: noteYs.length ? Math.min(...noteYs) : undefined,
      noteYMax: noteYs.length ? Math.max(...noteYs) : undefined,
      divisions: numberElement(body, "divisions"),
      systemDistance: numberElement(body, "system-distance"),
      topSystemDistance: numberElement(body, "top-system-distance"),
    });
  }
  return measures;
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
    headers: { Authorization: `Bearer ${apiKey}` }, cache: "no-store",
  });
  if (!response.ok) return NextResponse.json({ error: `provider ${response.status}` }, { status: 502 });
  const xml = await response.text();
  return NextResponse.json({
    byteSize: Buffer.byteLength(xml, "utf8"),
    harmonyCount: (xml.match(/<harmony(?:\s|>)/gu) ?? []).length,
    wordsCount: (xml.match(/<words(?:\s|>)/gu) ?? []).length,
    lyricsCount: (xml.match(/<lyric(?:\s|>)/gu) ?? []).length,
    millimeters: numberElement(xml, "millimeters"),
    tenths: numberElement(xml, "tenths"),
    pageHeight: numberElement(xml, "page-height"),
    pageWidth: numberElement(xml, "page-width"),
    measures: measureStructure(xml),
  });
}
