import { containsRange, type PitchRange } from "./pitch";

export interface PerformerProfile {
  readonly id: string;
  readonly displayName: string;
  readonly hardRange: PitchRange;
  readonly comfortableRange: PitchRange;
  readonly preferredTessitura?: PitchRange;
}
export interface SourceLeadTrackPlan { readonly kind: "source-lead"; readonly id: "track:source-lead"; readonly displayLabel: string; readonly canonicalOrdinal: 0; readonly enabled: true }
export type GeneratedTrackOrdinal = 1 | 2;
export type VocalPlacementRole = "upper" | "lower";
export interface GeneratedHarmonyTrackPlan { readonly kind: "generated-harmony"; readonly id: string; readonly displayLabel: string; readonly canonicalOrdinal: GeneratedTrackOrdinal; readonly enabled: boolean }
export type VocalTrackPlan = SourceLeadTrackPlan | GeneratedHarmonyTrackPlan;
export interface TrackRoleSegment { readonly id: string; readonly phraseId: string; readonly trackPlanId: string; readonly placementRole: VocalPlacementRole }
export interface PerformerTrackAssignment { readonly trackPlanId: string; readonly performerId: string }

export const SOURCE_LEAD_TRACK: SourceLeadTrackPlan = { kind: "source-lead", id: "track:source-lead", displayLabel: "Source Lead", canonicalOrdinal: 0, enabled: true };

export function validatePerformer(profile: PerformerProfile): boolean {
  return containsRange(profile.hardRange, profile.comfortableRange) && (!profile.preferredTessitura || containsRange(profile.comfortableRange, profile.preferredTessitura));
}

export function validateTrackPlans(plans: readonly VocalTrackPlan[]): boolean {
  const lead = plans.filter((plan) => plan.kind === "source-lead");
  const generated = plans.filter((plan): plan is GeneratedHarmonyTrackPlan => plan.kind === "generated-harmony").sort((a, b) => a.canonicalOrdinal - b.canonicalOrdinal);
  return lead.length === 1 && new Set(plans.map((plan) => plan.id)).size === plans.length && generated.every((plan, index) => plan.canonicalOrdinal === index + 1);
}

export function validateAssignments(plans: readonly VocalTrackPlan[], performers: readonly PerformerProfile[], assignments: readonly PerformerTrackAssignment[]): readonly string[] {
  const errors: string[] = [];
  const performerIds = new Set(performers.map((performer) => performer.id));
  for (const plan of plans) {
    const matching = assignments.filter((assignment) => assignment.trackPlanId === plan.id);
    if ((plan.kind === "source-lead" || plan.enabled) && matching.length !== 1) errors.push(`assignment:${plan.id}`);
    if (matching.some((assignment) => !performerIds.has(assignment.performerId))) errors.push(`performer:${plan.id}`);
  }
  if (new Set(assignments.map((assignment) => assignment.performerId)).size !== assignments.length) errors.push("performer-double-booked");
  return errors;
}
