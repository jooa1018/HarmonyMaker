import { describe, expect, it } from "vitest";

import type { SemanticDigest } from "../../domain/digest/canonical";
import type { SpelledPitch } from "../../domain/pitch";
import { selectLocalHarmonyDecision } from "../../grammar/local-selection";
import {
  EXPERIMENT_FIXTURES,
  LISTENING_COMPARISONS,
  SELECTOR_EXPERIMENT_VARIANTS,
  deterministicBlindSwap,
  fixtureById,
  pitch,
  pitchLabel,
  runExperimentMatrix,
  runExperimentSequence,
} from "./experiment";

const digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as SemanticDigest;

describe("WAG v1.0.2 isolated selector experiment", () => {
  it("keeps V0 semantically equal to the immutable production selector", async () => {
    for (const fixture of EXPERIMENT_FIXTURES) {
      const result = await runExperimentSequence(fixture, "V0_FROZEN");
      let previous: SpelledPitch | undefined;
      let afterRest = false;
      for (let index = 0; index < fixture.decisions.length; index += 1) {
        const input = fixture.decisions[index];
        const trace = result.traces[index];
        if (input.activity === "forced-rest") {
          previous = undefined;
          afterRest = true;
          expect(trace.selectedPitch).toBeNull();
          continue;
        }
        const production = selectLocalHarmonyDecision({
          phraseId: `phrase:${fixture.id}`,
          trackPlanId: `track:${fixture.placementRole}`,
          placementRole: fixture.placementRole,
          sourceLeadAtomizationDigest: digest,
          leadAtomId: `atom:${fixture.id}:${index}`,
          exactRange: {
            start: { performanceMeasureIndex: 0, offset: { n: index, d: 1 } },
            end: { performanceMeasureIndex: 0, offset: { n: index + 1, d: 1 } },
          },
          chordSpanId: input.chordSpanId,
          leadPitch: input.leadPitch,
          trigger: index === 0 ? "LEAD_ATTACK" : "CANONICAL_CHORD_BOUNDARY",
          lyricOnset: index === 0,
          ...(previous ? { previousSoundingPitch: previous } : {}),
          continuityState: index === 0 ? "initial" : afterRest ? "reentry" : "continuous",
        }, input.chord, fixture.performer, fixture.config, input.constraints ?? { restFallback: "permitted" });
        expect(trace.productionStatus, fixture.id).toBe(production.status);
        expect(trace.candidates.map((candidate) => candidate.productionRankTuple), fixture.id)
          .toEqual(production.candidates.map((candidate) => candidate.rankTuple));
        const productionPitch = production.status === "note" ? production.selected.pitch : null;
        expect(trace.selectedPitch, fixture.id).toEqual(productionPitch);
        previous = productionPitch ?? undefined;
        afterRest = productionPitch === null;
      }
    }
  });

  it.each([
    ["hm-v102-e1-hard-only-upper-v0", "E4", "G4"],
    ["hm-v102-e1-hard-only-lower-v0", "E4", "G4"],
    ["hm-v102-e1-hard-only-upper-minor-v0", "C5", "E5"],
    ["hm-v102-e1-hard-only-lower-minor-v0", "C4", "E4"],
  ] as const)("E1 reduces hard-only use for %s", async (fixtureId, frozenPitch, improvedPitch) => {
    const fixture = fixtureById(fixtureId);
    const v0 = await runExperimentSequence(fixture, "V0_FROZEN");
    const v1 = await runExperimentSequence(fixture, "V1_HARD_ONLY_TESSITURA", v0.selectedPitches);
    expect(pitchLabel(v0.selectedPitches[0])).toBe(frozenPitch);
    expect(pitchLabel(v1.selectedPitches[0])).toBe(improvedPitch);
    expect(v0.metrics.hardOnlyRangeDecisionCount).toBe(1);
    expect(v1.metrics.hardOnlyRangeDecisionCount).toBe(0);
    expect(v1.metrics.restCount).toBe(v0.metrics.restCount);
  });

  it.each([
    ["hm-v102-e3-dead-end-upper-v0", ["E4", "rest"]],
    ["hm-v102-e3-dead-end-lower-v0", ["E4", "rest"]],
    ["hm-v102-e3-dead-end-upper-minor-v0", ["C5", "rest"]],
    ["hm-v102-e3-dead-end-lower-minor-v0", ["C5", "rest"]],
  ] as const)("E3 removes the designated immediate dead-end for %s", async (fixtureId, frozen) => {
    const fixture = fixtureById(fixtureId);
    const v0 = await runExperimentSequence(fixture, "V0_FROZEN");
    const v2 = await runExperimentSequence(fixture, "V2_NEXT_FEASIBILITY", v0.selectedPitches);
    expect(v0.selectedPitches.map(pitchLabel)).toEqual(frozen);
    expect(v0.metrics.avoidableMidPhraseRestCount).toBe(0);
    expect(v0.metrics.restCount).toBe(1);
    expect(v2.metrics.restCount).toBe(0);
    expect(v2.selectedPitches.every((selected) => selected !== null)).toBe(true);
    expect(v2.selectedPitches[0]).not.toEqual(v0.selectedPitches[0]);
    expect(v2.traces[0].candidates[0].immediateDeadEndOrdinal).toBe(0);
    expect(v2.traces[0].candidates.some((candidate) => candidate.immediateDeadEndOrdinal === 1)).toBe(true);
  });

  it.each([
    ["hm-v102-e4-reentry-upper-v0", "E4"],
    ["hm-v102-e4-reentry-lower-v0", "E4"],
    ["hm-v102-e4-reentry-upper-minor-v0", "B4"],
    ["hm-v102-e4-reentry-lower-minor-v0", "C4"],
  ] as const)("E4 selects the closer soft re-entry for %s", async (fixtureId, frozenReentry) => {
    const fixture = fixtureById(fixtureId);
    const v0 = await runExperimentSequence(fixture, "V0_FROZEN");
    const v3 = await runExperimentSequence(fixture, "V3_REENTRY_DISTANCE", v0.selectedPitches);
    expect(pitchLabel(v0.selectedPitches[2])).toBe(frozenReentry);
    expect(v3.selectedPitches[2]).not.toBeNull();
    expect(v3.selectedPitches[2]).not.toEqual(v0.selectedPitches[2]);
    expect(v3.selectedPitches[1]).toBeNull();
    expect(v3.metrics.restCount).toBe(v0.metrics.restCount);
    expect(v3.metrics.maximumReentryDistance).toBeLessThan(v0.metrics.maximumReentryDistance);
    expect(v3.metrics.hardRangeViolations).toBe(0);
    expect(v3.metrics.hardLeapViolations).toBe(0);
    expect(v3.metrics.placementViolations).toBe(0);
  });

  it("leaves neutral controls semantically unchanged across all variants", async () => {
    for (const fixtureId of ["hm-v102-neutral-upper-v0", "hm-v102-neutral-lower-v0"]) {
      const fixture = fixtureById(fixtureId);
      const v0 = await runExperimentSequence(fixture, "V0_FROZEN");
      for (const variant of SELECTOR_EXPERIMENT_VARIANTS) {
        const result = await runExperimentSequence(fixture, variant, v0.selectedPitches);
        expect(result.selectedPitches, `${fixtureId}:${variant}`).toEqual(v0.selectedPitches);
        expect(result.metrics.changedPositionsFromV0).toEqual([]);
      }
    }
  });

  it("passes the full automated safety matrix", async () => {
    const matrix = await runExperimentMatrix();
    for (const result of matrix) {
      expect(result.metrics.hardRangeViolations, `${result.fixtureId}:${result.variant}`).toBe(0);
      expect(result.metrics.hardLeapViolations, `${result.fixtureId}:${result.variant}`).toBe(0);
      expect(result.metrics.placementViolations, `${result.fixtureId}:${result.variant}`).toBe(0);
    }
    const byFixture = new Map<string, typeof matrix>();
    for (const fixture of EXPERIMENT_FIXTURES) {
      byFixture.set(fixture.id, matrix.filter((item) => item.fixtureId === fixture.id));
    }
    for (const fixture of EXPERIMENT_FIXTURES.filter((item) => item.feature === "E1")) {
      const values = byFixture.get(fixture.id)!;
      const v0 = values.find((item) => item.variant === "V0_FROZEN")!;
      const v1 = values.find((item) => item.variant === "V1_HARD_ONLY_TESSITURA")!;
      expect(v1.metrics.hardOnlyRangeDecisionCount).toBeLessThanOrEqual(v0.metrics.hardOnlyRangeDecisionCount);
      expect(v1.metrics.restCount).toBe(v0.metrics.restCount);
    }
    for (const fixture of EXPERIMENT_FIXTURES.filter((item) => item.feature === "E3")) {
      const values = byFixture.get(fixture.id)!;
      const v0 = values.find((item) => item.variant === "V0_FROZEN")!;
      const v2 = values.find((item) => item.variant === "V2_NEXT_FEASIBILITY")!;
      expect(v2.metrics.restCount).toBeLessThan(v0.metrics.restCount);
    }
  });

  it("is deterministic across 101 repetitions for every fixture and variant", async () => {
    for (const fixture of EXPERIMENT_FIXTURES) {
      for (const variant of SELECTOR_EXPERIMENT_VARIANTS) {
        const digests = new Set<string>();
        for (let run = 0; run < 101; run += 1) {
          digests.add((await runExperimentSequence(fixture, variant)).semanticDigest);
        }
        expect(digests.size, `${fixture.id}:${variant}`).toBe(1);
      }
    }
  }, 30_000);

  it("pre-registers exactly 18 listening comparisons with stable blind mapping", () => {
    expect(LISTENING_COMPARISONS).toHaveLength(18);
    expect(LISTENING_COMPARISONS.filter((item) => item.feature === "E1")).toHaveLength(5);
    expect(LISTENING_COMPARISONS.filter((item) => item.feature === "E3")).toHaveLength(5);
    expect(LISTENING_COMPARISONS.filter((item) => item.feature === "E4")).toHaveLength(4);
    expect(LISTENING_COMPARISONS.filter((item) => item.feature === "NEUTRAL")).toHaveLength(2);
    for (const item of LISTENING_COMPARISONS) {
      expect(deterministicBlindSwap("fixed-session", item.id)).toBe(deterministicBlindSwap("fixed-session", item.id));
    }
    expect(new Set(LISTENING_COMPARISONS.map((item) => item.id)).size).toBe(18);
  });

  it("does not mutate the frozen production selector inputs or outputs", async () => {
    const fixture = fixtureById("hm-v102-e1-hard-only-upper-v0");
    const before = JSON.stringify(fixture);
    await runExperimentMatrix();
    expect(JSON.stringify(fixture)).toBe(before);
    expect(pitchLabel(pitch("F", 4, 1))).toBe("F#4");
  });
});
