import { describe, expect, it } from "vitest";

import type { ParsedChord } from "../domain/chord/model";
import { parseChord } from "../domain/chord/parser";
import type { EffectiveArrangementConfig } from "../domain/config";
import type { SemanticDigest } from "../domain/digest/canonical";
import type { PerformerProfile, VocalPlacementRole } from "../domain/performer";
import { pitchMidiNumber, type SpelledPitch } from "../domain/pitch";
import { extendedBasisPoints } from "../domain/rates";
import {
  realizeSourceChordTone,
  selectLocalHarmonyDecision,
  type LocalHarmonyDecisionContext,
  type LocalSelectionConstraints,
} from "./local-selection";

const digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as SemanticDigest;
const p = (step: SpelledPitch["step"], octave: number, alter: SpelledPitch["alter"] = 0): SpelledPitch => ({ step, alter, octave });

function chord(symbol: string): ParsedChord {
  const result = parseChord(symbol);
  if (result.status !== "ok") throw new Error(`test chord failed to parse: ${symbol}`);
  return result.chord;
}

function performer(
  hardLow: SpelledPitch,
  hardHigh: SpelledPitch,
  options: { readonly comfortable?: readonly [SpelledPitch, SpelledPitch]; readonly preferred?: readonly [SpelledPitch, SpelledPitch]; readonly displayName?: string } = {},
): PerformerProfile {
  const comfortable = options.comfortable ?? [hardLow, hardHigh];
  return {
    id: "performer:test",
    displayName: options.displayName ?? "Singer",
    hardRange: { low: hardLow, high: hardHigh },
    comfortableRange: { low: comfortable[0], high: comfortable[1] },
    ...(options.preferred ? { preferredTessitura: { low: options.preferred[0], high: options.preferred[1] } } : {}),
  };
}

function config(overrides: Partial<EffectiveArrangementConfig> = {}): EffectiveArrangementConfig {
  return {
    presetId: "standard",
    maxActiveVoiceCount: 3,
    maxHarmonyAttackRatioBp: extendedBasisPoints(20000),
    preferredMaxLeapSemitones: 5,
    hardMaxLeapSemitones: 12,
    allowSuspension: false,
    allowColorTones: true,
    allowOctaveDouble: false,
    rhythmicComplexity: 0,
    maxRoleChangesPerSection: 1,
    maxSustainPrimaryPulses: 4,
    mode: { profileId: "worship-band-v1", harmonicContext: "band-supported" },
    presetProfileVersion: "preset-profile-v2-b15-v0",
    presetProfileDigest: digest,
    maxHarmonyTracks: 2,
    digest,
    ...overrides,
  };
}

function context(
  role: VocalPlacementRole,
  leadPitch: SpelledPitch,
  options: Partial<LocalHarmonyDecisionContext> = {},
): LocalHarmonyDecisionContext {
  return {
    phraseId: "phrase:1",
    trackPlanId: role === "upper" ? "track:h1" : "track:h2",
    placementRole: role,
    sourceLeadAtomizationDigest: digest,
    leadAtomId: "atom:1",
    exactRange: {
      start: { performanceMeasureIndex: 0, offset: { n: 0, d: 1 } },
      end: { performanceMeasureIndex: 0, offset: { n: 1, d: 1 } },
    },
    chordSpanId: "chord-span:1",
    leadPitch,
    trigger: "LEAD_ATTACK",
    lyricOnset: true,
    continuityState: "initial",
    ...options,
  };
}

function noteResult(
  ctx: LocalHarmonyDecisionContext,
  sourceChord: ParsedChord,
  singer: PerformerProfile,
  effectiveConfig: EffectiveArrangementConfig = config(),
  constraints?: LocalSelectionConstraints,
) {
  const result = selectLocalHarmonyDecision(ctx, sourceChord, singer, effectiveConfig, constraints);
  expect(result.status).toBe("note");
  if (result.status !== "note") throw new Error("expected note result");
  return result;
}

