import { describe, expect, it } from "vitest";
import { parseChord } from "../chord/parser";
import type { SemanticDigest } from "../digest/canonical";
import { fraction } from "../fraction";
import { COMMON_TIME } from "../meter";
import type { PerformanceSequence } from "../performance/repeat";
import type { LeadEvent, SourceChordEvent, SourceMeasure } from "../source/model";
import { resolveEffectiveChordTimeline } from "./chord-timeline";

const zeroDigest = "0".repeat(64) as SemanticDigest;
function event(id: string, onset: number, text: string): SourceChordEvent {
  return { id, sourceMeasureId: "m1", onset: fraction(onset), sourceText: text, parseResult: parseChord(text), source: "manual", confirmation: "confirmed" };
}
function note(id: string, onset: number, duration: number): LeadEvent {
  return { kind: "note", id, sourceMeasureId: "m1", onset: fraction(onset), duration: fraction(duration), pitch: { step: "C", alter: 0, octave: 4 }, tieStart: false, tieStop: false, lyricTokenIds: [] };
}
function rest(id: string, onset: number, duration: number): LeadEvent {
  return { kind: "rest", id, sourceMeasureId: "m1", onset: fraction(onset), duration: fraction(duration) };
}
function measure(chords: readonly SourceChordEvent[], leadEvents: readonly LeadEvent[] = [], id = "m1"): SourceMeasure {
  return { id, number: id === "m1" ? 1 : 2, implicit: false, time: COMMON_TIME, duration: fraction(4), leadEvents, chordEvents: chords, lyricTokens: [], textEvents: [], repeat: { startRepeat: false } };
}
const performance: PerformanceSequence = { expanderVersion: "repeat-v1", occurrences: [{ occurrenceId: "pm:0:0", sourceMeasureId: "m1", sourceMeasureNumber: 1, occurrenceIndexForSource: 0, performanceIndex: 0, time: COMMON_TIME, duration: fraction(4) }] };
async function resolve(chords: readonly SourceChordEvent[], gapPolicy: "carry-until-next" | "block-gap" = "carry-until-next", leadEvents: readonly LeadEvent[] = []) {
  return resolveEffectiveChordTimeline({ sourceMeasures: [measure(chords, leadEvents)], performanceSequence: performance, sourceChordProjectionDigest: zeroDigest, performanceSequenceDigest: zeroDigest, policy: { gapPolicy }, resolverVersion: "chord-v1", expectedResolverVersion: "chord-v1" });
}

