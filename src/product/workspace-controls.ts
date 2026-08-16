import type { ArrangementPresetId } from "../domain/config";
import type { ChordToneSpec } from "../domain/chord/model";
import type { ArrangementOutputEdit } from "../domain/edit/model";
import type { ArrangementCandidate } from "../domain/generation/model";
import type { ActivityLock, AnchorLock, IntentLock, LockedAnchorEndpointSpec, LockedNonChordToneSpec, PitchLock, SolverLock } from "../domain/locks";
import type { HarmonyProject } from "../domain/project";
import type { ArrangementAnchorPlan, ArrangementActivityPlan, ArrangementIntentPlan, HarmonyAnchorDirective, NonChordTonePlan, TexturePatternId, VoiceActivityDirective } from "../domain/plans";
import type { SpelledPitch } from "../domain/pitch";
import { comparePositions } from "../domain/time";
import type { VocalPlacementRole } from "../domain/performer";
import type { LockStage } from "./locks";

export type CanonicalLockTarget =
  | { readonly key: string; readonly stage: "intent"; readonly kind: "texture"; readonly phraseId: string; readonly label: string; readonly defaultTexture: TexturePatternId }
  | { readonly key: string; readonly stage: "intent"; readonly kind: "placement-role"; readonly phraseId: string; readonly trackPlanId: string; readonly label: string; readonly defaultPlacementRole: VocalPlacementRole }
  | { readonly key: string; readonly stage: "activity"; readonly kind: "activity"; readonly phraseId: string; readonly trackPlanId: string; readonly label: string; readonly range: ActivityLock["range"]; readonly defaultActivity: VoiceActivityDirective }
  | { readonly key: string; readonly stage: "anchor"; readonly kind: "anchor"; readonly phraseId: string; readonly trackPlanId: string; readonly label: string; readonly directive: HarmonyAnchorDirective; readonly anchorPlan: ArrangementAnchorPlan }
  | { readonly key: string; readonly stage: "solver"; readonly kind: "pitch"; readonly phraseId: string; readonly trackPlanId: string; readonly label: string; readonly position: PitchLock["position"]; readonly defaultPitch: SpelledPitch };

export type UiStageLock = IntentLock | ActivityLock | AnchorLock | SolverLock;

function positionKey(position: PitchLock["position"]): string {
  return `${position.performanceMeasureIndex}:${position.offset.n}/${position.offset.d}`;
}

function phraseIdAt(project: HarmonyProject, position: PitchLock["position"]): string | undefined {
  return project.source.phraseRegions.find((phrase) => comparePositions(phrase.range.start, position) <= 0 && comparePositions(position, phrase.range.end) < 0)?.id;
}

