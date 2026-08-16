import { compareCanonicalValues } from "../domain/digest/canonical";
import type { ArrangementPresetId } from "../domain/config";
import type { ActivityLock, AnchorLock, IntentLock, SolverLock, VariantStageLocks } from "../domain/locks";
import { validateLockScope } from "../domain/locks";
import { markVariantStale, type HarmonyProject, type VariantStaleness } from "../domain/project";

export type LockStage = keyof VariantStageLocks;
type StageLock = IntentLock | ActivityLock | AnchorLock | SolverLock;

function lockBelongsToStage(lock: StageLock, stage: LockStage): boolean {
  if (stage === "intent") return lock.kind === "texture" || lock.kind === "placement-role";
  if (stage === "activity") return lock.kind === "activity";
  if (stage === "anchor") return lock.kind.startsWith("anchor-");
  return lock.kind === "pitch";
}

function staleFrom(stage: LockStage): VariantStaleness["staleFrom"] {
  return stage === "solver" ? "generation" : stage;
}

function earliestStaleBoundary(left: VariantStaleness["staleFrom"] | undefined, right: VariantStaleness["staleFrom"]): VariantStaleness["staleFrom"] {
  const order: readonly VariantStaleness["staleFrom"][] = ["intent", "activity", "anchor", "generation"];
  return left && order.indexOf(left) < order.indexOf(right) ? left : right;
}

export function replaceStageLocks(
  project: HarmonyProject,
  presetId: ArrangementPresetId,
  stage: LockStage,
  locks: readonly StageLock[],
): HarmonyProject {
  if (locks.some((lock) => !lockBelongsToStage(lock, stage) || !validateLockScope(lock, presetId))) throw new RangeError("STAGE_LOCK_SCOPE_INVALID");
  const ordered = locks.slice().sort(compareCanonicalValues);
  const current = project.locksByPreset[presetId] ?? { intent: [], activity: [], anchor: [], solver: [] };
  const nextLocks = { ...current, [stage]: ordered } as VariantStageLocks;
  const variant = project.variants[presetId];
  if (!variant || variant.lifecycle === "empty") return { ...project, locksByPreset: { ...project.locksByPreset, [presetId]: nextLocks } };
  const previousArtifactDigests = [
    "intentPlan" in variant ? variant.intentPlan.intentPlanDigest : undefined,
    "activityPlan" in variant ? variant.activityPlan.activityPlanDigest : undefined,
    "anchorPlan" in variant ? variant.anchorPlan.anchorPlanDigest : undefined,
    variant.lifecycle === "generation-attempted" ? variant.generationResult.digests.generationInputDigest : undefined,
  ].filter((value): value is NonNullable<typeof value> => value !== undefined);
  const stale = markVariantStale(variant, { staleFrom: earliestStaleBoundary(variant.staleness?.staleFrom, staleFrom(stage)), staleDiagnosticIds: [], previousArtifactDigests });
  const { activeArrangement, ...staleWithoutActiveArrangement } = stale.lifecycle === "generation-attempted" ? stale : { ...stale, activeArrangement: undefined };
  void activeArrangement;
  return {
    ...project,
    locksByPreset: { ...project.locksByPreset, [presetId]: nextLocks },
    variants: { ...project.variants, [presetId]: staleWithoutActiveArrangement },
  };
}
