import { describe, expect, it } from "vitest";
import type { SemanticDigest } from "./canonical";
import { digestActivityInput, digestAnchorInput, digestGenerationInput, digestIntentInput } from "./stages";
import { fraction } from "../fraction";

const d = (digit: string) => digit.repeat(64) as SemanticDigest;
const baseIntent = {
  musicalSourceDigest: d("0"), effectiveChordTimelineDigest: d("1"), sourceLeadAtomizationDigest: d("2"), atomizerVersion: "atom-v1",
  performers: [{ performerOrdinal: 0, hardRange: { low: { step: "C", alter: 0, octave: 3 }, high: { step: "C", alter: 0, octave: 5 } }, comfortableRange: { low: { step: "E", alter: 0, octave: 3 }, high: { step: "A", alter: 0, octave: 4 } }, preferredTessitura: null }],
  tracks: [{ trackOrdinal: 0, kind: "source-lead", enabled: true }], assignments: [{ trackOrdinal: 0, performerOrdinal: 0 }],
  mode: { profileId: "worship-band-v1", harmonicContext: "band-supported" }, userCaps: { maxHarmonyTracks: 2, allowOctaveDouble: false }, presetId: "simple", effectiveConfigDigest: d("3"), presetProfileVersion: "preset-v1", presetProfileDigest: d("4"), locks: [], plannerVersion: "planner-v1", grammarVersion: "grammar-v1", plannerConfigDigest: d("5"), grammarConfigDigest: d("6"), diagnosticRegistryVersion: "diag-v1", diagnosticRegistryDigest: d("7"),
} as const;

describe("stage-specific semantic digests", () => {
  it("changes Intent for preferred tessitura, section/config authority inputs, and IntentLock", async () => {
    const base = await digestIntentInput(baseIntent);
    const tessitura = await digestIntentInput({ ...baseIntent, performers: [{ ...baseIntent.performers[0], preferredTessitura: { low: { step: "G", alter: 0, octave: 3 }, high: { step: "G", alter: 0, octave: 4 } } }] });
    const lock = await digestIntentInput({ ...baseIntent, locks: [{ id: "lock:display-a", presetId: "simple", kind: "texture", phraseId: "ph:0", textureId: "UNISON" }] });
    expect(tessitura).not.toBe(base);
    expect(lock).not.toBe(base);
  });

  it("isolates Activity, Anchor, and Generation locks to their stages", async () => {
    const common = { sourceLeadAtomizationDigest: d("2"), atomizerVersion: "atom-v1", effectiveConfigDigest: d("3"), presetProfileVersion: "preset-v1", presetProfileDigest: d("4"), diagnosticRegistryVersion: "diag-v1", diagnosticRegistryDigest: d("7") } as const;
    const activity = await digestActivityInput({ ...common, intentPlanDigest: d("8"), locks: [], activityPlannerVersion: "activity-v1", activityPlannerConfigDigest: d("9") });
    const activityLocked = await digestActivityInput({ ...common, intentPlanDigest: d("8"), locks: [{ id: "al:0", presetId: "simple", kind: "activity", phraseId: "ph:0", trackPlanId: "track:1", range: { start: { performanceMeasureIndex: 0, offset: fraction(0) }, end: { performanceMeasureIndex: 0, offset: fraction(1) } }, activity: { state: "rest" } }], activityPlannerVersion: "activity-v1", activityPlannerConfigDigest: d("9") });
    expect(activityLocked).not.toBe(activity);
    const anchor = await digestAnchorInput({ ...common, activityPlanDigest: d("a"), locks: [], anchorPlannerVersion: "anchor-v1", anchorPlannerConfigDigest: d("b") });
    expect(anchor).toHaveLength(64);
    const generation = await digestGenerationInput({ anchorPlanDigest: d("c"), effectiveConfigDigest: d("3"), presetProfileVersion: "preset-v1", presetProfileDigest: d("4"), locks: [], solverVersion: "s1", assemblerVersion: "a1", validatorVersion: "v1", metricsVersion: "m1", candidateProjectionVersion: "cp1", solverConfigDigest: d("d"), assemblerConfigDigest: d("e"), validatorConfigDigest: d("f"), metricConfigDigest: d("0"), diagnosticRegistryVersion: "diag-v1", diagnosticRegistryDigest: d("7") });
    const differentVersion = await digestGenerationInput({ anchorPlanDigest: d("c"), effectiveConfigDigest: d("3"), presetProfileVersion: "preset-v1", presetProfileDigest: d("4"), locks: [], solverVersion: "s2", assemblerVersion: "a1", validatorVersion: "v1", metricsVersion: "m1", candidateProjectionVersion: "cp1", solverConfigDigest: d("d"), assemblerConfigDigest: d("e"), validatorConfigDigest: d("f"), metricConfigDigest: d("0"), diagnosticRegistryVersion: "diag-v1", diagnosticRegistryDigest: d("7") });
    expect(differentVersion).not.toBe(generation);
  });
});

