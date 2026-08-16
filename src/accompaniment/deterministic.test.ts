import { describe, expect, it } from "vitest";

import { fraction } from "../domain/fraction";
import { createWagFixtureInput } from "../grammar/fixtures";
import { ACCOMPANIMENT_CONFIG_DIGEST, generateDeterministicAccompaniment, loadAccompanimentConfig } from "./deterministic";

describe("deterministic accompaniment-v1", () => {
  it("uses the exact same EffectiveChordTimeline digest and is byte deterministic", async () => {
    const input = await createWagFixtureInput({ fixtureId: "hm-segment-b-accompaniment-parity-v0" });
    const [left, right] = await Promise.all([
      generateDeterministicAccompaniment(input.effectiveChordTimeline),
      generateDeterministicAccompaniment(input.effectiveChordTimeline),
    ]);
    expect(left.effectiveChordTimelineDigest).toBe(input.effectiveChordTimeline.digest);
    expect(JSON.stringify(right)).toBe(JSON.stringify(left));
    expect(left.spans.every((span) => span.velocity === 72)).toBe(true);
  });

  it("renders N.C. as exact silence", async () => {
    const input = await createWagFixtureInput({
      fixtureId: "hm-segment-b-accompaniment-nc-v0",
      chords: [{ onset: fraction(0), symbol: "N.C." }],
    });
    const result = await generateDeterministicAccompaniment(input.effectiveChordTimeline);
    expect(result.spans).toEqual([]);
  });

  it("uses slash bass while keeping pad tones within Source chord semantics", async () => {
    const input = await createWagFixtureInput({
      fixtureId: "hm-original-slash-chord-v0",
      chords: [{ onset: fraction(0), symbol: "C/E" }],
    });
    const result = await generateDeterministicAccompaniment(input.effectiveChordTimeline);
    expect(result.spans[0].bassPitch).toEqual({ step: "E", alter: 0, octave: 2 });
    expect(result.spans[0].padPitches.map((pitch) => `${pitch.step}${pitch.alter}`)).toEqual(["C0", "E0", "G0"]);
  });

  it("does not restore an omitted third and preserves suspension/seventh semantics", async () => {
    const [noThirdInput, susInput] = await Promise.all([
      createWagFixtureInput({ chords: [{ onset: fraction(0), symbol: "Cno3" }] }),
      createWagFixtureInput({ chords: [{ onset: fraction(0), symbol: "C7sus4" }] }),
    ]);
    const [noThird, sus] = await Promise.all([
      generateDeterministicAccompaniment(noThirdInput.effectiveChordTimeline),
      generateDeterministicAccompaniment(susInput.effectiveChordTimeline),
    ]);
    expect(noThird.spans[0].padPitches.some((pitch) => pitch.step === "E" && pitch.alter === 0)).toBe(false);
    expect(sus.spans[0].padPitches).toEqual(expect.arrayContaining([
      expect.objectContaining({ step: "F", alter: 0 }),
      expect.objectContaining({ step: "B", alter: -1 }),
    ]));
    expect(sus.spans[0].padPitches.some((pitch) => pitch.step === "E" && pitch.alter === 0)).toBe(false);
  });

  it("binds voicing, register, velocity, asset, and normalization to one config digest", async () => {
    const config = await loadAccompanimentConfig();
    expect(config).toMatchObject({
      version: "accompaniment-v1",
      padMaxTones: 7,
      bassOctave: 2,
      velocity: 72,
      soundAssetVersion: "hm-band-pad-bass-v1",
      normalizationVersion: "fixed-velocity-normalization-v1",
    });
    expect(config.configDigest).toBe(ACCOMPANIMENT_CONFIG_DIGEST);
  });
});
