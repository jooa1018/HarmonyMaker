import { describe, expect, it } from "vitest";

import { digestActivityPlan } from "../domain/digest/plans";
import { fraction } from "../domain/fraction";
import type { ActivityLock, VariantStageLocks } from "../domain/locks";
import { COMMON_TIME, COMPOUND_DUPLE } from "../domain/meter";
import { musicalRange } from "../domain/time";
import {
  REQUIRED_SEGMENT_B_FIXTURE_IDS,
  SEGMENT_B_FIXTURE_EXPECTATIONS,
  createWagFixtureInput,
  materializeSegmentBFixture,
  pitch,
} from "./fixtures";
import {
  planWagActivity,
  planWagIntent,
  prepareWagLifecycle,
  primaryPulseAt,
} from "./lifecycle";

const noLocks: VariantStageLocks = { intent: [], activity: [], anchor: [], solver: [] };

describe("Segment B fixture materialization", () => {
  it("declares every required fixture with a stable ID and explicit expectation", () => {
    expect(new Set(REQUIRED_SEGMENT_B_FIXTURE_IDS).size).toBe(REQUIRED_SEGMENT_B_FIXTURE_IDS.length);
    for (const fixtureId of REQUIRED_SEGMENT_B_FIXTURE_IDS) {
      expect(SEGMENT_B_FIXTURE_EXPECTATIONS[fixtureId]).toEqual(expect.objectContaining({
        fixtureId,
        expectedStatus: expect.stringMatching(/^(complete|partial|blocked)$/),
        expectedOutcome: fixtureId,
      }));
    }
  });

  it.each([
    "hm-original-major-stepwise-v0",
    "hm-original-minor-phrase-v0",
    "hm-original-sus-omission-v0",
    "hm-segment-b-all-nc-v0",
    "hm-segment-b-one-singer-upper-wins-v0",
    "hm-segment-b-one-singer-lower-wins-v0",
  ] as const)("materializes canonical input for %s", async (fixtureId) => {
    const fixture = await materializeSegmentBFixture(fixtureId);
    expect(fixture.input.source.title).toBe(fixtureId);
    expect(fixture.input.source.revisionDigest).toHaveLength(64);
    expect(fixture.input.effectiveChordTimeline.digest).toHaveLength(64);
    expect(fixture.input.sourceLeadAtomization.digest).toHaveLength(64);
    expect(fixture.expected.fixtureId).toBe(fixtureId);
  });
});

describe("WAG v1.0.1 Intent lifecycle", () => {
  it("persists the sole one-singer Upper role selected by the frozen preview", async () => {
    const input = await createWagFixtureInput({
      fixtureId: "hm-segment-b-one-singer-upper-wins-v0",
      generatedRanges: [{ low: pitch("E", 4), high: pitch("G", 4) }],
      maxHarmonyTracks: 1,
      leadNotes: [{ onset: fraction(0), duration: fraction(4), pitch: pitch("C", 4), lyric: "la" }],
    });
    const result = await planWagIntent(input);
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    const phrase = result.value.phraseIntents[0];
    expect(phrase.harmonyExpectation).toBe("H1-required");
    expect(phrase.trackRoles).toEqual([expect.objectContaining({ placementRole: "upper", trackPlanId: "track:h1" })]);
    expect(result.value.sectionIntents[0].intensityTarget.registerSpreadRange).toEqual([4, 7]);
    expect(phrase.cadencePolicy).toBe("open");
  });

  it("persists Lower when the same singer is structurally Lower-only", async () => {
    const input = await createWagFixtureInput({
      fixtureId: "hm-segment-b-one-singer-lower-wins-v0",
      generatedRanges: [{ low: pitch("E", 3), high: pitch("B", 3) }],
      maxHarmonyTracks: 1,
    });
    const result = await planWagIntent(input);
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    expect(result.value.phraseIntents[0].trackRoles).toEqual([
      expect.objectContaining({ placementRole: "lower", trackPlanId: "track:h1" }),
    ]);
  });

  it("evaluates the two exact Upper/Lower bijections and persists one role per track", async () => {
    const input = await createWagFixtureInput({
      fixtureId: "hm-segment-b-two-singer-bijections-v0",
      presetId: "standard",
      maxHarmonyTracks: 2,
      generatedRanges: [
        { low: pitch("D", 4), high: pitch("C", 6) },
        { low: pitch("C", 2), high: pitch("B", 3) },
      ],
    });
    const result = await planWagIntent(input);
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    expect(result.value.phraseIntents[0].trackRoles).toEqual([
      expect.objectContaining({ trackPlanId: "track:h1", placementRole: "upper" }),
      expect.objectContaining({ trackPlanId: "track:h2", placementRole: "lower" }),
    ]);
    expect(result.value.grammarTrace?.candidatesByPhraseId[result.value.phraseIntents[0].phraseId]).toHaveLength(2);
  });

  it("derives exact open/closed cadence metadata without changing local selection", async () => {
    const openInput = await createWagFixtureInput({ sectionType: "chorus", sectionVariant: "base" });
    const closedInput = await createWagFixtureInput({ sectionType: "ending", sectionVariant: "final" });
    const [open, closed] = await Promise.all([planWagIntent(openInput), planWagIntent(closedInput)]);
    expect(open.status).toBe("complete");
    expect(closed.status).toBe("complete");
    if (open.status === "complete" && closed.status === "complete") {
      expect(open.value.phraseIntents[0].cadencePolicy).toBe("open");
      expect(closed.value.phraseIntents[0].cadencePolicy).toBe("closed");
    }
  });

  it("is invariant to input array order and display-only renames", async () => {
    const input = await createWagFixtureInput({ presetId: "standard", maxHarmonyTracks: 2 });
    const renamed = {
      ...input,
      performers: [...input.performers].reverse().map((performer, index) => ({ ...performer, displayName: `Renamed ${index}` })),
      trackPlans: [...input.trackPlans].reverse().map((track) => ({ ...track, displayLabel: `Track ${track.canonicalOrdinal}` })),
      assignments: [...input.assignments].reverse(),
    };
    const [left, right] = await Promise.all([planWagIntent(input), planWagIntent(renamed)]);
    expect(left.status).toBe("complete");
    expect(right.status).toBe("complete");
    if (left.status === "complete" && right.status === "complete") {
      expect(right.value.intentInputDigest).toBe(left.value.intentInputDigest);
      expect(right.value.intentPlanDigest).toBe(left.value.intentPlanDigest);
      expect(right.value.phraseIntents.map((phrase) => phrase.trackRoles)).toEqual(
        left.value.phraseIntents.map((phrase) => phrase.trackRoles),
      );
    }
  });

  it("uses [0,0] spread and Lead-only complete intent when harmony is not expected", async () => {
    const input = await createWagFixtureInput({ maxHarmonyTracks: 0 });
    const result = await planWagIntent(input);
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    expect(result.value.phraseIntents[0]).toMatchObject({ harmonyExpectation: "none", textureId: "UNISON", trackRoles: [] });
    expect(result.value.sectionIntents[0].intensityTarget.registerSpreadRange).toEqual([0, 0]);
  });
});

