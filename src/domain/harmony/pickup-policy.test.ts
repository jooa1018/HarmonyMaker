import { describe, expect, it } from "vitest";
import { parseChord } from "../chord/parser";
import { canonicalJson, type SemanticDigest } from "../digest/canonical";
import { fraction } from "../fraction";
import { COMMON_TIME } from "../meter";
import { expandRepeats, type PerformanceSequence } from "../performance/repeat";
import type { SourceChordEvent, SourceMeasure } from "../source/model";
import {
  digestEffectiveChordTimeline, resolveEffectiveChordTimeline,
  type ChordResolutionPolicy,
} from "./chord-timeline";

const zeroDigest = "0".repeat(64) as SemanticDigest;
const policy: ChordResolutionPolicy = { gapPolicy: "carry-until-next", initialPickup: "anticipate-first-chord" };
function chord(id: string, sourceMeasureId: string, onset: number, text: string): SourceChordEvent {
  return { id, sourceMeasureId, onset: fraction(onset), sourceText: text, parseResult: parseChord(text), source: "manual", confirmation: "confirmed" };
}
function fixture(): SourceMeasure[] {
  return [
    { id: "m1", number: 1, implicit: true, time: COMMON_TIME, duration: fraction(1, 2),
      leadEvents: (["F", "G"] as const).map((step, index) => ({ kind: "note", id: `le:${index}`, sourceMeasureId: "m1",
        onset: fraction(index, 4), duration: fraction(1, 4), pitch: { step, alter: 0, octave: 3 }, tieStart: false, tieStop: false, lyricTokenIds: [] })),
      chordEvents: [], lyricTokens: [], textEvents: [], repeat: { startRepeat: false } },
    { id: "m2", number: 2, implicit: false, time: COMMON_TIME, duration: fraction(4), leadEvents: [],
      chordEvents: [chord("ch:Bb", "m2", 0, "Bb"), chord("ch:Dm", "m2", 2, "Dm")],
      lyricTokens: [], textEvents: [], repeat: { startRepeat: false } },
  ];
}
function sequence(measures: readonly SourceMeasure[]): PerformanceSequence {
  const result = expandRepeats(measures, "repeat-v1");
  if (result.status !== "complete") throw new Error(result.code);
  return result.sequence;
}
function resolve(measures = fixture(), selectedPolicy: ChordResolutionPolicy = policy, performance = sequence(measures)) {
  return resolveEffectiveChordTimeline({ sourceMeasures: measures, performanceSequence: performance,
    sourceChordProjectionDigest: zeroDigest, performanceSequenceDigest: zeroDigest,
    policy: selectedPolicy, resolverVersion: "chord-v1", expectedResolverVersion: "chord-v1" });
}

