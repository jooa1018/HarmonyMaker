import { describe, expect, it } from "vitest";
import { fraction } from "../fraction";
import { COMMON_TIME } from "../meter";
import type { SourceMeasure } from "../source/model";
import { expandRepeats, validatePerformanceSequence } from "./repeat";

function measure(id: string, repeat: SourceMeasure["repeat"]): SourceMeasure {
  return { id, number: Number(id.slice(1)), implicit: false, time: COMMON_TIME, duration: fraction(4), leadEvents: [], chordEvents: [], lyricTokens: [], textEvents: [], repeat };
}

describe("repeat expansion", () => {
  it("treats totalPasses as total plays and assigns stable occurrence identity", () => {
    const measures = [measure("m1", { startRepeat: true }), measure("m2", { startRepeat: false, endRepeat: { totalPasses: 3 } })];
    const result = expandRepeats(measures, "repeat-v1");
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    expect(result.sequence.occurrences.map((item) => item.sourceMeasureId)).toEqual(["m1", "m2", "m1", "m2", "m1", "m2"]);
    expect(result.sequence.occurrences.filter((item) => item.sourceMeasureId === "m1").map((item) => item.occurrenceIndexForSource)).toEqual([0, 1, 2]);
    expect(new Set(result.sequence.occurrences.map((item) => item.occurrenceId)).size).toBe(6);
    expect(validatePerformanceSequence(result.sequence, measures)).toBe(true);
  });

  it("honors first and second endings", () => {
    const measures = [
      measure("m1", { startRepeat: true }),
      measure("m2", { startRepeat: false, endingNumbers: [1] }),
      measure("m3", { startRepeat: false, endingNumbers: [2], endRepeat: { totalPasses: 2 } }),
    ];
    const result = expandRepeats(measures, "repeat-v1");
    expect(result.status === "complete" ? result.sequence.occurrences.map((item) => item.sourceMeasureId) : []).toEqual(["m1", "m2", "m1", "m3"]);
  });

  it("blocks unmatched and nested forward repeats", () => {
    expect(expandRepeats([measure("m1", { startRepeat: true })], "v")).toMatchObject({ status: "blocked", code: "PERFORMANCE_REPEAT_UNMATCHED" });
    expect(expandRepeats([measure("m1", { startRepeat: true }), measure("m2", { startRepeat: true })], "v")).toMatchObject({ status: "blocked", code: "PERFORMANCE_REPEAT_NESTED" });
  });

  it("rejects persisted occurrence time, duration, identity, version, and repeat-order mismatches", () => {
    const measures = [
      measure("m1", { startRepeat: true }),
      measure("m2", { startRepeat: false, endRepeat: { totalPasses: 2 } }),
    ];
    const result = expandRepeats(measures, "repeat-v1");
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    const first = result.sequence.occurrences[0];
    const replaceFirst = (replacement: typeof first) => ({
      ...result.sequence,
      occurrences: [replacement, ...result.sequence.occurrences.slice(1)],
    });
    expect(validatePerformanceSequence(replaceFirst({ ...first, time: { numerator: 3, denominator: 4, beatGroups: [1, 1, 1] } }), measures, "repeat-v1")).toBe(false);
    expect(validatePerformanceSequence(replaceFirst({ ...first, duration: fraction(3) }), measures, "repeat-v1")).toBe(false);
    expect(validatePerformanceSequence(replaceFirst({ ...first, occurrenceId: "pm:forged" }), measures, "repeat-v1")).toBe(false);
    expect(validatePerformanceSequence({ ...result.sequence, occurrences: result.sequence.occurrences.slice(0, -1) }, measures, "repeat-v1")).toBe(false);
    expect(validatePerformanceSequence(result.sequence, measures, "repeat-v2")).toBe(false);
  });
});
