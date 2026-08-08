import { describe, expect, it } from "vitest";
import { integrateTextureDensity } from "./density";
import { fraction } from "./fraction";
import { musicalRange } from "./time";

describe("exact atomic interval density integration", () => {
  it("uses exact Fraction duration and distinguishes unison from divergence", () => {
    const whole = musicalRange({ performanceMeasureIndex: 0, offset: fraction(0) }, { performanceMeasureIndex: 1, offset: fraction(0) });
    const half = musicalRange({ performanceMeasureIndex: 0, offset: fraction(0) }, { performanceMeasureIndex: 0, offset: fraction(2) });
    const metrics = integrateTextureDensity(whole, [
      { trackPlanId: "track:source-lead", isLead: true, range: whole, pitch: { step: "C", alter: 0, octave: 4 }, attack: true },
      { trackPlanId: "track:1", isLead: false, range: half, pitch: { step: "C", alter: 0, octave: 4 }, attack: true },
      { trackPlanId: "track:2", isLead: false, range: musicalRange(half.end, whole.end), pitch: { step: "E", alter: 0, octave: 4 }, attack: true },
    ], [fraction(4)]);
    expect(metrics.participationCoverage.valueBp).toBe(10_000);
    expect(metrics.harmonicDivergenceCoverage.valueBp).toBe(5_000);
    expect(metrics.harmonyAttackRatio.valueBp).toBe(20_000);
    expect(metrics.exactlyTwoPitchCoverage.valueBp).toBe(5_000);
  });

  it("reports no evaluable lead-rest duration as null", () => {
    const whole = musicalRange({ performanceMeasureIndex: 0, offset: fraction(0) }, { performanceMeasureIndex: 1, offset: fraction(0) });
    const metrics = integrateTextureDensity(whole, [{ trackPlanId: "track:source-lead", isLead: true, range: whole, pitch: { step: "C", alter: 0, octave: 4 }, attack: true }], [fraction(4)]);
    expect(metrics.harmonyOverLeadRestCoverage).toMatchObject({ valueBp: null, unavailableReason: "NO_EVALUABLE_ITEMS" });
  });
});