describe("EffectiveChordTimeline authority", () => {
  it("resolves fractional chord changes in time order without changing canonical ordinals", async () => {
    const chords = [event("ch:0", 0, "C"), { ...event("ch:1", 0, "F"), onset: fraction(1, 2) }, event("ch:2", 1, "G"), { ...event("ch:3", 0, "Am"), onset: fraction(3, 2) }];
    const expected = [fraction(0), fraction(1, 2), fraction(1), fraction(3, 2)];
    const forward = await resolve(chords);
    const reverse = await resolve([...chords].reverse());
    expect(forward.status).toBe("resolved");
    expect(reverse).toEqual(forward);
    if (forward.status !== "resolved") return;
    expect(forward.timeline.spans.map((span) => span.range.start.offset)).toEqual(expected);
    expect(forward.timeline.spans.map((span) => span.range.end)).toEqual([
      ...expected.slice(1).map((offset) => ({ performanceMeasureIndex: 0, offset })),
      { performanceMeasureIndex: 1, offset: fraction(0) },
    ]);
    expect(forward.timeline.spans.map((span) => span.parseResult.status === "ok" ? span.parseResult.chord.canonicalSymbol : null)).toEqual(["C", "F", "G", "Am"]);
  });

  it("still rejects two chords at the same fractional onset", async () => {
    const result = await resolve([event("ch:0", 0, "C"), { ...event("ch:1", 0, "F"), onset: fraction(1, 2) }, { ...event("ch:2", 0, "G"), onset: fraction(1, 2) }]);
    expect(result.status).toBe("blocked");
    expect(result.diagnostics.some((entry) => entry.code === "INPUT_EVENT_OVERLAP")).toBe(true);
  });

  it("distinguishes explicit carry provenance", async () => {
    const result = await resolve([event("ch:0", 0, "C"), event("ch:1", 2, "%")]);
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.timeline.spans[1].origin).toMatchObject({ kind: "carried", carrySource: "explicit-carry-token", carryTokenSourceChordEventId: "ch:1" });
  });

  it("uses gap carry provenance without fabricating N.C.", async () => {
    const result = await resolve([event("ch:0", 1, "C")], "carry-until-next", [note("le:0", 0, 1)]);
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
    expect(await resolve([event("ch:0", 1, "C")], "block-gap", [note("le:0", 0, 1)])).toMatchObject({ status: "blocked" });
  });

  it.each(["carry-until-next", "block-gap"] as const)(
    "allows instrumental and lead-rest gaps with silence under %s",
    async (gapPolicy) => {
      const instrumental = await resolve([], gapPolicy);
      expect(instrumental).toMatchObject({ status: "resolved" });
      if (instrumental.status === "resolved") expect(instrumental.timeline.spans).toEqual([]);
      const leadRest = await resolve([], gapPolicy, [rest("le:rest", 0, 4)]);
      expect(leadRest).toMatchObject({ status: "resolved" });
      if (leadRest.status === "resolved") expect(leadRest.timeline.spans).toEqual([]);
      const intro = await resolve([event("ch:0", 2, "C")], gapPolicy, [rest("le:rest", 0, 2), note("le:note", 2, 2)]);
      expect(intro).toMatchObject({ status: "resolved" });
      if (intro.status === "resolved") expect(intro.timeline.spans[0].range.start.offset).toEqual(fraction(2));
    },
  );

  it.each(["carry-until-next", "block-gap"] as const)(
    "blocks an uncovered sounding lead gap under %s without a previous chord",
    async (gapPolicy) => expect(resolve([], gapPolicy, [note("le:0", 0, 4)])).resolves.toMatchObject({ status: "blocked" }),
  );

  it("carries only the melody-bearing part of a later uncovered measure", async () => {
    const measures = [
      measure([event("ch:0", 0, "C")]),
      measure([], [rest("le:rest", 0, 1), { ...note("le:note", 1, 2), sourceMeasureId: "m2" }], "m2"),
    ];
    const sequence: PerformanceSequence = { expanderVersion: "repeat-v1", occurrences: measures.map((item, index) => ({ occurrenceId: `pm:${index}:0`, sourceMeasureId: item.id, sourceMeasureNumber: item.number, occurrenceIndexForSource: 0, performanceIndex: index, time: COMMON_TIME, duration: fraction(4) })) };
    const result = await resolveEffectiveChordTimeline({ sourceMeasures: measures, performanceSequence: sequence, sourceChordProjectionDigest: zeroDigest, performanceSequenceDigest: zeroDigest, policy: { gapPolicy: "carry-until-next" }, resolverVersion: "chord-v1", expectedResolverVersion: "chord-v1" });
    expect(result).toMatchObject({ status: "resolved" });
    if (result.status !== "resolved") return;
    const carried = result.timeline.spans.find((span) => span.origin.kind === "carried" && span.range.start.performanceMeasureIndex === 1);
    expect(carried?.range).toEqual({ start: { performanceMeasureIndex: 1, offset: fraction(1) }, end: { performanceMeasureIndex: 1, offset: fraction(3) } });
  });

  it("rejects non-Core allow-no-chord at runtime", async () => {
    await expect(resolveEffectiveChordTimeline({ sourceMeasures: [], performanceSequence: { occurrences: [], expanderVersion: "v" }, sourceChordProjectionDigest: zeroDigest, performanceSequenceDigest: zeroDigest, policy: { gapPolicy: "allow-no-chord" } as never, resolverVersion: "v", expectedResolverVersion: "v" })).rejects.toThrow("not a Core gap policy");
  });

  it("resolves explicit carry in expanded performance order on every repeat pass", async () => {
    const repeatedPerformance: PerformanceSequence = { expanderVersion: "repeat-v1", occurrences: [0, 1].map((occurrenceIndexForSource, performanceIndex) => ({ occurrenceId: `pm:${performanceIndex}:0:${occurrenceIndexForSource}`, sourceMeasureId: "m1", sourceMeasureNumber: 1, occurrenceIndexForSource, performanceIndex, time: COMMON_TIME, duration: fraction(4) })) };
    const result = await resolveEffectiveChordTimeline({ sourceMeasures: [measure([event("ch:0", 0, "C"), event("ch:1", 2, "%")])], performanceSequence: repeatedPerformance, sourceChordProjectionDigest: zeroDigest, performanceSequenceDigest: zeroDigest, policy: { gapPolicy: "carry-until-next" }, resolverVersion: "chord-v1", expectedResolverVersion: "chord-v1" });
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.timeline.spans.filter((span) => span.origin.kind === "carried" && span.origin.carrySource === "explicit-carry-token")).toHaveLength(2);
  });
});
