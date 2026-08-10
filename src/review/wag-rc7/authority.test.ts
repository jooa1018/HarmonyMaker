import type { ActivityLock, AnchorLock, IntentLock, SolverLock } from "../../domain/locks";
import type { ArrangementActivityPlan, ArrangementAnchorPlan } from "../../domain/plans";
import { describe, expect, it } from "vitest";
import { createRc7PipelineContext } from "./authority";
import { prepareRc7ReferenceCase } from "./prepare";
import { RC7_REFERENCE_CASES } from "./reference-cases";
import { runRc7GenerationStage } from "./solver";
import {
  runRc7ActivityStage,
  runRc7AnchorStage,
  runRc7IntentStage,
  type Rc7ActivityStageResult,
  type Rc7AnchorStageResult,
} from "./stages";
import type { Rc7PreparedCase } from "./types";

const tppCase = RC7_REFERENCE_CASES.find((definition) => definition.caseId === "C-STANDARD-CHORUS-BOUNDED-TPP")!;
const thirdCase = RC7_REFERENCE_CASES.find((definition) => definition.caseId === "H-STANDARD-THIRD-POSITIVE")!;

async function stages(prepared: Rc7PreparedCase) {
  const context = await createRc7PipelineContext(prepared);
  const intent = await runRc7IntentStage(context);
  const activity = await runRc7ActivityStage(context, intent);
  const anchor = await runRc7AnchorStage(context, activity);
  const generation = await runRc7GenerationStage(context, intent, activity, anchor);
  return { context, intent, activity, anchor, generation };
}

