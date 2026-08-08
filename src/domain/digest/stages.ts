import type { ArrangementPresetId, CoreArrangementMode, UserArrangementCaps } from "../config";
import { compareCanonicalValues, semanticDigest, type SemanticDigest } from "./canonical";
import type { PitchRange } from "../pitch";
import type { IntentLock, ActivityLock, AnchorLock, SolverLock } from "../locks";

export interface CanonicalPerformerProjection { readonly performerOrdinal: number; readonly hardRange: PitchRange; readonly comfortableRange: PitchRange; readonly preferredTessitura: PitchRange | null }
export interface CanonicalTrackProjection { readonly trackOrdinal: number; readonly kind: "source-lead" | "generated-harmony"; readonly enabled: boolean }
export interface CanonicalAssignmentProjection { readonly trackOrdinal: number; readonly performerOrdinal: number }
export interface StageInputDigests { readonly intentInputDigest: SemanticDigest; readonly activityInputDigest: SemanticDigest; readonly anchorInputDigest: SemanticDigest; readonly generationInputDigest: SemanticDigest }
export type StaleStage = "intent" | "activity" | "anchor" | "generation";

export function earliestStaleStage(previous: StageInputDigests, next: StageInputDigests): StaleStage | undefined {
  if (previous.intentInputDigest !== next.intentInputDigest) return "intent";
  if (previous.activityInputDigest !== next.activityInputDigest) return "activity";
  if (previous.anchorInputDigest !== next.anchorInputDigest) return "anchor";
  return previous.generationInputDigest !== next.generationInputDigest ? "generation" : undefined;
}

const sortedLocks = <T extends { readonly id: string }>(locks: readonly T[]): readonly object[] =>
  locks
    .map((lock) => Object.fromEntries(Object.entries(lock).filter(([key]) => key !== "id")))
    .sort(compareCanonicalValues);

export async function digestIntentInput(input: {
  readonly musicalSourceDigest: SemanticDigest; readonly effectiveChordTimelineDigest: SemanticDigest; readonly sourceLeadAtomizationDigest: SemanticDigest; readonly atomizerVersion: string; readonly performers: readonly CanonicalPerformerProjection[]; readonly tracks: readonly CanonicalTrackProjection[]; readonly assignments: readonly CanonicalAssignmentProjection[]; readonly mode: CoreArrangementMode; readonly userCaps: UserArrangementCaps; readonly presetId: ArrangementPresetId; readonly effectiveConfigDigest: SemanticDigest; readonly presetProfileVersion: string; readonly presetProfileDigest: SemanticDigest; readonly locks: readonly IntentLock[]; readonly plannerVersion: string; readonly grammarVersion: string; readonly plannerConfigDigest: SemanticDigest; readonly grammarConfigDigest: SemanticDigest; readonly diagnosticRegistryVersion: string; readonly diagnosticRegistryDigest: SemanticDigest;
}): Promise<SemanticDigest> {
  return semanticDigest({ projectionSchema: "hm-intent-input-v1", ...input, performers: [...input.performers].sort((a, b) => a.performerOrdinal - b.performerOrdinal), tracks: [...input.tracks].sort((a, b) => a.trackOrdinal - b.trackOrdinal), assignments: [...input.assignments].sort((a, b) => a.trackOrdinal - b.trackOrdinal), locks: sortedLocks(input.locks) });
}
export async function digestActivityInput(input: { readonly intentPlanDigest: SemanticDigest; readonly sourceLeadAtomizationDigest: SemanticDigest; readonly atomizerVersion: string; readonly effectiveConfigDigest: SemanticDigest; readonly presetProfileVersion: string; readonly presetProfileDigest: SemanticDigest; readonly locks: readonly ActivityLock[]; readonly activityPlannerVersion: string; readonly activityPlannerConfigDigest: SemanticDigest; readonly diagnosticRegistryVersion: string; readonly diagnosticRegistryDigest: SemanticDigest }): Promise<SemanticDigest> {
  return semanticDigest({ projectionSchema: "hm-activity-input-v1", ...input, locks: sortedLocks(input.locks) });
}
export async function digestAnchorInput(input: { readonly activityPlanDigest: SemanticDigest; readonly sourceLeadAtomizationDigest: SemanticDigest; readonly atomizerVersion: string; readonly effectiveConfigDigest: SemanticDigest; readonly presetProfileVersion: string; readonly presetProfileDigest: SemanticDigest; readonly locks: readonly AnchorLock[]; readonly anchorPlannerVersion: string; readonly anchorPlannerConfigDigest: SemanticDigest; readonly diagnosticRegistryVersion: string; readonly diagnosticRegistryDigest: SemanticDigest }): Promise<SemanticDigest> {
  return semanticDigest({ projectionSchema: "hm-anchor-input-v1", ...input, locks: sortedLocks(input.locks) });
}
export async function digestGenerationInput(input: { readonly anchorPlanDigest: SemanticDigest; readonly effectiveConfigDigest: SemanticDigest; readonly presetProfileVersion: string; readonly presetProfileDigest: SemanticDigest; readonly locks: readonly SolverLock[]; readonly solverVersion: string; readonly assemblerVersion: string; readonly validatorVersion: string; readonly metricsVersion: string; readonly candidateProjectionVersion: string; readonly solverConfigDigest: SemanticDigest; readonly assemblerConfigDigest: SemanticDigest; readonly validatorConfigDigest: SemanticDigest; readonly metricConfigDigest: SemanticDigest; readonly diagnosticRegistryVersion: string; readonly diagnosticRegistryDigest: SemanticDigest }): Promise<SemanticDigest> {
  return semanticDigest({ projectionSchema: "hm-generation-input-v1", ...input, locks: sortedLocks(input.locks) });
}
