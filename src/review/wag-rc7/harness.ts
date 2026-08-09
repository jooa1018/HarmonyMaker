import type { Rc7PrepareOptions } from "./prepare";
import type { SemanticDigest } from "../../domain/digest/canonical";
import { createRc7PipelineContext } from "./authority";
import {
  RC7_GRAMMAR_CONFIG_DIGEST,
  RC7_REVIEW_BOUNDARY,
  RC7_REVIEW_VERSIONS,
  RC7_TEXTURE_ORDER,
} from "./constants";
import { createRc7PlaybackArtifact } from "./playback";
import { assertReviewOnlyBoundary, prepareRc7ReferenceCase } from "./prepare";
import { RC7_REFERENCE_CASES } from "./reference-cases";
import { runRc7GenerationStage } from "./solver";
import {
  runRc7ActivityStage,
  runRc7AnchorStage,
  runRc7IntentStage,
} from "./stages";
import type {
  Rc7PipelineContext,
  Rc7PreparedCase,
  Rc7ReferenceCaseDefinition,
  Rc7ReviewOutput,
} from "./types";

function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

export async function runPreparedRc7ReviewCase(
  context: Rc7PipelineContext,
): Promise<Rc7ReviewOutput> {
  assertReviewOnlyBoundary(context.prepared);
  const intent = await runRc7IntentStage(context);
  const activity = await runRc7ActivityStage(context, intent);
  const anchor = await runRc7AnchorStage(context, activity);
  const generated = await runRc7GenerationStage(context, intent, activity, anchor);
  const eligibleTextures = RC7_TEXTURE_ORDER.filter((textureId) => (
    intent.selection.opportunities.some((candidate) => candidate.textureId === textureId)
  ));
  const ineligibleTextures = RC7_TEXTURE_ORDER.filter((textureId) => !eligibleTextures.includes(textureId))
    .map((textureId) => ({
      textureId,
      reasons: unique(intent.selection.trace
        .filter((candidate) => candidate.textureId === textureId && !candidate.eligible)
        .flatMap((candidate) => candidate.reasonCodes)),
    }));
  const prepared = context.prepared;
  return {
    schema: "hm-wag-rc7-review-output-v1",
    authorityBoundary: RC7_REVIEW_BOUNDARY,
    caseId: prepared.caseId,
    title: prepared.title,
    sourceIdentity: prepared.sourceIdentity,
    meter: prepared.meterFamily,
    key: prepared.defaultKey,
    section: prepared.sectionDefinition.type,
    sectionVariant: prepared.sectionOccurrence.variant,
    preset: prepared.presetId,
    performerRanges: prepared.performers,
    phraseBounds: prepared.phrase.range,
    leadAtomsSummary: prepared.sourceLeadAtomization.atoms,
    effectiveChordSpans: prepared.effectiveChordTimeline.spans,
    phraseFeatures: intent.selection.features,
    activationCues: intent.selection.cues,
    eligibleTextures,
    ineligibleTextures,
    candidateIds: [
      ...intent.selection.opportunities.map((candidate) => candidate.key),
      generated.candidate.id,
    ],
    candidateScoreBreakdown: intent.selection.opportunities.map((candidate) => ({
      candidateId: candidate.key,
      textureId: candidate.textureId,
      totalScore: candidate.totalScore,
      parts: candidate.scoreParts,
    })),
    winner: intent.selection.winner,
    intent: {
      plan: intent.plan,
      serializedAuthoritativePlan: intent.serializedAuthoritativePlan,
      witness: intent.witness,
      verifiedAssignedTracks: intent.assignedTracks,
    },
    activity: {
      plan: activity.plan,
      rehydratedOpportunityKey: activity.rehydratedOpportunityKey,
      cacheRequired: false,
      traceRequired: false,
    },
    anchor: {
      plan: anchor.plan,
      primaryRoleVector: anchor.winner.semanticPayload.primaryHarmonyRoleObligationVector,
      secondTrackRoleVector: anchor.winner.semanticPayload.secondTrackRoleContributionVector,
    },
    generated: {
      candidate: generated.candidate,
      payloadsByTrack: generated.payloadsByTrack,
      generationInputDigest: generated.generationInputDigest,
      pitchTrace: generated.pitchTrace,
    },
    rangeChecks: generated.rangeChecks,
    verticalLegalityChecks: generated.verticalLegalityChecks,
    nctClassification: generated.nctClassification,
    opportunityKey: intent.selection.winner.key,
    intentInputDigest: intent.plan.intentInputDigest,
    grammarConfigDigest: RC7_GRAMMAR_CONFIG_DIGEST as SemanticDigest,
    digests: {
      musicalSourceDigest: prepared.musicalSourceDigest,
      effectiveChordTimelineDigest: prepared.effectiveChordTimeline.digest,
      sourceLeadAtomizationDigest: prepared.sourceLeadAtomization.digest,
      effectiveConfigDigest: context.effectiveConfig.digest,
      presetProfileDigest: context.effectiveConfig.presetProfileDigest,
      intentInputDigest: intent.plan.intentInputDigest,
      intentPlanDigest: intent.plan.intentPlanDigest,
      activityInputDigest: activity.plan.activityInputDigest,
      activityPlanDigest: activity.plan.activityPlanDigest,
      anchorInputDigest: anchor.plan.anchorInputDigest,
      anchorPlanDigest: anchor.plan.anchorPlanDigest,
      generationInputDigest: generated.generationInputDigest,
      candidateContentDigest: generated.candidate.contentDigest,
    },
    versions: {
      grammarVersion: intent.plan.grammarVersion,
      plannerVersion: intent.plan.plannerVersion,
      activityPlannerVersion: activity.plan.activityPlannerVersion,
      anchorPlannerVersion: anchor.plan.anchorPlannerVersion,
      solverVersion: RC7_REVIEW_VERSIONS.solverVersion,
      assemblerVersion: RC7_REVIEW_VERSIONS.assemblerVersion,
      validatorVersion: RC7_REVIEW_VERSIONS.validatorVersion,
      metricsVersion: RC7_REVIEW_VERSIONS.metricsVersion,
      candidateProjectionVersion: RC7_REVIEW_VERSIONS.candidateProjectionVersion,
      diagnosticRegistryVersion: RC7_REVIEW_VERSIONS.diagnosticRegistryVersion,
    },
    trace: intent.selection.trace,
    playback: createRc7PlaybackArtifact(context, generated),
  };
}

