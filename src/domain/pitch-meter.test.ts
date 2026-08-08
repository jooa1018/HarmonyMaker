import { describe, expect, it } from "vitest";
import { COMPOUND_DUPLE, COMMON_TIME, timeSignature } from "./meter";
import { deriveFifths, pitchRange, validateImportedFifths } from "./pitch";

describe("pitch, key, and meter contracts", () => {
  it("derives fifths from tonic and mode", () => {
    const key = { tonic: { step: "D", alter: 0 }, mode: "major" } as const;
    expect(deriveFifths(key)).toBe(2);
    expect(validateImportedFifths(key, 2)).toEqual({ ok: true });
    expect(validateImportedFifths(key, 1)).toEqual({ ok: false, code: "INPUT_KEY_SIGNATURE_INCONSISTENT" });
  });

  it("validates nested pitch ranges", () => {
    expect(pitchRange({ step: "C", alter: 0, octave: 3 }, { step: "G", alter: 0, octave: 4 })).toBeDefined();
    expect(() => pitchRange({ step: "G", alter: 0, octave: 4 }, { step: "C", alter: 0, octave: 3 })).toThrow();
  });

  it("fixes canonical 4/4 and 6/8 beat groups", () => {
    expect(COMMON_TIME.beatGroups).toEqual([1, 1, 1, 1]);
    expect(COMPOUND_DUPLE.beatGroups).toEqual([3, 3]);
    expect(() => timeSignature(6, 8, [2, 2])).toThrow("INPUT_BEAT_GROUPS_INVALID");
  });
});