describe("WAG v1.0.1 Activity lifecycle", () => {
  it("owns only rest versus independent-note and retains no pitch or tone", async () => {
    const input = await createWagFixtureInput({ generatedRanges: [{ low: pitch("D", 4), high: pitch("C", 6) }], maxHarmonyTracks: 1 });
    const intent = await planWagIntent(input);
    expect(intent.status).toBe("complete");
    if (intent.status !== "complete") return;
    const activity = await planWagActivity(input, intent.value);
    expect(activity.status).toBe("complete");
    if (activity.status !== "complete") return;
    expect(activity.value.phraseActivityPlans[0].activitySpans.every((span) => span.activity.state === "independent-note")).toBe(true);
    const serialized = JSON.stringify(activity.value);
    expect(serialized).not.toContain('"pitch"');
    expect(serialized).not.toContain("selectedTone");
  });

  it("emits durable R7 hard-impossibility evidence even without selector trace", async () => {
    const input = await createWagFixtureInput({
      generatedRanges: [{ low: pitch("C", 4), high: pitch("C", 4) }],
      maxHarmonyTracks: 1,
    });
    const intent = await planWagIntent(input);
    expect(intent.status).toBe("complete");
    if (intent.status !== "complete") return;
    const activity = await planWagActivity(input, intent.value);
    expect(activity.status).toBe("complete");
    if (activity.status !== "complete") return;
    const evidence = activity.value.phraseActivityPlans[0].decisionEvidence;
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0]).toEqual(expect.objectContaining({
      trackPlanId: "track:h1",
      reason: "LOCAL_REST_HARD_IMPOSSIBILITY",
      hardLegalCandidateCount: 0,
      sourceToneSpellingExclusionCount: expect.any(Number),
    }));
    expect(activity.value.phraseActivityPlans[0].activitySpans.some((span) => span.activity.state === "rest")).toBe(true);
  });

  it("keeps durable rest evidence outside the Activity musical digest", async () => {
    const input = await createWagFixtureInput({ generatedRanges: [{ low: pitch("C", 4), high: pitch("C", 4) }], maxHarmonyTracks: 1 });
    const prepared = await prepareWagLifecycle(input);
    const intent = await planWagIntent(input);
    if (prepared.status !== "complete" || intent.status !== "complete") throw new Error("fixture preparation failed");
    const activity = await planWagActivity(input, intent.value);
    if (activity.status !== "complete") throw new Error("activity failed");
    const altered = {
      ...activity.value,
      phraseActivityPlans: activity.value.phraseActivityPlans.map((phrase) => ({
        ...phrase,
        decisionEvidence: phrase.decisionEvidence.map((evidence) => ({ ...evidence, sourceToneSpellingExclusionCount: 999 })),
      })),
    };
    expect(await digestActivityPlan(altered, prepared.value.ordinals)).toBe(activity.value.activityPlanDigest);
  });

  it("makes explicit N.C. baseline-ineligible and rest without false impossibility evidence", async () => {
    const fixture = await materializeSegmentBFixture("hm-segment-b-all-nc-v0");
    const intent = await planWagIntent(fixture.input);
    expect(intent.status).toBe("complete");
    if (intent.status !== "complete") return;
    const activity = await planWagActivity(fixture.input, intent.value);
    expect(activity.status).toBe("complete");
    if (activity.status !== "complete") return;
    expect(intent.value.phraseIntents[0].harmonyExpectation).toBe("none");
    expect(activity.value.phraseActivityPlans[0].activitySpans.every((span) => span.activity.state === "rest")).toBe(true);
    expect(activity.value.phraseActivityPlans[0].decisionEvidence).toEqual([]);
  });

  it("blocks an ActivityLock that requires impossible sounding", async () => {
    const base = await createWagFixtureInput({ generatedRanges: [{ low: pitch("C", 4), high: pitch("C", 4) }], maxHarmonyTracks: 1 });
    const phraseId = base.source.phraseRegions[0].id;
    const firstRange = base.sourceLeadAtomization.atoms[0].range;
    const lock: ActivityLock = {
      id: "lk:simple:activity:impossible:0",
      kind: "activity",
      presetId: base.effectiveConfig.presetId,
      phraseId,
      trackPlanId: "track:h1",
      range: firstRange,
      activity: { state: "independent-note", behavior: "independent-harmony" },
    };
    const input = { ...base, locks: { ...noLocks, activity: [lock] } };
    const intent = await planWagIntent(input);
    expect(intent.status).toBe("complete");
    if (intent.status !== "complete") return;
    const activity = await planWagActivity(input, intent.value);
    expect(activity.status).toBe("blocked");
    if (activity.status === "blocked") {
      expect(activity.diagnostics).toEqual([expect.objectContaining({
        code: "STAGE_LOCK_SCOPE_INVALID",
        details: expect.objectContaining({ reason: "LOCK_INDUCED_NO_LEGAL_CANDIDATE" }),
      })]);
    }
  });

  it("uses exact 4/4 and 6/8 primary pulses", async () => {
    const common = await createWagFixtureInput({ meter: COMMON_TIME });
    const compound = await createWagFixtureInput({
      meter: COMPOUND_DUPLE,
      leadNotes: [{ onset: fraction(0), duration: fraction(3, 2), pitch: pitch("C", 4), lyric: "la" }],
    });
    const [commonPrepared, compoundPrepared] = await Promise.all([prepareWagLifecycle(common), prepareWagLifecycle(compound)]);
    if (commonPrepared.status !== "complete" || compoundPrepared.status !== "complete") throw new Error("fixture preparation failed");
    expect(primaryPulseAt(commonPrepared.value, { performanceMeasureIndex: 0, offset: fraction(0) })).toEqual(fraction(1));
    expect(primaryPulseAt(compoundPrepared.value, { performanceMeasureIndex: 0, offset: fraction(0) })).toEqual(fraction(3, 2));
    const compoundIntent = await planWagIntent(compound);
    expect(compoundIntent.status).toBe("complete");
    if (compoundIntent.status === "complete") expect(compoundIntent.value.phraseIntents[0].harmonyExpectation).toBe("H1-required");
  });

  it("splits Activity at an exact lock boundary without creating persistent source atoms", async () => {
    const base = await createWagFixtureInput({ generatedRanges: [{ low: pitch("D", 4), high: pitch("C", 6) }], maxHarmonyTracks: 1 });
    const phraseId = base.source.phraseRegions[0].id;
    const lockRange = musicalRange(
      { performanceMeasureIndex: 0, offset: fraction(1, 2) },
      { performanceMeasureIndex: 0, offset: fraction(1) },
    );
    const lock: ActivityLock = { id: "lk:simple:activity:rest:0", kind: "activity", presetId: "simple", phraseId, trackPlanId: "track:h1", range: lockRange, activity: { state: "rest" } };
    const input = { ...base, locks: { ...noLocks, activity: [lock] } };
    const intent = await planWagIntent(input);
    if (intent.status !== "complete") throw new Error("intent failed");
    const activity = await planWagActivity(input, intent.value);
    expect(activity.status).toBe("complete");
    if (activity.status === "complete") {
      expect(activity.value.phraseActivityPlans[0].activitySpans).toEqual(expect.arrayContaining([
        expect.objectContaining({ range: lockRange, activity: { state: "rest" } }),
      ]));
      expect(base.sourceLeadAtomization.atoms.some((atom) => atom.range.start.offset.n === 1 && atom.range.start.offset.d === 2)).toBe(false);
    }
  });
});