describe("explicit initial pickup arrangement policy", () => {
  it.each(["carry-until-next", "block-gap"] as const)("preserves a code-free Source pickup under %s", async gapPolicy => {
    const measures = fixture(), before = canonicalJson(measures);
    const result = await resolve(measures, { ...policy, gapPolicy });
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(canonicalJson(measures)).toBe(before);
    expect(measures[0].chordEvents).toEqual([]);
    expect(result.timeline.spans).toHaveLength(3);
    expect(result.timeline.spans[0]).toMatchObject({
      range: { start: { performanceMeasureIndex: 0, offset: fraction(0) }, end: { performanceMeasureIndex: 1, offset: fraction(0) } },
      parseResult: { status: "ok", chord: { canonicalSymbol: "Bb" } },
      origin: { kind: "arrangement-policy", policy: "anticipate-first-chord", followingSourceChordEventId: "ch:Bb" },
    });
    expect(result.timeline.spans[1].origin).toEqual({ kind: "source-event", sourceChordEventId: "ch:Bb" });
    expect(result.timeline.spans.some(span => span.parseResult.status === "no-chord")).toBe(false);
  });

  it("keeps the default gap blocked and the legacy resolved digest exact", async () => {
    expect(await resolve(fixture(), { gapPolicy: "carry-until-next" })).toMatchObject({ status: "blocked", diagnostics: [{ code: "SOURCE_CHORD_GAP" }] });
    const measures = fixture();
    measures[0] = { ...measures[0], chordEvents: [chord("ch:pickup", "m1", 0, "Bb")] };
    const result = await resolve(measures, { gapPolicy: "carry-until-next" });
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    // Captured from the unmodified 2c594c2 resolver using this public fixture.
    expect(result.timeline.digest).toBe("a67208892c472db4fd3f59e362f69a0c0311043f095d39e19326f253b202131f");
    expect(result.timeline.resolutionPolicy).toEqual({ gapPolicy: "carry-until-next" });
  });

  it.each(["N.C.", "%", "Hbad"])("does not reinterpret following %s as a valid anticipatory chord", async text => {
    const measures = fixture();
    measures[1] = { ...measures[1], chordEvents: [chord("ch:Bb", "m2", 0, text)] };
    expect(await resolve(measures)).toMatchObject({ status: "blocked", diagnostics: [{ details: { issue: "initial-pickup-policy-ineligible", reason: "following-chord-not-confirmed-at-zero" } }] });
  });

  it("does not promote an unconfirmed following chord or infer a missing onset-zero chord", async () => {
    for (const anchor of [
      { ...chord("ch:Bb", "m2", 0, "Bb"), confirmation: "unconfirmed" as const },
      chord("ch:Bb", "m2", 1, "Bb"),
    ]) {
      const measures = fixture(); measures[1] = { ...measures[1], chordEvents: [anchor] };
      expect(await resolve(measures)).toMatchObject({ status: "blocked", diagnostics: [{ details: { reason: "following-chord-not-confirmed-at-zero" } }] });
    }
  });

  it("does not override a printed pickup chord, including explicit N.C.", async () => {
    for (const text of ["N.C.", "Bb"]) {
      const measures = fixture(); measures[0] = { ...measures[0], chordEvents: [chord("ch:pickup", "m1", 0, text)] };
      expect(await resolve(measures)).toMatchObject({ status: "blocked", diagnostics: [{ details: { reason: "pickup-has-explicit-chord" } }] });
    }
  });

  it("requires an actually short implicit measure with valid sounding Lead extent", async () => {
    for (const patch of [{ implicit: false }, { duration: fraction(4) }, { duration: fraction(0) }]) {
      const measures = fixture(); measures[0] = { ...measures[0], ...patch };
      expect(await resolve(measures)).toMatchObject({ status: "blocked", diagnostics: [{ details: { reason: "not-a-short-implicit-pickup" } }] });
    }
    const measures = fixture(); measures[0] = { ...measures[0], leadEvents: [] };
    expect(await resolve(measures)).toMatchObject({ status: "blocked", diagnostics: [{ details: { reason: "invalid-pickup-lead-extent" } }] });
  });

  it("rejects nonadjacent, repeated, or context-substituted pickup occurrences", async () => {
    const measures = fixture(), original = sequence(measures), [first, next] = original.occurrences;
    const performances: Array<{ value: PerformanceSequence; reason: string }> = [
      { value: { ...original, occurrences: [next, first] }, reason: "nonadjacent-initial-measures" },
      { value: { ...original, occurrences: [first, next, { ...first, occurrenceIndexForSource: 1, performanceIndex: 2 }] }, reason: "repeated-pickup-or-anchor" },
      { value: { ...original, occurrences: [{ ...first, duration: fraction(1) }, next] }, reason: "performance-context-mismatch" },
    ];
    for (const { value, reason } of performances) expect(await resolve(measures, policy, value)).toMatchObject({ status: "blocked", diagnostics: [{ details: { reason } }] });
    measures[1] = { ...measures[1], repeat: { startRepeat: true } };
    expect(await resolve(measures, policy, original)).toMatchObject({ status: "blocked", diagnostics: [{ details: { reason: "repeated-pickup-or-anchor" } }] });
  });

  it("never extends the initial exception to an internal block-gap hole", async () => {
    const measures = fixture();
    measures.push({ ...measures[1], id: "m3", number: 3, chordEvents: [], leadEvents: [{
      ...measures[0].leadEvents[0], id: "le:later", sourceMeasureId: "m3", onset: fraction(0), duration: fraction(1),
    }] });
    const result = await resolve(measures, { ...policy, gapPolicy: "block-gap" });
    expect(result).toMatchObject({ status: "blocked", diagnostics: [{ code: "SOURCE_CHORD_GAP", id: "dg:SOURCE_CHORD_GAP:2:0/1:0" }] });
  });

  it("binds both policy and following Source chord provenance into the digest", async () => {
    const measures = fixture(), result = await resolve(measures);
    expect(result.status).toBe("resolved"); if (result.status !== "resolved") return;
    const timeline = result.timeline, first = timeline.spans[0];
    const policyRemoved = { ...timeline, resolutionPolicy: { gapPolicy: "carry-until-next" as const } };
    expect(await digestEffectiveChordTimeline(policyRemoved, measures)).not.toBe(timeline.digest);
    const originSubstituted = { ...timeline, spans: [{ ...first, origin: { kind: "arrangement-policy" as const, policy: "anticipate-first-chord" as const, followingSourceChordEventId: "ch:Dm" } }, ...timeline.spans.slice(1)] };
    expect(await digestEffectiveChordTimeline(originSubstituted, measures)).not.toBe(timeline.digest);
    const missing = { ...timeline, spans: [{ ...first, origin: { kind: "arrangement-policy" as const, policy: "anticipate-first-chord" as const, followingSourceChordEventId: "ch:missing" } }, ...timeline.spans.slice(1)] };
    await expect(digestEffectiveChordTimeline(missing, measures)).rejects.toThrow("missing canonical source chord ordinal");
  });

  it("rejects unknown policy values instead of treating them as no opt-in", async () => {
    await expect(resolve(fixture(), { ...policy, initialPickup: "anything" } as never)).rejects.toThrow("unsupported initial pickup policy");
  });
});
