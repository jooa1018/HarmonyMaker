import { describe, expect, it } from "vitest";
import { fraction } from "../fraction";
import type { ArrangementAnchorPlan, HarmonyAnchorDirective, NonChordTonePlan } from "../plans";
import type { SemanticDigest } from "./canonical";
import { digestAnchorPlan, type PlanOrdinalRegistry } from "./plans";

const digest = "0".repeat(64) as SemanticDigest;
const at = (n: number, d = 1) => ({ performanceMeasureIndex: 0, offset: fraction(n, d) });
const tone = { degree: 3, alteration: 0, role: "third", origin: "quality" } as const;
const endpoints: readonly HarmonyAnchorDirective[] = [
  { kind: "chord-tone", id: "ad:prep-a", trackPlanId: "track:h1", position: at(0), chordSpanId: "pcs:0", selectedTone: tone },
  { kind: "chord-tone", id: "ad:prep-b", trackPlanId: "track:h1", position: at(1, 2), chordSpanId: "pcs:0", selectedTone: tone },
  { kind: "chord-tone", id: "ad:resolution-a", trackPlanId: "track:h1", position: at(2), chordSpanId: "pcs:1", selectedTone: tone },
  { kind: "chord-tone", id: "ad:resolution-b", trackPlanId: "track:h1", position: at(5, 2), chordSpanId: "pcs:1", selectedTone: tone },
];
const nct: NonChordTonePlan = { id: "nct:0", kind: "passing", trackPlanId: "track:h1", position: at(1), contextChordSpanId: "pcs:0", targetChordSpanId: "pcs:1", preparationDirectiveId: "ad:prep-a", resolutionDirectiveId: "ad:resolution-a", resolutionDeadline: at(3), direction: "up" };
const planned: HarmonyAnchorDirective = { kind: "planned-nct", id: "ad:planned", trackPlanId: "track:h1", position: at(1), contextChordSpanId: "pcs:0", nctPlanId: "nct:0" };
const plan: ArrangementAnchorPlan = {
  stage: "anchor-realized", presetId: "standard", activityPlanDigest: digest, anchorInputDigest: digest, anchorPlannerVersion: "anchor-v1", anchorPlannerConfigDigest: digest, diagnosticRegistryVersion: "diag-v1", diagnosticRegistryDigest: digest, sourceLeadAtomizationDigest: digest, effectiveConfigDigest: digest, presetProfileDigest: digest,
  phraseAnchorPlans: [{ id: "pn:0", phraseId: "ph:0", activityPlanId: "pa:0", anchorDirectives: [...endpoints, planned], nctPlans: [nct] }], anchorPlanDigest: digest,
};
const ordinals: PlanOrdinalRegistry = { sectionOccurrenceOrdinalById: {}, phraseOrdinalById: { "ph:0": 0 }, trackOrdinalById: { "track:h1": 1, "track:h2": 2 }, leadAtomOrdinalById: {}, chordSpanOrdinalById: { "pcs:0": 0, "pcs:1": 1 } };

describe("canonical Anchor Plan graph projection", () => {
  it("is invariant to set-like directive order and excludes raw IDs from ordering", async () => {
    const first = await digestAnchorPlan(plan, ordinals);
    const permuted = { ...plan, phraseAnchorPlans: [{ ...plan.phraseAnchorPlans[0], id: "pn:renamed", anchorDirectives: [...plan.phraseAnchorPlans[0].anchorDirectives].reverse() }] };
    expect(await digestAnchorPlan(permuted, ordinals)).toBe(first);
  });

  it("changes when the NCT endpoint graph linkage changes", async () => {
    const changed = { ...plan, phraseAnchorPlans: [{ ...plan.phraseAnchorPlans[0], nctPlans: [{ ...nct, preparationDirectiveId: "ad:prep-b", resolutionDirectiveId: "ad:resolution-b" }] }] };
    expect(await digestAnchorPlan(changed, ordinals)).not.toBe(await digestAnchorPlan(plan, ordinals));
  });

  it("blocks dangling, cross-track, cross-phrase, and position-mismatched links", async () => {
    const phrase = plan.phraseAnchorPlans[0];
    await expect(digestAnchorPlan({ ...plan, phraseAnchorPlans: [{ ...phrase, anchorDirectives: phrase.anchorDirectives.map((item) => item.kind === "planned-nct" ? { ...item, nctPlanId: "nct:missing" } : item) }] }, ordinals)).rejects.toThrow("linkage");
    await expect(digestAnchorPlan({ ...plan, phraseAnchorPlans: [{ ...phrase, nctPlans: [{ ...nct, trackPlanId: "track:h2" }] }] }, ordinals)).rejects.toThrow("mismatch");
    await expect(digestAnchorPlan({ ...plan, phraseAnchorPlans: [{ ...phrase, nctPlans: [{ ...nct, preparationDirectiveId: "ad:other-phrase" }] }] }, ordinals)).rejects.toThrow("cross-phrase");
    await expect(digestAnchorPlan({ ...plan, phraseAnchorPlans: [{ ...phrase, anchorDirectives: phrase.anchorDirectives.map((item) => item.kind === "planned-nct" ? { ...item, position: at(3, 2) } : item) }] }, ordinals)).rejects.toThrow("mismatch");
  });
});
