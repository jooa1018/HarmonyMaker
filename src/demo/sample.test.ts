import { describe, expect, it } from "vitest";
import { demoAbc } from "./sample";

function finalMeasure(voice: "S" | "A" | "T"): string {
  const line = demoAbc.split("\n").find(candidate => candidate.startsWith(`[V:${voice}]`));
  if (!line) throw new Error(`Missing ${voice} fixture voice`);
  const measures = line.split("|");
  return measures.at(-2)?.trim() ?? "";
}

function quarterNoteBeats(measure: string): number {
  return Array.from(measure.matchAll(/[=_^]?[A-Ga-g][,']*(\d+)?/g))
    .reduce((total, note) => total + Number(note[1] ?? 1), 0);
}

describe("ABC demo fixture", () => {
  it("renders Soprano, Alto, and Tenor as separate score staves", () => {
    expect(demoAbc).toContain("%%score S A T");
    expect(demoAbc).not.toContain("%%score (S A T)");
  });

  it.each(["S", "A", "T"] as const)("ends voice %s with one 4/4 measure", voice => {
    expect(quarterNoteBeats(finalMeasure(voice))).toBe(4);
  });

  it("uses a final barline for every voice", () => {
    expect(demoAbc.match(/\|\]/g)).toHaveLength(3);
  });
});
