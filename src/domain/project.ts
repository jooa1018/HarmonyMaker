import type { ArrangementPresetId, ArrangementSettings, PresetProfileRegistry } from "./config";
import type { SemanticDigest } from "./digest/canonical";
import type { Diagnostic } from "./diagnostics";
import type { ArrangementOutputEdit, EditedArrangementSnapshot } from "./edit/model";
import type { ArrangementGenerationResult } from "./generation/model";
import type { EffectiveChordTimelineState } from "./harmony/chord-timeline";
import type { VariantStageLocks } from "./locks";
import type { PerformerProfile, PerformerTrackAssignment, VocalTrackPlan } from "./performer";
import type { ArrangementActivityPlan, ArrangementAnchorPlan, ArrangementIntentPlan, StageExecutionResult } from "./plans";
import type { SourceLeadAtomizationState } from "./source/atomization";
import type { SongSourceDocument } from "./source/model";

export type ActiveArrangementRef = { readonly kind: "candidate"; readonly candidateId: string } | { readonly kind: "edited-snapshot"; readonly snapshotId: string };
export interface VariantStaleness { readonly staleFrom: "intent" | "activity" | "anchor" | "generation"; readonly staleDiagnosticIds: readonly string[]; readonly previousArtifactDigests: readonly SemanticDigest[] }
export interface VariantBlockedAttempt { readonly stage: VariantStaleness["staleFrom"]; readonly inputDigest: SemanticDigest; readonly diagnostics: readonly Diagnostic[] }
interface ArrangementVariantBase { readonly presetId: ArrangementPresetId; readonly diagnostics: readonly Diagnostic[]; readonly lastBlockedAttempt?: VariantBlockedAttempt }
type VariantStalenessAt<T extends VariantStaleness["staleFrom"]> = Omit<VariantStaleness, "staleFrom"> & { readonly staleFrom: T };
export type ArrangementVariant =
  | (ArrangementVariantBase & { readonly lifecycle: "empty"; readonly staleness?: never })
  | (ArrangementVariantBase & { readonly lifecycle: "intent-ready"; readonly intentPlan: ArrangementIntentPlan; readonly staleness?: VariantStalenessAt<"intent"> })
  | (ArrangementVariantBase & { readonly lifecycle: "activity-ready"; readonly intentPlan: ArrangementIntentPlan; readonly activityPlan: ArrangementActivityPlan; readonly staleness?: VariantStalenessAt<"intent" | "activity"> })
  | (ArrangementVariantBase & { readonly lifecycle: "anchor-ready"; readonly intentPlan: ArrangementIntentPlan; readonly activityPlan: ArrangementActivityPlan; readonly anchorPlan: ArrangementAnchorPlan; readonly staleness?: VariantStalenessAt<"intent" | "activity" | "anchor"> })
  | (ArrangementVariantBase & { readonly lifecycle: "generation-attempted"; readonly intentPlan: ArrangementIntentPlan; readonly activityPlan: ArrangementActivityPlan; readonly anchorPlan: ArrangementAnchorPlan; readonly generationResult: ArrangementGenerationResult; readonly outputEdits: readonly ArrangementOutputEdit[]; readonly editedSnapshots: readonly EditedArrangementSnapshot[]; readonly activeArrangement?: ActiveArrangementRef; readonly staleness?: VariantStaleness });
export interface HarmonyProject { readonly schemaVersion: 9; readonly source: SongSourceDocument; readonly chordTimelineState: EffectiveChordTimelineState; readonly sourceLeadAtomizationState: SourceLeadAtomizationState; readonly presetProfiles: PresetProfileRegistry; readonly performers: readonly PerformerProfile[]; readonly trackPlans: readonly VocalTrackPlan[]; readonly assignments: readonly PerformerTrackAssignment[]; readonly settings: ArrangementSettings; readonly locksByPreset: Readonly<Partial<Record<ArrangementPresetId, VariantStageLocks>>>; readonly variants: Readonly<Partial<Record<ArrangementPresetId, ArrangementVariant>>>; readonly selectedPresetId?: ArrangementPresetId }

const stages = ["intent", "activity", "anchor", "generation"] as const;
const lifecycleMax: Readonly<Record<ArrangementVariant["lifecycle"], number>> = { empty: -1, "intent-ready": 0, "activity-ready": 1, "anchor-ready": 2, "generation-attempted": 3 };
export function validateArrangementVariant(value: unknown): value is ArrangementVariant {
  if (typeof value !== "object" || value === null) return false;
  const variant = value as Readonly<Record<string, unknown>>;
  if (!["empty", "intent-ready", "activity-ready", "anchor-ready", "generation-attempted"].includes(String(variant.lifecycle))) return false;
  const max = lifecycleMax[variant.lifecycle as ArrangementVariant["lifecycle"]];
  const required = ["intentPlan", "activityPlan", "anchorPlan", "generationResult"].slice(0, max + 1);
  if (required.some((field) => !(field in variant))) return false;
  const forbidden = ["intentPlan", "activityPlan", "anchorPlan", "generationResult"].slice(max + 1);
  if (forbidden.some((field) => field in variant)) return false;
  if (variant.lifecycle === "generation-attempted" && (!Array.isArray(variant.outputEdits) || !Array.isArray(variant.editedSnapshots))) return false;
  if (variant.lifecycle === "empty" && variant.staleness !== undefined) return false;
  if (variant.staleness !== undefined) {
    if (typeof variant.staleness !== "object" || variant.staleness === null) return false;
    const staleFrom = (variant.staleness as Readonly<Record<string, unknown>>).staleFrom;
    if (!stages.includes(staleFrom as typeof stages[number]) || stages.indexOf(staleFrom as typeof stages[number]) > max) return false;
  }
  return true;
}
export function markVariantStale(variant: ArrangementVariant, staleness: VariantStaleness): ArrangementVariant {
  if (variant.lifecycle === "empty" || stages.indexOf(staleness.staleFrom) > lifecycleMax[variant.lifecycle]) throw new RangeError("GENERATION_RESULT_STATE_INVALID");
  if (variant.lifecycle === "intent-ready") return { ...variant, staleness: { ...staleness, staleFrom: "intent" } };
  if (variant.lifecycle === "activity-ready") return { ...variant, staleness: { ...staleness, staleFrom: staleness.staleFrom as "intent" | "activity" } };
  if (variant.lifecycle === "anchor-ready") return { ...variant, staleness: { ...staleness, staleFrom: staleness.staleFrom as "intent" | "activity" | "anchor" } };
  return { ...variant, staleness };
}
export function preserveBlockedAttempt<T>(variant: ArrangementVariant, stage: VariantBlockedAttempt["stage"], inputDigest: SemanticDigest, result: StageExecutionResult<T>): ArrangementVariant {
  return result.status === "blocked" ? { ...variant, lastBlockedAttempt: { stage, inputDigest, diagnostics: result.diagnostics }, diagnostics: [...variant.diagnostics, ...result.diagnostics] } : variant;
}