describe("frozen source chord-tone spelling", () => {
  it.each([
    ["B", 3, "D", 1], ["B", 5, "F", 1],
    ["Eb", 3, "G", 0], ["Eb", 5, "B", -1],
    ["Am", 3, "C", 0], ["Bbm", 3, "D", -1],
    ["F#m", 3, "A", 0], ["Ebm", 3, "G", -1],
    ["Ebsus4", 4, "A", -1], ["Db7#11", 11, "G", 0],
  ] as const)("realizes %s degree %i without enharmonic replacement", (symbol, degree, step, alter) => {
    const sourceChord = chord(symbol);
    const tone = sourceChord.tones.find((candidate) => candidate.degree === degree);
    expect(tone).toBeDefined();
    expect(realizeSourceChordTone(sourceChord.root, tone!)).toEqual({ step, alter });
  });

  it("excludes an unrepresentable altered tone and continues with representable siblings", () => {
    const sourceChord = chord("B#7#9");
    const result = noteResult(context("upper", p("C", 4)), sourceChord, performer(p("C", 4, 1), p("C", 6)));
    expect(result.sourceToneExclusions).toEqual([{
      tone: expect.objectContaining({ degree: 9, alteration: 1 }),
      reason: "SOURCE_CHORD_TONE_SPELLING_UNREPRESENTABLE",
    }]);
    expect(result.candidates.every(({ tone }) => tone.degree !== 9)).toBe(true);
  });

  it("returns honest hard-impossibility when every exact spelling is unrepresentable", () => {
    const sourceChord: ParsedChord = {
      root: { step: "C", alter: 2 },
      tones: [{ degree: 1, alteration: 2, role: "root", origin: "alteration" }],
      omissions: [],
      canonicalSymbol: "trace-only",
    };
    const result = selectLocalHarmonyDecision(
      context("upper", p("C", 4)),
      sourceChord,
      performer(p("C", 4), p("C", 6)),
      config(),
    );
    expect(result).toMatchObject({ status: "rest", reason: "LOCAL_REST_HARD_IMPOSSIBILITY" });
    expect(result.sourceToneExclusions).toHaveLength(1);
  });
});

describe("frozen source chord semantics", () => {
  it("does not restore sus/omitted thirds", () => {
    expect(chord("Ebsus4").tones.map(({ degree }) => degree)).not.toContain(3);
    expect(chord("Cno3").tones.map(({ degree }) => degree)).not.toContain(3);
    expect(chord("Ebsus4").tones).toContainEqual(expect.objectContaining({ degree: 4, role: "suspension" }));
  });

  it("retains extensions, additions, and alterations as exact source tones", () => {
    expect(chord("Cmaj9").tones).toContainEqual(expect.objectContaining({ degree: 9, origin: "extension" }));
    expect(chord("Cadd9").tones).toContainEqual(expect.objectContaining({ degree: 9, origin: "addition" }));
    expect(chord("C7b9").tones).toContainEqual(expect.objectContaining({ degree: 9, alteration: -1, origin: "alteration" }));
  });

  it("does not invent slash bass as a vocal tone", () => {
    const sourceChord = chord("C/Bb");
    const result = noteResult(context("upper", p("C", 4)), sourceChord, performer(p("D", 4), p("C", 6)));
    expect(sourceChord.bass).toEqual({ step: "B", alter: -1 });
    expect(result.candidates.some(({ pitch }) => pitch.step === "B" && pitch.alter === -1)).toBe(false);
  });

  it("keeps explicit N.C. outside the ParsedChord selection boundary", () => {
    expect(parseChord("N.C.")).toEqual({ status: "no-chord", sourceText: "N.C." });
  });
});

