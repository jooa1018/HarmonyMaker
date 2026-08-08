import { describe, expect, it } from "vitest";
import type { SemanticDigest } from "./digest/canonical";
import { fraction } from "./fraction";
import { markVariantStale, preserveBlockedAttempt, validateArrangementVariant, type ArrangementVariant } from "./project";
import { countRate, durationRate, extendedCountRate } from "./rates";
import type { ArrangementIntentPlan } from "./plans";

const digest = "0".repeat(64) as SemanticDigest;
const intentPlan: ArrangementIntentPlan = { stage: "intent", presetId: "simple", intentInputDigest: digest, effectiveChordTimelineDigest: digest, sourceLeadAtomizationDigest: digest, effectiveConfigDigest: digest, presetProfileVersion: "v", presetProfileDigest: digest, grammarId: "worship-arrangement-grammar-v1", grammarVersion: "v", plannerVersion: "v", grammarConfigDigest: digest, plannerConfigDigest: digest, diagnosticRegistryVersion: "v", diagnosticRegistryDigest: digest, sectionIntents: [], phraseIntents: [], intentPlanDigest: digest };

describe("variant lifecycle and rate contracts", () => {
  it("distinguishes absent stage objects from present empty arrays", () => {
    const empty: ArrangementVariant = { lifecycle: "empty", presetId: "simple", diagnostics: [] };
    expect(validateArrangementVariant(empty)).toBe(true);
    expect(validateArrangementVariant({ ...empty, intentPlan: { sectionIntents: [], phraseIntents: [] } })).toBe(false);
    expect(validateArrangementVariant({ ...empty, staleness: { staleFrom: "intent", staleDiagnosticIds: [], previousArtifactDigests: [] } })).toBe(false);
  });

  it("preserves realized artifacts when marking a variant stale", () => {
    const variant: ArrangementVariant = { lifecycle: "intent-ready", presetId: "simple", diagnostics: [], intentPlan };
    const stale = markVariantStale(variant, { staleFrom: "intent", staleDiagnosticIds: [], previousArtifactDigests: [digest] });
    expect(stale.lifecycle).toBe("intent-ready");
    expect("intentPlan" in stale && stale.intentPlan).toBe(intentPlan);
  });

  it("preserves the previous variant on a blocked retry", () => {
    const standardPlan: ArrangementIntentPlan = { ...intentPlan, presetId: "standard" };
    const variant: ArrangementVariant = { lifecycle: "intent-ready", presetId: "standard", diagnostics: [], intentPlan: standardPlan };
    const updated = preserveBlockedAttempt(variant, "activity", digest, { status: "blocked", diagnostics: [{ id: "dg:block", code: "GRAMMAR_BLOCKED", severity: "blocking", messageKo: "blocked" }] });
    expect(updated.lifecycle).toBe("intent-ready");
    expect("intentPlan" in updated && updated.intentPlan).toBe(standardPlan);
    expect(updated.lastBlockedAttempt?.stage).toBe("activity");
  });

  it("represents denominator zero honestly", () => {
    expect(countRate(0, 0)).toEqual({ numerator: 0, denominator: 0, valueBp: null, unavailableReason: "NO_EVALUABLE_ITEMS" });
    expect(extendedCountRate(0, 0).valueBp).toBeNull();
    expect(durationRate(fraction(0), fraction(0)).valueBp).toBeNull();
  });

  it("allows attack ratios over 100 percent only in ExtendedBasisPoints", () => {
    expect(extendedCountRate(3, 2).valueBp).toBe(15000);
    expect(() => countRate(3, 2)).toThrow();
  });
});
