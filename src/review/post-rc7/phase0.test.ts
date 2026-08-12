import { describe, expect, it } from "vitest";
import { fraction } from "../../domain/fraction";
import { pitchRange, type SpelledPitch } from "../../domain/pitch";
import { buildEvidenceRecord } from "./evidence";
import { RIGHTS_SAFE_FIXTURES, RIGHTS_SAFE_FIXTURE_MANIFEST } from "./fixtures";
import { measureArrangement, POST_RC7_METRIC_DEFINITIONS } from "./metrics";
import {
  beginPlayback,
  closePlaybackForContextChange,
  completePlayback,
  invalidatePlayback,
  isListeningScoreEligible,
  type PlaybackAttempt,
} from "./playback-validity";
import { assertRendererClaim, RENDERER_TIERS } from "./renderer";
import type { ResearchArrangement, ResearchNoteEvent } from "./types";

const pitch = (step: SpelledPitch["step"], octave: number): SpelledPitch => ({ step, alter: 0, octave });
const note = (id: string, onset: number, duration: number, value: SpelledPitch): ResearchNoteEvent => ({
  id,
  onsetQ: fraction(onset),
  durationQ: fraction(duration),
  pitch: value,
  syllableId: "syllable:one",
  lyric: "ah",
  lyricOnset: onset === 0,
  attack: onset === 0,
  provenance: "SOURCE_LEAD",
});

