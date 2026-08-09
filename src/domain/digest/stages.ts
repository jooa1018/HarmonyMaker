import type { ArrangementPresetId, CoreArrangementMode, UserArrangementCaps } from "../config";
import { compareCanonicalValues, semanticDigest, type SemanticDigest } from "./canonical";
import type { PitchRange } from "../pitch";
import type {
  IntentLock, ActivityLock, AnchorLock, LockedAnchorEndpointSpec, SolverLock,
} from "../locks";
import type { PlanOrdinalRegistry } from "./plans";

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

function ordinal(
  record: Readonly<Record<string, number>>,
  id: string,
  kind: string,
): number {
  const value = record[id];
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`missing canonical ${kind} ordinal: ${id}`);
  }
  return value;
}

function endpointProjection(
  endpoint: LockedAnchorEndpointSpec,
  ordinals: PlanOrdinalRegistry,
): object {
  if (endpoint.kind === "chord-tone") {
    return {
      kind: endpoint.kind,
      position: endpoint.position,
      chordSpanOrdinal: ordinal(
        ordinals.chordSpanOrdinalById,
        endpoint.chordSpanId,
        "chord span",
      ),
      selectedTone: endpoint.selectedTone,
    };
  }
  return {
    kind: endpoint.kind,
    position: endpoint.position,
    leadAtomOrdinal: ordinal(
      ordinals.leadAtomOrdinalById,
      endpoint.leadAtom.leadAtomId,
      "lead atom",
    ),
    sourceLeadAtomizationDigest: endpoint.leadAtom.sourceLeadAtomizationDigest,
    relation: endpoint.relation,
  };
}

function lockProjection(
  lock: IntentLock | ActivityLock | AnchorLock | SolverLock,
  ordinals: PlanOrdinalRegistry,
): object {
  const common = {
    presetId: lock.presetId,
    kind: lock.kind,
    phraseOrdinal: ordinal(ordinals.phraseOrdinalById, lock.phraseId, "phrase"),
  };
  if (lock.kind === "texture") return { ...common, textureId: lock.textureId };
  if (lock.kind === "placement-role") {
    return {
      ...common,
      trackOrdinal: ordinal(ordinals.trackOrdinalById, lock.trackPlanId, "track"),
      placementRole: lock.placementRole,
    };
  }
  if (lock.kind === "activity") {
    return {
      ...common,
      trackOrdinal: ordinal(ordinals.trackOrdinalById, lock.trackPlanId, "track"),
      range: lock.range,
      activity: lock.activity,
    };
  }
  if (lock.kind === "pitch") {
    return {
      ...common,
      trackOrdinal: ordinal(ordinals.trackOrdinalById, lock.trackPlanId, "track"),
      position: lock.position,
      pitch: lock.pitch,
    };
  }
  const anchorCommon = {
    ...common,
    trackOrdinal: ordinal(ordinals.trackOrdinalById, lock.trackPlanId, "track"),
    position: lock.position,
  };
  if (lock.kind === "anchor-chord-tone") {
    return {
      ...anchorCommon,
      chordSpanOrdinal: ordinal(
        ordinals.chordSpanOrdinalById,
        lock.chordSpanId,
        "chord span",
      ),
      selectedTone: lock.selectedTone,
    };
  }
  if (lock.kind === "anchor-lead-derived") {
    return {
      ...anchorCommon,
      leadAtomOrdinal: ordinal(
        ordinals.leadAtomOrdinalById,
        lock.leadAtom.leadAtomId,
        "lead atom",
      ),
      sourceLeadAtomizationDigest: lock.leadAtom.sourceLeadAtomizationDigest,
      relation: lock.relation,
    };
  }
  const nctCommon = {
    ...anchorCommon,
    nctKind: lock.nctSpec.kind,
    contextChordSpanOrdinal: ordinal(
      ordinals.chordSpanOrdinalById,
      lock.nctSpec.contextChordSpanId,
      "chord span",
    ),
    targetChordSpanOrdinal: ordinal(
      ordinals.chordSpanOrdinalById,
      lock.nctSpec.targetChordSpanId,
      "chord span",
    ),
    preparation: endpointProjection(lock.nctSpec.preparation, ordinals),
    resolution: endpointProjection(lock.nctSpec.resolution, ordinals),
    resolutionDeadline: lock.nctSpec.resolutionDeadline,
  };
  return lock.nctSpec.kind === "passing" || lock.nctSpec.kind === "neighbor"
    ? { ...nctCommon, direction: lock.nctSpec.direction }
    : lock.nctSpec.kind === "suspension"
      ? { ...nctCommon, resolutionDirection: lock.nctSpec.resolutionDirection }
      : nctCommon;
}