describe("frozen local selector", () => {
  it("uses the Lead chord-tone branch and exact chord-aware 3rd/6th tuple", () => {
    const result = noteResult(
      context("upper", p("C", 4)),
      chord("C"),
      performer(p("E", 4), p("E", 5)),
    );
    expect(result.leadIsSourceChordTone).toBe(true);
    expect(result.selected).toEqual(expect.objectContaining({
      family: "CHORD_AWARE_THIRD_SIXTH",
      pitch: p("E", 4),
      rankTuple: [0, 0, 0, 0, 0, 0, 0, 1, 64, 64, 2, 0, 4],
    }));
  });

  it("prefers legal continuation for a Lead Source-NCT", () => {
    const result = noteResult(
      context("upper", p("D", 4), { previousSoundingPitch: p("G", 4), continuityState: "continuous" }),
      chord("C"),
      performer(p("E", 4), p("C", 6)),
    );
    expect(result.leadIsSourceChordTone).toBe(false);
    expect(result.selected).toMatchObject({ family: "LEGAL_CONTINUATION", pitch: p("G", 4) });
  });

  it("uses low motion before generic 3rd/6th in the Source-NCT hierarchy", () => {
    const result = noteResult(
      context("upper", p("D", 4), { previousSoundingPitch: p("F", 4, 1), continuityState: "continuous" }),
      chord("C"),
      performer(p("E", 4), p("C", 6)),
    );
    expect(result.selected.family).toBe("LOW_MOTION_CHORD_TONE");
    expect(Math.abs(pitchMidiNumber(result.selected.pitch) - pitchMidiNumber(p("F", 4, 1)))).toBeLessThanOrEqual(2);
  });

  it("prefers chord-aware 3rd/6th over contextual tones when higher NCT families do not apply", () => {
    const result = noteResult(
      context("upper", p("B", 3), { previousSoundingPitch: p("C", 2), continuityState: "continuous" }),
      chord("C"),
      performer(p("C", 4), p("C", 6)),
      config({ hardMaxLeapSemitones: 40 }),
    );
    expect(result.selected).toMatchObject({ family: "CHORD_AWARE_THIRD_SIXTH", pitch: p("G", 4) });
  });

  it("falls back to a contextual exact source tone", () => {
    const result = noteResult(
      context("upper", p("D", 4), { previousSoundingPitch: p("C", 3), continuityState: "continuous" }),
      chord("C"),
      performer(p("E", 4), p("B", 4)),
      config({ hardMaxLeapSemitones: 24 }),
    );
    expect(result.selected.family).toBe("CONTEXTUAL_CHORD_TONE");
  });

  it("applies hardRange and strict collision/crossing placement", () => {
    const upper = selectLocalHarmonyDecision(
      context("upper", p("C", 4)), chord("C"), performer(p("C", 3), p("D", 4)), config(),
    );
    expect(upper.status).toBe("rest");
    const result = noteResult(
      context("upper", p("C", 4)), chord("C"), performer(p("C", 4), p("G", 4)), config(),
      { restFallback: "permitted", collisionPitches: [p("E", 4)] },
    );
    expect(result.candidates.every(({ pitch }) => pitchMidiNumber(pitch) > 60)).toBe(true);
    expect(result.candidates.some(({ pitch }) => pitchMidiNumber(pitch) === 64)).toBe(false);
  });

  it("applies exact current-stage pitch locks before ranking", () => {
    const result = noteResult(
      context("upper", p("C", 4)), chord("C"), performer(p("E", 4), p("G", 4)), config(),
      { restFallback: "forbidden", allowedPitches: [p("G", 4)] },
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.selected.pitch).toEqual(p("G", 4));
  });

  it("deduplicates repeated semantic source-tone candidates", () => {
    const parsed = chord("C");
    const duplicated: ParsedChord = { ...parsed, tones: [parsed.tones[0], ...parsed.tones] };
    const result = noteResult(context("upper", p("C", 4)), duplicated, performer(p("E", 4), p("G", 4)));
    const keys = result.candidates.map(({ tone, pitch }) => `${tone.degree}:${tone.alteration}:${pitch.step}:${pitch.alter}:${pitch.octave}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses preferred tessitura within the same frozen family", () => {
    const result = noteResult(
      context("upper", p("C", 4)),
      chord("Cadd6"),
      performer(p("E", 4), p("C", 5), {
        comfortable: [p("E", 4), p("B", 4)],
        preferred: [p("A", 4), p("B", 4)],
      }),
    );
    expect(result.selected).toMatchObject({ family: "CHORD_AWARE_THIRD_SIXTH", pitch: p("A", 4) });
  });

  it("treats preferred leap as soft but hard leap as pruning", () => {
    const soft = noteResult(
      context("upper", p("C", 4), { previousSoundingPitch: p("E", 5), continuityState: "continuous" }),
      chord("C"),
      performer(p("E", 4), p("E", 5)),
      config({ preferredMaxLeapSemitones: 5, hardMaxLeapSemitones: 12 }),
    );
    expect(soft.selected.pitch).toEqual(p("E", 5));
    expect(soft.candidates.some(({ pitch, rankTuple }) => pitch.octave === 4 && rankTuple[3] === 1)).toBe(true);

    const hard = selectLocalHarmonyDecision(
      context("upper", p("C", 4), { previousSoundingPitch: p("C", 6), continuityState: "continuous" }),
      chord("C"), performer(p("E", 4), p("G", 4)), config({ hardMaxLeapSemitones: 2 }),
    );
    expect(hard.status).toBe("rest");
  });

  it("applies direct Upper and Lower selectors with their own performers", () => {
    const upper = noteResult(context("upper", p("C", 4)), chord("C"), performer(p("D", 4), p("C", 6)));
    const lower = noteResult(context("lower", p("C", 4)), chord("C"), performer(p("C", 2), p("B", 3)));
    expect(upper.selected.pitch).toEqual(p("E", 4));
    expect(lower.selected).toEqual(expect.objectContaining({
      pitch: p("E", 3),
      rankTuple: [0, 0, 0, 0, 0, 0, 0, 1, -52, 52, 2, 0, 3],
    }));
  });

  it("uses zero motion on first/reentry decisions and continuity motion otherwise", () => {
    const singer = performer(p("E", 4), p("E", 5));
    const initial = noteResult(context("upper", p("C", 4)), chord("C"), singer);
    const continuous = noteResult(
      context("upper", p("C", 4), { previousSoundingPitch: p("D", 4), continuityState: "continuous" }),
      chord("C"), singer,
    );
    const reentry = noteResult(
      context("upper", p("C", 4), { previousSoundingPitch: p("C", 7), continuityState: "reentry" }),
      chord("C"), singer, config({ hardMaxLeapSemitones: 1 }),
    );
    expect(initial.selected.rankTuple[6]).toBe(0);
    expect(continuous.selected.rankTuple[6]).toBe(2);
    expect(reentry.selected.rankTuple[6]).toBe(0);
  });

  it("selects rest only on hard impossibility and blocks when rest is forbidden", () => {
    const args = [
      context("upper", p("C", 4)), chord("C"), performer(p("C", 3), p("D", 4)), config(),
    ] as const;
    expect(selectLocalHarmonyDecision(...args)).toMatchObject({
      status: "rest", reason: "LOCAL_REST_HARD_IMPOSSIBILITY", candidates: [],
    });
    expect(selectLocalHarmonyDecision(...args, { restFallback: "forbidden" })).toMatchObject({
      status: "blocked", code: "GEN_NO_PITCH_CANDIDATE", candidates: [],
    });
  });

  it("retains a source color tone when color is disabled if it is the only legal pitch", () => {
    const sourceChord = chord("Cadd9");
    const result = noteResult(
      context("upper", p("C", 4)), sourceChord, performer(p("D", 5), p("D", 5)),
      config({ allowColorTones: false }),
    );
    expect(result.selected).toMatchObject({ tone: { role: "color" }, pitch: p("D", 5) });
    expect(result.selected.rankTuple[1]).toBe(1);
  });
});

describe("local-selector determinism", () => {
  it("is independent of tone input order and display-only names/symbols", () => {
    const parsed = chord("Cmaj9");
    const shuffled: ParsedChord = {
      ...parsed,
      tones: [...parsed.tones].reverse(),
      canonicalSymbol: "display-only-change",
    };
    const ctx = context("upper", p("C", 4));
    const left = selectLocalHarmonyDecision(ctx, parsed, performer(p("D", 4), p("C", 6), { displayName: "Alpha" }), config());
    const right = selectLocalHarmonyDecision(ctx, shuffled, performer(p("D", 4), p("C", 6), { displayName: "Zeta" }), config());
    expect(right).toEqual(left);
  });

  it("uses a complete canonical pitch tie-break and returns identical repeated results", () => {
    const args = [
      context("upper", p("C", 4)), chord("Cmaj9"), performer(p("D", 4), p("C", 6)), config(),
    ] as const;
    const expected = selectLocalHarmonyDecision(...args);
    for (let iteration = 0; iteration < 10; iteration += 1) {
      expect(selectLocalHarmonyDecision(...args)).toEqual(expected);
    }
    if (expected.status !== "note") throw new Error("expected note result");
    expect(expected.candidates.map(({ rankTuple }) => rankTuple))
      .toEqual([...expected.candidates].sort((a, b) => {
        const length = Math.max(a.rankTuple.length, b.rankTuple.length);
        for (let index = 0; index < length; index += 1) {
          if (a.rankTuple[index] !== b.rankTuple[index]) return a.rankTuple[index] - b.rankTuple[index];
        }
        return 0;
      }).map(({ rankTuple }) => rankTuple));
  });
});
