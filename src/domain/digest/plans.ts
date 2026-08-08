import type { ArrangementActivityPlan, ArrangementAnchorPlan, ArrangementIntentPlan, HarmonyAnchorDirective, NonChordTonePlan } from "../plans";
import { semanticDigest, type SemanticDigest } from "./canonical";

export interface PlanOrdinalRegistry { readonly sectionOccurrenceOrdinalById: Readonly<Record<string, number>>; readonly phraseOrdinalById: Readonly<Record<string, number>>; readonly trackOrdinalById: Readonly<Record<string, number>>; readonly leadAtomOrdinalById: Readonly<Record<string, number>>; readonly chordSpanOrdinalById: Readonly<Record<string, number>> }
function ordinal(record: Readonly<Record<string, number>>, id: string): number {
  const value = record[id];
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`missing canonical ordinal for ${id}`);
  return value;
}
export async function digestIntentPlan(plan: ArrangementIntentPlan, ordinals: PlanOrdinalRegistry): Promise<SemanticDigest> {
  const sectionIntentOrdinal = new Map(plan.sectionIntents.map((intent, index) => [intent.id, index]));
  return semanticDigest({
    projectionSchema: "hm-arrangement-intent-plan-v1", presetId: plan.presetId, intentInputDigest: plan.intentInputDigest, effectiveChordTimelineDigest: plan.effectiveChordTimelineDigest, sourceLeadAtomizationDigest: plan.sourceLeadAtomizationDigest, effectiveConfigDigest: plan.effectiveConfigDigest, presetProfileVersion: plan.presetProfileVersion, presetProfileDigest: plan.presetProfileDigest, grammarVersion: plan.grammarVersion, plannerVersion: plan.plannerVersion, grammarConfigDigest: plan.grammarConfigDigest, plannerConfigDigest: plan.plannerConfigDigest, diagnosticRegistryVersion: plan.diagnosticRegistryVersion, diagnosticRegistryDigest: plan.diagnosticRegistryDigest,
    sectionIntents: plan.sectionIntents.map((intent) => ({ sectionOccurrenceOrdinal: ordinal(ordinals.sectionOccurrenceOrdinalById, intent.sectionOccurrenceId), intensityTarget: intent.intensityTarget })),
    phraseIntents: plan.phraseIntents.map((intent) => ({ phraseOrdinal: ordinal(ordinals.phraseOrdinalById, intent.phraseId), sectionIntentOrdinal: sectionIntentOrdinal.get(intent.sectionIntentId), textureId: intent.textureId, trackRoles: intent.trackRoles.map((role) => ({ trackOrdinal: ordinal(ordinals.trackOrdinalById, role.trackPlanId), placementRole: role.placementRole })), lyricPolicy: intent.lyricPolicy, cadencePolicy: intent.cadencePolicy, splitPosition: intent.splitDirective?.position ?? null })),
  });
}
export async function digestActivityPlan(plan: ArrangementActivityPlan, ordinals: PlanOrdinalRegistry): Promise<SemanticDigest> {
  return semanticDigest({ projectionSchema: "hm-arrangement-activity-plan-v1", presetId: plan.presetId, intentPlanDigest: plan.intentPlanDigest, activityInputDigest: plan.activityInputDigest, activityPlannerVersion: plan.activityPlannerVersion, activityPlannerConfigDigest: plan.activityPlannerConfigDigest, diagnosticRegistryVersion: plan.diagnosticRegistryVersion, diagnosticRegistryDigest: plan.diagnosticRegistryDigest, sourceLeadAtomizationDigest: plan.sourceLeadAtomizationDigest, effectiveConfigDigest: plan.effectiveConfigDigest, presetProfileDigest: plan.presetProfileDigest, phrasePlans: plan.phraseActivityPlans.map((phrase) => ({ phraseOrdinal: ordinal(ordinals.phraseOrdinalById, phrase.phraseId), spans: phrase.activitySpans.map((span) => ({ trackOrdinal: ordinal(ordinals.trackOrdinalById, span.trackPlanId), range: span.range, activity: span.activity })), attacks: phrase.attackEvents.map((attack) => ({ trackOrdinal: ordinal(ordinals.trackOrdinalById, attack.trackPlanId), position: attack.position, kind: attack.kind })) })) });
}
function directiveProjection(directive: HarmonyAnchorDirective, ordinals: PlanOrdinalRegistry): object {
  const common = { kind: directive.kind, trackOrdinal: ordinal(ordinals.trackOrdinalById, directive.trackPlanId), position: directive.position };
  if (directive.kind === "chord-tone") return { ...common, chordSpanOrdinal: ordinal(ordinals.chordSpanOrdinalById, directive.chordSpanId), selectedTone: directive.selectedTone };
  if (directive.kind === "lead-derived") return { ...common, leadAtomOrdinal: ordinal(ordinals.leadAtomOrdinalById, directive.leadAtom.leadAtomId), sourceLeadAtomizationDigest: directive.leadAtom.sourceLeadAtomizationDigest, relation: directive.relation };
  return { ...common, contextChordSpanOrdinal: ordinal(ordinals.chordSpanOrdinalById, directive.contextChordSpanId) };
}
function nctProjection(nct: NonChordTonePlan, directiveOrdinalById: Readonly<Record<string, number>>, ordinals: PlanOrdinalRegistry): object {
  const common = { kind: nct.kind, trackOrdinal: ordinal(ordinals.trackOrdinalById, nct.trackPlanId), position: nct.position, contextChordSpanOrdinal: ordinal(ordinals.chordSpanOrdinalById, nct.contextChordSpanId), targetChordSpanOrdinal: ordinal(ordinals.chordSpanOrdinalById, nct.targetChordSpanId), preparationDirectiveOrdinal: ordinal(directiveOrdinalById, nct.preparationDirectiveId), resolutionDirectiveOrdinal: ordinal(directiveOrdinalById, nct.resolutionDirectiveId), resolutionDeadline: nct.resolutionDeadline };
  return nct.kind === "passing" || nct.kind === "neighbor" ? { ...common, direction: nct.direction } : nct.kind === "suspension" ? { ...common, resolutionDirection: nct.resolutionDirection } : common;
}
export async function digestAnchorPlan(plan: ArrangementAnchorPlan, ordinals: PlanOrdinalRegistry): Promise<SemanticDigest> {
  const directives = plan.phraseAnchorPlans.flatMap((phrase) => phrase.anchorDirectives);
  const directiveOrdinalById = Object.fromEntries(directives.map((directive, index) => [directive.id, index]));
  return semanticDigest({ projectionSchema: "hm-arrangement-anchor-plan-v1", presetId: plan.presetId, activityPlanDigest: plan.activityPlanDigest, anchorInputDigest: plan.anchorInputDigest, anchorPlannerVersion: plan.anchorPlannerVersion, anchorPlannerConfigDigest: plan.anchorPlannerConfigDigest, diagnosticRegistryVersion: plan.diagnosticRegistryVersion, diagnosticRegistryDigest: plan.diagnosticRegistryDigest, sourceLeadAtomizationDigest: plan.sourceLeadAtomizationDigest, effectiveConfigDigest: plan.effectiveConfigDigest, presetProfileDigest: plan.presetProfileDigest, phrasePlans: plan.phraseAnchorPlans.map((phrase) => ({ phraseOrdinal: ordinal(ordinals.phraseOrdinalById, phrase.phraseId), directives: phrase.anchorDirectives.map((directive) => directiveProjection(directive, ordinals)), nctPlans: phrase.nctPlans.map((nct) => nctProjection(nct, directiveOrdinalById, ordinals)) })) });
}