export async function runRc7ReferenceCase(
  definition: Rc7ReferenceCaseDefinition,
  options: Rc7PrepareOptions = {},
): Promise<Rc7ReviewOutput> {
  const prepared = await prepareRc7ReferenceCase(definition, options);
  return runPreparedRc7ReviewCase(await createRc7PipelineContext(prepared));
}

export async function runRc7ReferenceCaseById(
  caseId: string,
  options: Rc7PrepareOptions = {},
): Promise<Rc7ReviewOutput> {
  const definition = RC7_REFERENCE_CASES.find((candidate) => candidate.caseId === caseId);
  if (!definition) throw new RangeError(`RC7_REVIEW_CASE_NOT_FOUND:${caseId}`);
  return runRc7ReferenceCase(definition, options);
}

export async function runRc7ReferencePack(): Promise<readonly Rc7ReviewOutput[]> {
  const outputs: Rc7ReviewOutput[] = [];
  for (const definition of RC7_REFERENCE_CASES) outputs.push(await runRc7ReferenceCase(definition));
  return outputs;
}

export async function runPreparedRc7ReviewInput(
  prepared: Rc7PreparedCase,
): Promise<Rc7ReviewOutput> {
  return runPreparedRc7ReviewCase(await createRc7PipelineContext(prepared));
}