export function canonicalLockTargets(input: {
  readonly project: HarmonyProject;
  readonly intentPlan: ArrangementIntentPlan;
  readonly activityPlan: ArrangementActivityPlan;
  readonly anchorPlan: ArrangementAnchorPlan;
  readonly candidate?: ArrangementCandidate;
}): readonly CanonicalLockTarget[] {
  const targets: CanonicalLockTarget[] = [];
  for (const phrase of input.intentPlan.phraseIntents) {
    targets.push({ key: `intent:texture:${phrase.phraseId}`, stage: "intent", kind: "texture", phraseId: phrase.phraseId, label: `${phrase.phraseId} · texture`, defaultTexture: phrase.textureId });
    for (const role of phrase.trackRoles) targets.push({ key: `intent:placement:${phrase.phraseId}:${role.trackPlanId}`, stage: "intent", kind: "placement-role", phraseId: phrase.phraseId, trackPlanId: role.trackPlanId, label: `${phrase.phraseId} · ${role.trackPlanId} · placement`, defaultPlacementRole: role.placementRole });
  }
  for (const phrase of input.activityPlan.phraseActivityPlans) {
    for (const span of phrase.activitySpans) targets.push({ key: `activity:${phrase.phraseId}:${span.trackPlanId}:${positionKey(span.range.start)}:${positionKey(span.range.end)}`, stage: "activity", kind: "activity", phraseId: phrase.phraseId, trackPlanId: span.trackPlanId, label: `${phrase.phraseId} · ${span.trackPlanId} · ${positionKey(span.range.start)}–${positionKey(span.range.end)}`, range: span.range, defaultActivity: span.activity });
  }
  for (const phrase of input.anchorPlan.phraseAnchorPlans) {
    for (const directive of phrase.anchorDirectives) targets.push({ key: `anchor:${phrase.phraseId}:${directive.trackPlanId}:${positionKey(directive.position)}:${directive.id}`, stage: "anchor", kind: "anchor", phraseId: phrase.phraseId, trackPlanId: directive.trackPlanId, label: `${phrase.phraseId} · ${directive.trackPlanId} · ${positionKey(directive.position)} · ${directive.kind}`, directive, anchorPlan: input.anchorPlan });
  }
  if (input.candidate) {
    const trackOrdinal = Object.fromEntries(input.project.trackPlans.filter((track) => track.kind === "generated-harmony").map((track) => [track.id, track.canonicalOrdinal]));
    for (const [trackPlanId, events] of Object.entries(input.candidate.generatedEventsByTrack).sort(([left], [right]) => trackOrdinal[left] - trackOrdinal[right])) {
      for (const event of events) {
        if (event.kind !== "note") continue;
        const phraseId = phraseIdAt(input.project, event.range.start);
        if (phraseId) targets.push({ key: `solver:${phraseId}:${trackPlanId}:${positionKey(event.range.start)}:${event.id}`, stage: "solver", kind: "pitch", phraseId, trackPlanId, label: `${phraseId} · ${trackPlanId} · ${positionKey(event.range.start)} · ${event.id}`, position: event.range.start, defaultPitch: event.pitch });
      }
    }
  }
  return targets;
}

function endpoint(directive: HarmonyAnchorDirective): LockedAnchorEndpointSpec {
  if (directive.kind === "chord-tone") return { kind: "chord-tone", position: directive.position, chordSpanId: directive.chordSpanId, selectedTone: directive.selectedTone };
  if (directive.kind === "lead-derived") return { kind: "lead-derived", position: directive.position, leadAtom: directive.leadAtom, relation: directive.relation };
  throw new RangeError("STAGE_LOCK_SCOPE_INVALID");
}

function nctSpec(plan: NonChordTonePlan, directives: ReadonlyMap<string, HarmonyAnchorDirective>): LockedNonChordToneSpec {
  const preparation = directives.get(plan.preparationDirectiveId);
  const resolution = directives.get(plan.resolutionDirectiveId);
  if (!preparation || !resolution) throw new RangeError("STAGE_LOCK_SCOPE_INVALID");
  const common = { kind: plan.kind, contextChordSpanId: plan.contextChordSpanId, targetChordSpanId: plan.targetChordSpanId, preparation: endpoint(preparation), resolution: endpoint(resolution), resolutionDeadline: plan.resolutionDeadline };
  switch (plan.kind) {
    case "passing":
    case "neighbor": return { ...common, kind: plan.kind, direction: plan.direction };
    case "anticipation": return { ...common, kind: plan.kind };
    case "suspension": return { ...common, kind: plan.kind, resolutionDirection: plan.resolutionDirection };
  }
}

