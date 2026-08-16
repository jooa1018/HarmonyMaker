import { describe, expect, it } from "vitest";

import { fraction } from "../domain/fraction";
import type { PitchLock, VariantStageLocks } from "../domain/locks";
import { createWagFixtureInput, pitch } from "./fixtures";
import { planWagActivity, planWagAnchor, planWagIntent } from "./lifecycle";
import { solveWagLocally } from "./solver";

const noLocks: VariantStageLocks = { intent: [], activity: [], anchor: [], solver: [] };

async function plans(input: Awaited<ReturnType<typeof createWagFixtureInput>>) {
  const intent = await planWagIntent(input);
  if (intent.status !== "complete") throw new Error("intent fixture failed");
  const activity = await planWagActivity(input, intent.value);
  if (activity.status !== "complete") throw new Error("activity fixture failed");
  const anchor = await planWagAnchor(input, intent.value, activity.value);
  if (anchor.status !== "complete") throw new Error("anchor fixture failed");
  return { intent: intent.value, activity: activity.value, anchor: anchor.value };
}

describe("WAG v1.0.1 Anchor and local Solver", () => {
  it("materializes chord-tone anchors and replays them to deterministic independent notes", async () => {
    const input = await createWagFixtureInput({
      fixtureId: "hm-original-major-stepwise-v0",
      generatedRanges: [{ low: pitch("D", 4), high: pitch("C", 6) }],
      maxHarmonyTracks: 1,
      leadNotes: [
        { onset: fraction(0), duration: fraction(1), pitch: pitch("C", 4), lyric: "glo" },
        { onset: fraction(1), duration: fraction(1), pitch: pitch("D", 4), lyric: "ry" },
      ],
    });
    const plan = await plans(input);
    expect(plan.anchor.phraseAnchorPlans[0].nctPlans).toEqual([]);
    expect(plan.anchor.phraseAnchorPlans[0].anchorDirectives.every((directive) => directive.kind === "chord-tone")).toBe(true);

    const solved = await solveWagLocally(input, plan.intent, plan.activity, plan.anchor);
    expect(solved.status).toBe("complete");
    if (solved.status !== "complete") return;
    expect(solved.value.generatedNctPlanCount).toBe(0);
    expect(solved.value.tracks).toHaveLength(1);
    expect(solved.value.tracks[0]).toMatchObject({ selectedByIntent: true, perceptible: true });
    expect(solved.value.tracks[0].decisions.filter((decision) => decision.selectedPitch)).toHaveLength(2);
    expect(solved.value.tracks[0].eventPayloads.every((event) => event.kind === "note" && event.source === "anchor")).toBe(true);
    expect(solved.value.tracks[0].realizedAnchors).toHaveLength(2);
  });

  it("accepts an exact legal PitchLock without retone or rest repair", async () => {
    const base = await createWagFixtureInput({ generatedRanges: [{ low: pitch("D", 4), high: pitch("C", 6) }], maxHarmonyTracks: 1 });
    const basePlan = await plans(base);
    const baseline = await solveWagLocally(base, basePlan.intent, basePlan.activity, basePlan.anchor);
    if (baseline.status !== "complete") throw new Error("baseline solver failed");
    const first = baseline.value.tracks[0].decisions.find((decision) => decision.selectedPitch);
    if (!first?.selectedPitch) throw new Error("missing baseline decision");
    const lock: PitchLock = {
      id: "lk:simple:pitch:valid:0",
      kind: "pitch",
      presetId: "simple",
      phraseId: first.phraseId,
      trackPlanId: first.trackPlanId,
      position: first.range.start,
      pitch: first.selectedPitch,
    };
    const input = { ...base, locks: { ...noLocks, solver: [lock] } };
    const solved = await solveWagLocally(input, basePlan.intent, basePlan.activity, basePlan.anchor);
    expect(solved.status).toBe("complete");
    if (solved.status === "complete") {
      expect(solved.value.tracks[0].decisions.find((decision) => decision.selectedPitch)?.selectedPitch).toEqual(first.selectedPitch);
    }
  });

  it("blocks an impossible PitchLock at Solver ownership instead of repairing it", async () => {
    const base = await createWagFixtureInput({ generatedRanges: [{ low: pitch("D", 4), high: pitch("C", 6) }], maxHarmonyTracks: 1 });
    const plan = await plans(base);
    const firstDirective = plan.anchor.phraseAnchorPlans[0].anchorDirectives[0];
    const lock: PitchLock = {
      id: "lk:simple:pitch:invalid:0",
      kind: "pitch",
      presetId: "simple",
      phraseId: plan.anchor.phraseAnchorPlans[0].phraseId,
      trackPlanId: firstDirective.trackPlanId,
      position: firstDirective.position,
      pitch: pitch("C", 8),
    };
    const input = { ...base, locks: { ...noLocks, solver: [lock] } };
    const solved = await solveWagLocally(input, plan.intent, plan.activity, plan.anchor);
    expect(solved.status).toBe("blocked");
    if (solved.status === "blocked") {
      expect(solved.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "STAGE_LOCK_SCOPE_INVALID",
          details: expect.objectContaining({ stage: "solver", reason: "LOCK_INDUCED_NO_LEGAL_CANDIDATE" }),
        }),
      ]));
    }
  });

  it("keeps N.C. silent through Anchor and Solver", async () => {
    const input = await createWagFixtureInput({ chords: [{ onset: fraction(0), symbol: "N.C." }], maxHarmonyTracks: 1 });
    const plan = await plans(input);
    expect(plan.anchor.phraseAnchorPlans[0].anchorDirectives).toEqual([]);
    const solved = await solveWagLocally(input, plan.intent, plan.activity, plan.anchor);
    expect(solved.status).toBe("complete");
    if (solved.status === "complete") {
      expect(solved.value.tracks[0].eventPayloads.every((event) => event.kind === "rest")).toBe(true);
      expect(solved.value.tracks[0].realizedAnchors).toEqual([]);
    }
  });
});