describe("post-rc.7 Phase 0 evidence infrastructure", () => {
  it("measures actual sounding pitch, distinguishing unison from harmonic divergence", () => {
    const arrangement: ResearchArrangement = {
      fixtureId: "metric-fixture",
      baselineId: "B1.5-E2E",
      lead: [note("lead", 0, 4, pitch("C", 4))],
      harmony: [note("unison", 0, 1, pitch("C", 4)), note("third-a", 1, 1, pitch("E", 4)), note("third-b", 2, 1, pitch("E", 4))],
    };
    const metrics = measureArrangement(arrangement, {
      hard: pitchRange(pitch("C", 4), pitch("G", 5)),
      comfortable: pitchRange(pitch("D", 4), pitch("E", 5)),
      preferred: pitchRange(pitch("E", 4), pitch("D", 5)),
      preferredLeapSemitones: 5,
      hardLeapSemitones: 12,
    });
    expect(metrics.harmonyParticipation.valueBp).toBe(7500);
    expect(metrics.actualUnison.valueBp).toBe(2500);
    expect(metrics.harmonicDivergence.valueBp).toBe(5000);
    expect(metrics.independentHarmony.valueBp).toBe(5000);
    expect(metrics.exactlyTwoDistinctPitches.valueBp).toBe(5000);
    expect(metrics.independentRuns).toEqual([{ onsetQ: fraction(1), durationQ: fraction(2) }]);
    expect(metrics.meanIndependentRunDurationQ).toEqual(fraction(2));
    expect(metrics.relationDurations).toEqual([{ relation: "UPPER_3", durationQ: fraction(2) }]);
    expect(metrics.oneAttackRunCount).toBe(0);
    expect(metrics.orphanAttackCount).toBe(1);
    expect(POST_RC7_METRIC_DEFINITIONS.actualUnison).toContain("same MIDI pitch");
  });


  it("folds compound generic intervals and preserves exact duration denominators and half-up basis-point rounding", () => {
    const lead = note("lead-compound", 0, 4, pitch("C", 4));
    const harmony = [
      note("tenth", 0, 1, pitch("E", 5)),
      note("thirteenth", 1, 1, pitch("A", 5)),
      note("octave", 2, 1, pitch("C", 5)),
      note("other", 3, 1, pitch("D", 5)),
    ];
    const metrics = measureArrangement({ fixtureId: "compound", baselineId: "B1.5-E2E", lead: [lead], harmony }, {
      hard: pitchRange(pitch("C", 4), pitch("C", 6)),
      comfortable: pitchRange(pitch("E", 5), pitch("A", 5)),
      preferred: pitchRange(pitch("E", 5), pitch("E", 5)),
      preferredLeapSemitones: 12,
      hardLeapSemitones: 24,
    });
    expect(metrics.thirdClassCoverage).toMatchObject({ numerator: fraction(1), denominator: fraction(4), valueBp: 2500 });
    expect(metrics.sixthClassCoverage).toMatchObject({ numerator: fraction(1), denominator: fraction(4), valueBp: 2500 });
    expect(metrics.unisonClassCoverage).toMatchObject({ numerator: fraction(1), denominator: fraction(4), valueBp: 2500 });
    expect(metrics.otherIntervalCoverage).toMatchObject({ numerator: fraction(1), denominator: fraction(4), valueBp: 2500 });
    expect(metrics.comfortableRangeMissCoverage).toMatchObject({ numerator: fraction(2), denominator: fraction(4), valueBp: 5000 });
    expect(metrics.preferredTessituraMissCoverage).toMatchObject({ numerator: fraction(3), denominator: fraction(4), valueBp: 7500 });

    const thirds = measureArrangement({
      fixtureId: "rounding",
      baselineId: "B1.5-E2E",
      lead: [note("lead-rounding", 0, 3, pitch("C", 4))],
      harmony: [note("third-rounding", 0, 1, pitch("E", 4)), note("other-a", 1, 1, pitch("D", 4)), note("other-b", 2, 1, pitch("D", 4))],
    }, {
      hard: pitchRange(pitch("C", 4), pitch("G", 5)),
      comfortable: pitchRange(pitch("C", 4), pitch("G", 5)),
      preferredLeapSemitones: 12,
      hardLeapSemitones: 24,
    });
    expect(thirds.thirdClassCoverage).toMatchObject({ numerator: fraction(1), denominator: fraction(3), valueBp: 3333 });
  });

  it("requires heard-complete playback and excludes invalid attempts from listening scores", () => {
    const running = beginPlayback("2026-08-12T00:00:00.000Z");
    const complete = completePlayback(running, "2026-08-12T00:00:05.000Z");
    const attempts: readonly PlaybackAttempt[] = [
      { id: "lead", fixtureId: "fixture", baselineId: "B0", mix: "LEAD_ONLY", rendererTier: "COMPETENT_PLAIN", validity: complete },
      { id: "harmony", fixtureId: "fixture", baselineId: "B1.5-E2E", mix: "HARMONY_ONLY", rendererTier: "COMPETENT_PLAIN", validity: invalidatePlayback("NO_AUDIO_OUTPUT") },
    ];
    expect(isListeningScoreEligible(attempts, ["lead"])).toBe(true);
    expect(isListeningScoreEligible(attempts, ["lead", "harmony"])).toBe(false);
    expect(closePlaybackForContextChange(running)).toEqual({ status: "invalid", reason: "CONTEXT_CHANGED" });
    expect(closePlaybackForContextChange(complete)).toBe(complete);
    expect(() => completePlayback({ status: "not-started" }, "2026-08-12T00:00:05.000Z")).toThrow("PLAYBACK_NOT_RUNNING");
  });

  it("ships only documented rights-safe fixtures and never treats them as sealed acceptance", () => {
    expect(RIGHTS_SAFE_FIXTURES).toHaveLength(13);
    expect(new Set(RIGHTS_SAFE_FIXTURES.map((fixture) => fixture.id)).size).toBe(13);
    expect(RIGHTS_SAFE_FIXTURE_MANIFEST.every((item) => item.authorshipKind === "PROJECT_ORIGINAL")).toBe(true);
    expect(RIGHTS_SAFE_FIXTURE_MANIFEST.every((item) => item.rightsNote.includes("no user score"))).toBe(true);
    expect(RIGHTS_SAFE_FIXTURE_MANIFEST.every((item) => ["ENGINEERING_ONLY", "DEVELOPMENT_LISTENING"].includes(item.acceptanceEligibility))).toBe(true);
  });

  it("does not establish the renderer beauty ceiling without heard-complete human evidence", () => {
    expect(RENDERER_TIERS.map((entry) => entry.tier)).toEqual(["POOR", "COMPETENT_PLAIN", "HIGH"]);
    expect(RENDERER_TIERS.every((entry) => !entry.beautyCeilingEstablished)).toBe(true);
    expect(() => assertRendererClaim({ ...RENDERER_TIERS[2], beautyCeilingEstablished: true })).toThrow("RENDERER_BEAUTY_CLAIM_REQUIRES_HEARD_COMPLETE");
  });

  it("produces identical semantic evidence digests on repetition", async () => {
    const fixture = RIGHTS_SAFE_FIXTURES[0];
    const arrangement: ResearchArrangement = { fixtureId: fixture.id, baselineId: "B0", lead: fixture.lead, harmony: [] };
    const metrics = measureArrangement(arrangement, {
      hard: fixture.performer.hardRange,
      comfortable: fixture.performer.comfortableRange,
      preferred: fixture.performer.preferredTessitura,
      preferredLeapSemitones: fixture.preferredLeapSemitones,
      hardLeapSemitones: fixture.hardLeapSemitones,
    });
    const first = await buildEvidenceRecord(fixture, arrangement, metrics);
    const second = await buildEvidenceRecord(fixture, arrangement, metrics);
    expect(second).toEqual(first);
    expect(first.evidenceDigest).toMatch(/^[0-9a-f]{64}$/);
  });
});