export function lockFromCanonicalTarget(input: {
  readonly presetId: ArrangementPresetId;
  readonly target: CanonicalLockTarget;
  readonly ordinal: number;
  readonly texture?: TexturePatternId;
  readonly placementRole?: VocalPlacementRole;
  readonly activity?: VoiceActivityDirective;
  readonly pitch?: SpelledPitch;
  readonly anchorTone?: ChordToneSpec;
  readonly anchorRelation?: "unison" | "octave";
}): UiStageLock {
  const { target } = input;
  const id = `lk:${input.presetId}:ui:${target.stage}:${input.ordinal}`;
  if (target.kind === "texture") return { id, kind: "texture", presetId: input.presetId, phraseId: target.phraseId, textureId: input.texture ?? target.defaultTexture };
  if (target.kind === "placement-role") return { id, kind: "placement-role", presetId: input.presetId, phraseId: target.phraseId, trackPlanId: target.trackPlanId, placementRole: input.placementRole ?? target.defaultPlacementRole };
  if (target.kind === "activity") return { id, kind: "activity", presetId: input.presetId, phraseId: target.phraseId, trackPlanId: target.trackPlanId, range: target.range, activity: input.activity ?? target.defaultActivity };
  if (target.kind === "pitch") return { id, kind: "pitch", presetId: input.presetId, phraseId: target.phraseId, trackPlanId: target.trackPlanId, position: target.position, pitch: input.pitch ?? target.defaultPitch };
  const directive = target.directive;
  if (directive.kind === "chord-tone") return { id, kind: "anchor-chord-tone", presetId: input.presetId, phraseId: target.phraseId, trackPlanId: target.trackPlanId, position: directive.position, chordSpanId: directive.chordSpanId, selectedTone: input.anchorTone ?? directive.selectedTone };
  if (directive.kind === "lead-derived") return { id, kind: "anchor-lead-derived", presetId: input.presetId, phraseId: target.phraseId, trackPlanId: target.trackPlanId, position: directive.position, leadAtom: directive.leadAtom, relation: input.anchorRelation ?? directive.relation };
  const phrase = target.anchorPlan.phraseAnchorPlans.find((candidate) => candidate.phraseId === target.phraseId);
  const plan = phrase?.nctPlans.find((candidate) => candidate.id === directive.nctPlanId);
  if (!phrase || !plan) throw new RangeError("STAGE_LOCK_SCOPE_INVALID");
  const directives = new Map(phrase.anchorDirectives.map((candidate) => [candidate.id, candidate]));
  return { id, kind: "anchor-planned-nct", presetId: input.presetId, phraseId: target.phraseId, trackPlanId: target.trackPlanId, position: directive.position, nctSpec: nctSpec(plan, directives) };
}

export function canonicalLockScopeKey(lock: UiStageLock): string {
  if (lock.kind === "texture") return `intent:texture:${lock.phraseId}`;
  if (lock.kind === "placement-role") return `intent:placement:${lock.phraseId}:${lock.trackPlanId}`;
  if (lock.kind === "activity") return `activity:${lock.phraseId}:${lock.trackPlanId}:${positionKey(lock.range.start)}:${positionKey(lock.range.end)}`;
  if (lock.kind.startsWith("anchor-")) return `anchor:${lock.phraseId}:${lock.trackPlanId}:${positionKey(lock.position)}`;
  return `solver:${lock.phraseId}:${lock.trackPlanId}:${positionKey(lock.position)}`;
}

export function upsertCanonicalStageLock(locks: readonly UiStageLock[], lock: UiStageLock): readonly UiStageLock[] {
  const scope = canonicalLockScopeKey(lock);
  return [...locks.filter((candidate) => canonicalLockScopeKey(candidate) !== scope), lock];
}

export function outputEditTargetId(edit: ArrangementOutputEdit): string { return edit.kind === "replace-event" ? edit.oldEventId : edit.eventId; }

export function staleBoundaryPresentation(stage: "intent" | "activity" | "anchor" | "generation" | "none"): string {
  if (stage === "none") return "none · active artifacts are current";
  const flow = stage === "intent" ? "Intent → Activity → Anchor → Solver → assembly → Validator"
    : stage === "activity" ? "Activity → Anchor → Solver → assembly → Validator"
      : stage === "anchor" ? "Anchor → Solver → assembly → Validator"
        : "Solver → assembly → Validator";
  return `staleFrom=${stage} · regenerate ${flow}`;
}

export function stageForTarget(target: CanonicalLockTarget): LockStage { return target.stage; }