describe("rc.7 stage authority and locks", () => {
  it("Grammar applies IntentLock before persisting the winner", async () => {
    const base = await prepareRc7ReferenceCase(thirdCase);
    const baseline = await stages(base);
    const lock: IntentLock = {
      id: "intent-lock-runtime-id",
      kind: "texture",
      presetId: base.presetId,
      phraseId: base.phrase.id,
      textureId: "ACCENT_BLOCK",
    };
    const locked = await stages({ ...base, locks: { ...base.locks, intent: [lock] } });
    expect(baseline.intent.selection.winner.textureId).toBe("UNISON_TO_SPLIT");
    expect(locked.intent.selection.winner.textureId).toBe("ACCENT_BLOCK");
    expect(locked.intent.plan.phraseIntents[0].textureId).toBe("ACCENT_BLOCK");
    expect(locked.intent.plan.intentInputDigest).not.toBe(baseline.intent.plan.intentInputDigest);
  }, 30_000);

  it("Activity consumes persisted Intent and validates an exact ActivityLock without reselection", async () => {
    const base = await prepareRc7ReferenceCase(tppCase);
    const baseline = await stages(base);
    const span = baseline.activity.plan.phraseActivityPlans[0].activitySpans[0];
    const lock: ActivityLock = {
      id: "activity-lock-runtime-id",
      kind: "activity",
      presetId: base.presetId,
      phraseId: base.phrase.id,
      trackPlanId: span.trackPlanId,
      range: span.range,
      activity: span.activity,
    };
    const locked = await stages({ ...base, locks: { ...base.locks, activity: [lock] } });
    expect(locked.activity.rehydratedOpportunityKey).toBe(locked.intent.selection.winner.key);
    expect(locked.activity.plan.phraseActivityPlans[0].activitySpans).toEqual(
      baseline.activity.plan.phraseActivityPlans[0].activitySpans,
    );
    expect(locked.activity.plan.activityInputDigest).not.toBe(baseline.activity.plan.activityInputDigest);

    const invalidLock: ActivityLock = { ...lock, id: "bad-activity-lock", range: base.phrase.range };
    const invalidContext = await createRc7PipelineContext({
      ...base,
      locks: { ...base.locks, activity: [invalidLock] },
    });
    const invalidIntent = await runRc7IntentStage(invalidContext);
    await expect(runRc7ActivityStage(invalidContext, invalidIntent)).rejects.toThrow("ActivityLock contradicts");
  }, 30_000);

  it("Anchor consumes persisted Activity and replaces the matching automatic endpoint with AnchorLock authority", async () => {
    const base = await prepareRc7ReferenceCase(tppCase);
    const baseline = await stages(base);
    const directive = baseline.anchor.plan.phraseAnchorPlans[0].anchorDirectives[0];
    expect(directive.kind).toBe("chord-tone");
    if (directive.kind !== "chord-tone") throw new Error("fixture drift");
    const lock: AnchorLock = {
      id: "anchor-lock-runtime-id",
      kind: "anchor-chord-tone",
      presetId: base.presetId,
      phraseId: base.phrase.id,
      trackPlanId: directive.trackPlanId,
      position: directive.position,
      chordSpanId: directive.chordSpanId,
      selectedTone: directive.selectedTone,
    };
    const locked = await stages({ ...base, locks: { ...base.locks, anchor: [lock] } });
    expect(locked.anchor.plan.phraseAnchorPlans[0].anchorDirectives.some((item) => item.id === lock.id)).toBe(true);
    expect(locked.anchor.plan.anchorInputDigest).not.toBe(baseline.anchor.plan.anchorInputDigest);
    expect(locked.generation.rangeChecks.every((check) => check.insideHardRange)).toBe(true);
  }, 30_000);

  it("Solver consumes persisted Anchor and applies an exact SolverLock", async () => {
    const base = await prepareRc7ReferenceCase(tppCase);
    const baseline = await stages(base);
    const realized = baseline.generation.realizedAnchors[0];
    const lock: SolverLock = {
      id: "solver-lock-runtime-id",
      kind: "pitch",
      presetId: base.presetId,
      phraseId: base.phrase.id,
      trackPlanId: realized.trackPlanId,
      position: realized.position,
      pitch: realized.pitch,
    };
    const locked = await stages({ ...base, locks: { ...base.locks, solver: [lock] } });
    expect(locked.generation.realizedAnchors.find((anchor) => anchor.trackPlanId === lock.trackPlanId
      && anchor.position.performanceMeasureIndex === lock.position.performanceMeasureIndex
      && anchor.position.offset.n === lock.position.offset.n
      && anchor.position.offset.d === lock.position.offset.d)?.pitch).toEqual(lock.pitch);
    expect(locked.generation.generationInputDigest).not.toBe(baseline.generation.generationInputDigest);
    expect(locked.generation.candidate.contentDigest).toBe(baseline.generation.candidate.contentDigest);

    const invalid: SolverLock = { ...lock, id: "illegal-solver-lock", pitch: { step: "F", alter: 0, octave: 8 } };
    const prepared = { ...base, locks: { ...base.locks, solver: [invalid] } };
    const context = await createRc7PipelineContext(prepared);
    const intent = await runRc7IntentStage(context);
    const activity = await runRc7ActivityStage(context, intent);
    const anchor = await runRc7AnchorStage(context, activity);
    await expect(runRc7GenerationStage(context, intent, activity, anchor)).rejects.toThrow("NO_LEGAL_VOICING");
  }, 30_000);

  it("rejects tampering that contradicts persisted upstream stage digests", async () => {
    const base = await prepareRc7ReferenceCase(tppCase);
    const result = await stages(base);
    const phraseActivity = result.activity.plan.phraseActivityPlans[0];
    const forgedActivityPlan: ArrangementActivityPlan = {
      ...result.activity.plan,
      phraseActivityPlans: [{
        ...phraseActivity,
        activitySpans: [{ ...phraseActivity.activitySpans[0], range: base.phrase.range }],
      }],
    };
    const forgedActivity: Rc7ActivityStageResult = { ...result.activity, plan: forgedActivityPlan };
    await expect(runRc7AnchorStage(result.context, forgedActivity)).rejects.toThrow("persisted Activity authority");

    const forgedAnchorPlan: ArrangementAnchorPlan = {
      ...result.anchor.plan,
      anchorPlanDigest: "0".repeat(64) as ArrangementAnchorPlan["anchorPlanDigest"],
    };
    const forgedAnchor: Rc7AnchorStageResult = { ...result.anchor, plan: forgedAnchorPlan };
    await expect(runRc7GenerationStage(
      result.context,
      result.intent,
      result.activity,
      forgedAnchor,
    )).rejects.toThrow("persisted Anchor authority");
  }, 30_000);
});