function sortedLocks(
  locks: readonly (IntentLock | ActivityLock | AnchorLock | SolverLock)[],
  ordinals: PlanOrdinalRegistry,
): readonly object[] {
  return locks.map((lock) => lockProjection(lock, ordinals)).sort(compareCanonicalValues);
}

export async function digestIntentInput(input: {
  readonly musicalSourceDigest: SemanticDigest; readonly effectiveChordTimelineDigest: SemanticDigest; readonly sourceLeadAtomizationDigest: SemanticDigest; readonly atomizerVersion: string; readonly performers: readonly CanonicalPerformerProjection[]; readonly tracks: readonly CanonicalTrackProjection[]; readonly assignments: readonly CanonicalAssignmentProjection[]; readonly mode: CoreArrangementMode; readonly userCaps: UserArrangementCaps; readonly presetId: ArrangementPresetId; readonly effectiveConfigDigest: SemanticDigest; readonly presetProfileVersion: string; readonly presetProfileDigest: SemanticDigest; readonly locks: readonly IntentLock[]; readonly plannerVersion: string; readonly grammarVersion: string; readonly plannerConfigDigest: SemanticDigest; readonly grammarConfigDigest: SemanticDigest; readonly diagnosticRegistryVersion: string; readonly diagnosticRegistryDigest: SemanticDigest;
}, ordinals: PlanOrdinalRegistry): Promise<SemanticDigest> {
  return semanticDigest({ projectionSchema: "hm-intent-input-v1", ...input, performers: [...input.performers].sort((a, b) => a.performerOrdinal - b.performerOrdinal), tracks: [...input.tracks].sort((a, b) => a.trackOrdinal - b.trackOrdinal), assignments: [...input.assignments].sort((a, b) => a.trackOrdinal - b.trackOrdinal), locks: sortedLocks(input.locks, ordinals) });
}
export async function digestActivityInput(input: { readonly intentPlanDigest: SemanticDigest; readonly sourceLeadAtomizationDigest: SemanticDigest; readonly atomizerVersion: string; readonly effectiveConfigDigest: SemanticDigest; readonly presetProfileVersion: string; readonly presetProfileDigest: SemanticDigest; readonly locks: readonly ActivityLock[]; readonly activityPlannerVersion: string; readonly activityPlannerConfigDigest: SemanticDigest; readonly diagnosticRegistryVersion: string; readonly diagnosticRegistryDigest: SemanticDigest }, ordinals: PlanOrdinalRegistry): Promise<SemanticDigest> {
  return semanticDigest({ projectionSchema: "hm-activity-input-v1", ...input, locks: sortedLocks(input.locks, ordinals) });
}
export async function digestAnchorInput(input: { readonly activityPlanDigest: SemanticDigest; readonly sourceLeadAtomizationDigest: SemanticDigest; readonly atomizerVersion: string; readonly effectiveConfigDigest: SemanticDigest; readonly presetProfileVersion: string; readonly presetProfileDigest: SemanticDigest; readonly locks: readonly AnchorLock[]; readonly anchorPlannerVersion: string; readonly anchorPlannerConfigDigest: SemanticDigest; readonly diagnosticRegistryVersion: string; readonly diagnosticRegistryDigest: SemanticDigest }, ordinals: PlanOrdinalRegistry): Promise<SemanticDigest> {
  return semanticDigest({ projectionSchema: "hm-anchor-input-v1", ...input, locks: sortedLocks(input.locks, ordinals) });
}
export async function digestGenerationInput(input: { readonly anchorPlanDigest: SemanticDigest; readonly effectiveConfigDigest: SemanticDigest; readonly presetProfileVersion: string; readonly presetProfileDigest: SemanticDigest; readonly locks: readonly SolverLock[]; readonly solverVersion: string; readonly assemblerVersion: string; readonly validatorVersion: string; readonly metricsVersion: string; readonly candidateProjectionVersion: string; readonly solverConfigDigest: SemanticDigest; readonly assemblerConfigDigest: SemanticDigest; readonly validatorConfigDigest: SemanticDigest; readonly metricConfigDigest: SemanticDigest; readonly diagnosticRegistryVersion: string; readonly diagnosticRegistryDigest: SemanticDigest }, ordinals: PlanOrdinalRegistry): Promise<SemanticDigest> {
  return semanticDigest({ projectionSchema: "hm-generation-input-v1", ...input, locks: sortedLocks(input.locks, ordinals) });
}
