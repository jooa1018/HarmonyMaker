import { isChordParseResult, parseChord } from "../../domain/chord/parser";

/** Only new direct input, never stored source data or journal replay. */
export function parseDirectChordInput(text: string): ReturnType<typeof parseChord> {
  const parsed = parseChord(text);
  if (parsed.status !== "ok" || isChordParseResult(parsed)) return parsed;
  const canonical = parseChord(parsed.chord.canonicalSymbol);
  return canonical.status === "ok" && isChordParseResult(canonical) ? canonical : parsed;
}
