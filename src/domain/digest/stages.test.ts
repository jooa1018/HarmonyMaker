import { describe, expect, it } from "vitest";
import type { SemanticDigest } from "./canonical";
import { digestActivityInput, digestAnchorInput, digestGenerationInput, digestIntentInput, earliestStaleStage } from "./stages";
import { fraction } from "../fraction";

const d = (digit: string) => digit.repeat(64) as SemanticDigest;
const ordinals = {
  sectionOccurrenceOrdinalById: { "so:0": 0 },
  phraseOrdinalById: { "ph:0": 0 },
  trackOrdinalById: { "track:1": 1 },
  leadAtomOrdinalById: {},
  chordSpanOrdinalById: {},
} as const;
const baseIntent = {
  musicalSourceDigest: d("0"), effectiveChordTimelineDigest: d("1"), sourceLeadAtomizationDigest: d("2"), atomizerVersion: "atom-v1",
  performers: [{ performerOrdinal: 0, hardRange: { low: { step: "C", alter: 0, octave: 3 }, high: { step: "C", alter: 0, octave: 5 } }, comfortableRange: { low: { step: "E", alter: 0, octave: 3 }, high: { step: "A", alter: 0, octave: 4 } }, preferredTessitura: null }],
  tracks: [{ trackOrdinal: 0, kind: "source-lead", enabled: true }], assignments: [{ trackOrdinal: 0, performerOrdinal: 0 }],
  mode: { profileId: "worship-band-v1", harmonicContext: "band-supported" }, userCaps: { maxHarmonyTracks: 2, allowOctaveDouble: false }, presetId: "simple", effectiveConfigDigest: d("3"), presetProfileVersion: "preset-v1", presetProfileDigest: d("4"), locks: [], plannerVersion: "planner-v1", grammarVersion: "grammar-v1", plannerConfigDigest: d("5"), grammarConfigDigest: d("6"), diagnosticRegistryVersion: "diag-v1", diagnosticRegistryDigest: d("7"),
} as const;

describe("stage-specific semantic digests", () => {
  it("changes Intent for preferred tessitura, section/config authority inputs, and IntentLock", async () => {
    const base = await digestIntentInput(baseIntent, ordinals);
    const tessitura = await digestIntentInput({ ...baseIntent, performers: [{ ...baseIntent.performers[0], preferredTessitura: { low: { step: "G", alter: 0, octave: 3 }, high: { step: "G", alter: 0, octave: 4 } } }] }, ordinals);
    const lock = await digestIntentInput({ ...baseIntent, locks: [{ id: "lock:display-a", presetId: "simple", kind: "texture", phraseId: "ph:0", textureId: "UNISON" }] }, ordinals);
    expect(tessitura).not.toBe(base);
    expect(lock).not.toBe(base);
  });

  it("sorts stage locks by semantic projection and excludes lock IDs", async () => {
    const first = { id: "lk:z", presetId: "simple", kind: "texture", phraseId: "ph:0", textureId: "UNISON" } as const;
    const second = { id: "lk:a", presetId: "simple", kind: "placement-role", phraseId: "ph:0", trackPlanId: "track:1", placementRole: "upper" } as const;
    const forward = await digestIntentInput({ ...baseIntent, locks: [first, second] }, ordinals);
    const reversedAndRenamed = await digestIntentInput({ ...baseIntent, locks: [{ ...second, id: "random:2" }, { ...first, id: "random:1" }] }, ordinals);
    expect(reversedAndRenamed).toBe(forward);
  });

  it("isolates Activity, Anchor, and Generation locks to their stages", async () => {
    const common = { sourceLeadAtomizationDigest: d("2"), atomizerVersion: "atom-v1", effectiveConfigDigest: d("3"), presetProfileVersion: "preset-v1", presetProfileDigest: d("4"), diagnosticRegistryVersion: "diag-v1", diagnosticRegistryDigest: d("7") } as const;
    const activity = await digestActivityInput({ ...common, intentPlanDigest: d("8"), locks: [], activityPlannerVersion: "activity-v1", activityPlannerConfigDigest: d("9") }, ordinals);
    const activityLocked = await digestActivityInput({ ...common, intentPlanDigest: d("8"), locks: [{ id: "al:0", presetId: "simple", kind: "activity", phraseId: "ph:0", trackPlanId: "track:1", range: { start: { performanceMeasureIndex: 0, offset: fraction(0) }, end: { performanceMeasureIndex: 0, offset: fraction(1) } }, activity: { state: "rest" } }], activityPlannerVersion: "activity-v1", activityPlannerConfigDigest: d("9") }, ordinals);
    expect(activityLocked).not.toBe(activity);
    const anchor = await digestAnchorInput({ ...common, activityPlanDigest: d("a"), locks: [], anchorPlannerVersion: "anchor-v1", anchorPlannerConfigDigest: d("b") }, ordinals);
    expect(anchor).toHaveLength(64);
    const generation = await digestGenerationInput({ anchorPlanDigest: d("c"), effectiveConfigDigest: d("3"), presetProfileVersion: "preset-v1", presetProfileDigest: d("4"), locks: [], solverVersion: "s1", assemblerVersion: "a1", validatorVersion: "v1", metricsVersion: "m1", candidateProjectionVersion: "cp1", solverConfigDigest: d("d"), assemblerConfigDigest: d("e"), validatorConfigDigest: d("f"), metricConfigDigest: d("0"), diagnosticRegistryVersion: "diag-v1", diagnosticRegistryDigest: d("7") }, ordinals);
    const differentVersion = await digestGenerationInput({ anchorPlanDigest: d("c"), effectiveConfigDigest: d("3"), presetProfileVersion: "preset-v1", presetProfileDigest: d("4"), locks: [], solverVersion: "s2", assemblerVersion: "a1", validatorVersion: "v1", metricsVersion: "m1", candidateProjectionVersion: "cp1", solverConfigDigest: d("d"), assemblerConfigDigest: d("e"), validatorConfigDigest: d("f"), metricConfigDigest: d("0"), diagnosticRegistryVersion: "diag-v1", diagnosticRegistryDigest: d("7") }, ordinals);
    expect(differentVersion).not.toBe(generation);
  });

  it("classifies exact earliest invalidation stage", () => {
    const previous = { intentInputDigest: d("0"), activityInputDigest: d("1"), anchorInputDigest: d("2"), generationInputDigest: d("3") };
    expect(earliestStaleStage(previous, { ...previous, intentInputDigest: d("9") })).toBe("intent");
    expect(earliestStaleStage(previous, { ...previous, activityInputDigest: d("9") })).toBe("activity");
    expect(earliestStaleStage(previous, { ...previous, anchorInputDigest: d("9") })).toBe("anchor");
    expect(earliestStaleStage(previous, { ...previous, generationInputDigest: d("9") })).toBe("generation");
  });
});
