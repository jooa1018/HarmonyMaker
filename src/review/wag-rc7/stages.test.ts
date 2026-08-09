import { describe, expect, it } from "vitest";
import { createRc7PipelineContext } from "./authority";
import { prepareRc7ReferenceCase } from "./prepare";
import { RC7_REFERENCE_CASES } from "./reference-cases";
import { runRc7GenerationStage } from "./solver";
import { runRc7ActivityStage, runRc7AnchorStage, runRc7IntentStage } from "./stages";

describe("rc.7 review stage handoff", () => {
  it.each(RC7_REFERENCE_CASES.map((definition) => [definition.caseId, definition] as const))(
    "%s serializes Intent without cache and reconstructs one Activity opportunity",
    async (_caseId, definition) => {
      const prepared = await prepareRc7ReferenceCase(definition);
      const context = await createRc7PipelineContext(prepared);
      const intent = await runRc7IntentStage(context);
      expect(intent.selection.winner.textureId).toBe(definition.expectedTexture);
      expect(intent.serializedAuthoritativePlan).not.toContain("opportunities");
      expect(intent.serializedAuthoritativePlan).not.toContain("grammarTrace");
      const activity = await runRc7ActivityStage(context, intent);
      expect(activity.rehydratedOpportunityKey).toBe(intent.selection.winner.key);
      const anchor = await runRc7AnchorStage(context, activity);
      expect(anchor.plan.activityPlanDigest).toBe(activity.plan.activityPlanDigest);
      const generated = await runRc7GenerationStage(context, intent, activity, anchor);
      expect(generated.candidate.anchorPlanDigest).toBe(anchor.plan.anchorPlanDigest);
      expect(generated.candidate.canonicalPathKey).toBe(intent.selection.winner.key);
      expect(generated.rangeChecks.every((check) => check.insideHardRange)).toBe(true);
      expect(generated.verticalLegalityChecks.every((check) => check.legal)).toBe(true);
    },
    30_000,
  );
});
