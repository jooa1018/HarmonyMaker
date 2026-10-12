import { isChordParseResult, parseChord } from "../../domain/chord/parser";

/** Only new direct input, never stored source data or journal replay. */
export function parseDirectChordInput(text: string): ReturnType<typeof parseChord> {
  const parsed = parseChord(text);
  if (parsed.status !== "ok") return parsed;
  const symbol = parsed.chord.canonicalSymbol;
  if (isChordParseResult(parsed)) return parsed;
  const canonical = parseChord(symbol);
  return canonical.status === "ok" && isChordParseResult(canonical) ? canonical : parsed;
}
