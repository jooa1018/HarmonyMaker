import { describe, expect, it } from "vitest";
import { parseChord } from "../chord/parser";
import { semanticDigest, type SemanticDigest } from "../digest/canonical";
import { fraction } from "../fraction";
import { COMMON_TIME } from "../meter";
import type { PerformanceSequence } from "../performance/repeat";
import type { SourceChordEvent, SourceMeasure } from "../source/model";
import { resolveEffectiveChordTimeline } from "./chord-timeline";

const zeroDigest = "0".repeat(64) as SemanticDigest;
function event(id: string, onset: number, text: string): SourceChordEvent {
  return { id, sourceMeasureId: "m1", onset: fraction(onset), sourceText: text, parseResult: parseChord(text), source: "manual", confirmation: "confirmed" };
}
function measure(chords: readonly SourceChordEvent[]): SourceMeasure {
  return { id: "m1", number: 1, implicit: false, time: COMMON_TIME, duration: fraction(4), leadEvents: [], chordEvents: chords, lyricTokens: [], textEvents: [], repeat: { startRepeat: false } };
}
const performance: PerformanceSequence = { expanderVersion: "repeat-v1", occurrences: [{ occurrenceId: "pm:0:0", sourceMeasureId: "m1", sourceMeasureNumber: 1, occurrenceIndexForSource: 0, performanceIndex: 0, time: COMMON_TIME, duration: fraction(4) }] };
async function resolve(chords: readonly SourceChordEvent[], gapPolicy: "carry-until-next" | "block-gap" = "carry-until-next") {
  return resolveEffectiveChordTimeline({ sourceMeasures: [measure(chords)], performanceSequence: performance, sourceChordProjectionDigest: zeroDigest, performanceSequenceDigest: zeroDigest, policy: { gapPolicy }, resolverVersion: "chord-v1", expectedResolverVersion: "chord-v1" });
}

describe("EffectiveChordTimeline authority", () => {
  it("distinguishes explicit carry provenance", async () => {
    const result = await resolve([event("ch:0", 0, "C"), event("ch:1", 2, "%")]);
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.timeline.spans[1].origin).toMatchObject({ kind: "carried", carrySource: "explicit-carry-token", carryTokenSourceChordEventId: "ch:1" });
  });

  it("uses gap carry provenance without fabricating N.C.", async () => {
    const result = await resolve([event("ch:0", 1, "C")]);
    expect(result.status).toBe("blocked");
    const resolved = await resolve([event("ch:0", 0, "C")]);
    expect(resolved.status === "resolved" ? resolved.timeline.spans.some((span) => span.parseResult.status === "no-chord") : true).toBe(false);
  });

  it("accepts only explicit confirmed N.C.", async () => {
    const result = await resolve([event("ch:0", 0, "N.C.")]);
    expect(result.status === "resolved" ? result.timeline.spans[0].parseResult.status : "blocked").toBe("no-chord");
  });

  it("blocks carry before a previous effective state and block-gap holes", async () => {
    expect(await resolve([event("ch:0", 0, "%")])).toMatchObject({ status: "blocked" });
    expect(await resolve([event("ch:0", 1, "C")], "block-gap")).toMatchObject({ status: "blocked" });
  });

  it("rejects non-Core allow-no-chord at runtime", async () => {
    await expect(resolveEffectiveChordTimeline({ sourceMeasures: [], performanceSequence: { occurrences: [], expanderVersion: "v" }, sourceChordProjectionDigest: zeroDigest, performanceSequenceDigest: zeroDigest, policy: { gapPolicy: "allow-no-chord" } as never, resolverVersion: "v", expectedResolverVersion: "v" })).rejects.toThrow("not a Core gap policy");
  });
});

