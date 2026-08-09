import { describe, expect, it } from "vitest";
import { chordSemanticProjection, isChordParseResult, isParsedChord, parseChord } from "./parser";

function parsed(symbol: string) {
  const result = parseChord(symbol);
  if (result.status !== "ok") throw new Error(`expected chord: ${symbol}`);
  return result.chord;
}

function tonePairs(symbol: string): readonly string[] {
  return parsed(symbol).tones.map((tone) => `${tone.alteration}:${tone.degree}`);
}

describe("worship-leadsheet-v1 chord parser", () => {
  it.each([
    ["C7", ["0:1", "0:3", "0:5", "-1:7"]],
    ["Cmaj7", ["0:1", "0:3", "0:5", "0:7"]],
    ["Cm7", ["0:1", "-1:3", "0:5", "-1:7"]],
    ["CmMaj7", ["0:1", "-1:3", "0:5", "0:7"]],
    ["Cdim7", ["0:1", "-1:3", "-1:5", "-2:7"]],
    ["Cm7b5", ["0:1", "-1:3", "-1:5", "-1:7"]],
  ])("derives distinct tones for %s", (symbol, expected) => expect(tonePairs(symbol)).toEqual(expected));

  it.each([
    ["CM7", "Cmaj7"], ["CΔ7", "Cmaj7"], ["CΔ9", "Cmaj9"], ["C-7", "Cm7"],
    ["Cø", "Cm7b5"], ["Cø7", "Cm7b5"], ["C°", "Cdim"], ["C°7", "Cdim7"],
    ["Csus", "Csus4"], ["C2", "Cadd2"], ["C6/9", "C6/9"], ["C6/9/E", "C6/9/E"],
  ])("normalizes %s using longest-token-first lexing", (source, canonical) => {
    expect(parsed(source).canonicalSymbol).toBe(canonical);
  });

  it("distinguishes no-chord, carry, and parse failure", () => {
    expect(parseChord("n.c.")).toEqual({ status: "no-chord", sourceText: "n.c." });
    expect(parseChord("%")).toEqual({ status: "carry", sourceText: "%" });
    expect(parseChord("Crocket")).toMatchObject({ status: "failed", sourceText: "Crocket", errorCode: "UNSUPPORTED_TOKEN" });
  });

  it("rejects unsupported or conflicting combinations", () => {
    expect(parseChord("Cmsus4")).toMatchObject({ status: "failed", errorCode: "TOKEN_CONFLICT" });
    expect(parseChord("Cdim9")).toMatchObject({ status: "failed", errorCode: "TOKEN_CONFLICT" });
    expect(parseChord("Csus2sus4")).toMatchObject({ status: "failed", errorCode: "TOKEN_CONFLICT" });
  });

  it.each(["C77", "Cmaj7maj7", "C6/96/9", "Cmm", "Csus4sus4"])(
    "rejects duplicate semantic tokens in %s",
    (symbol) => expect(parseChord(symbol)).toMatchObject({
      status: "failed",
      errorCode: "TOKEN_CONFLICT",
    }),
  );

  it("rejects duplicate additions, omissions, and alterations", () => {
    for (const symbol of ["Cadd9add9", "Cno3no3", "C(b5b5)"]) {
      expect(parseChord(symbol)).toMatchObject({ status: "failed", errorCode: "TOKEN_CONFLICT" });
    }
  });

  it.each(["C()", "C(,)", "C(add9,)", "C(,add9)", "C(add9,,b5)"])(
    "rejects malformed parenthesized modifier grammar in %s",
    (symbol) => expect(parseChord(symbol)).toMatchObject({
      status: "failed",
      errorCode: "INVALID_TOKEN_ORDER",
    }),
  );

  it("requires persisted ParsedChord canonicalSymbol to be exactly canonical", () => {
    const chord = parsed("Cmaj7");
    expect(isParsedChord(chord)).toBe(true);
    expect(isParsedChord({ ...chord, canonicalSymbol: "CM7" })).toBe(false);
  });

  it("keeps aliases out of semantic chord projection", () => {
    expect(chordSemanticProjection(parsed("CM7"))).toEqual(chordSemanticProjection(parsed("CΔ7")));
  });

  it("runtime-rejects impossible parse-result discriminants", () => {
    expect(isChordParseResult(parseChord("C7"))).toBe(true);
    expect(isChordParseResult({ status: "ok", sourceText: "C7" })).toBe(false);
    expect(isChordParseResult({ status: "failed", sourceText: "bad", errorCode: "MADE_UP" })).toBe(false);
    expect(isChordParseResult({ status: "ok", chord: { root: {}, tones: [], omissions: [], canonicalSymbol: "C" } })).toBe(false);
    expect(isChordParseResult({ ...parseChord("C7"), forbidden: true })).toBe(false);
  });
});
