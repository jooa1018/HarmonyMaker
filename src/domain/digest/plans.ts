import type {
  ArrangementActivityPlan, ArrangementAnchorPlan, ArrangementIntentPlan,
  HarmonyAnchorDirective, NonChordTonePlan, PhraseAnchorPlan,
} from "../plans";
import { comparePositions } from "../time";
import {
  canonicalJson, compareCanonicalValues, semanticDigest, type SemanticDigest,
} from "./canonical";

export interface PlanOrdinalRegistry {
  readonly sectionOccurrenceOrdinalById: Readonly<Record<string, number>>;
  readonly phraseOrdinalById: Readonly<Record<string, number>>;
  readonly trackOrdinalById: Readonly<Record<string, number>>;
  readonly leadAtomOrdinalById: Readonly<Record<string, number>>;
  readonly chordSpanOrdinalById: Readonly<Record<string, number>>;
}

interface Projected<T> {
  readonly value: T;
  readonly projection: object;
}

function ordinal(record: Readonly<Record<string, number>>, id: string): number {
  const value = record[id];
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`missing canonical ordinal for ${id}`);
  }
  return value;
}

function canonicalProjected<T>(
  values: readonly T[],
  project: (value: T) => object,
): readonly Projected<T>[] {
  return values
    .map((value) => ({ value, projection: project(value) }))
    .sort((left, right) => compareCanonicalValues(left.projection, right.projection));
}

function assertUniqueIds(values: readonly { readonly id: string }[], label: string): void {
  if (new Set(values.map((value) => value.id)).size !== values.length) {
    throw new RangeError(`duplicate ${label} ID`);
  }
}

export async function digestIntentPlan(
  plan: ArrangementIntentPlan,
  ordinals: PlanOrdinalRegistry,
): Promise<SemanticDigest> {
  assertUniqueIds(plan.sectionIntents, "section intent");
  assertUniqueIds(plan.phraseIntents, "phrase intent");
  const sectionIntents = canonicalProjected(plan.sectionIntents, (intent) => ({
    sectionOccurrenceOrdinal: ordinal(
      ordinals.sectionOccurrenceOrdinalById,
      intent.sectionOccurrenceId,
    ),
    intensityTarget: intent.intensityTarget,
  }));
  const sectionIntentOrdinalById = Object.fromEntries(
    sectionIntents.map((entry, index) => [entry.value.id, index]),
  );
  const phraseIntents = canonicalProjected(plan.phraseIntents, (intent) => ({
    phraseOrdinal: ordinal(ordinals.phraseOrdinalById, intent.phraseId),
    sectionIntentOrdinal: ordinal(sectionIntentOrdinalById, intent.sectionIntentId),
    textureId: intent.textureId,
    harmonyExpectation: intent.harmonyExpectation,
    trackRoles: canonicalProjected(intent.trackRoles, (role) => ({
      trackOrdinal: ordinal(ordinals.trackOrdinalById, role.trackPlanId),
      placementRole: role.placementRole,
    })).map((entry) => entry.projection),
    lyricPolicy: intent.lyricPolicy,
    cadencePolicy: intent.cadencePolicy,
    splitPosition: intent.splitDirective?.position ?? null,
  }));
  return semanticDigest({
    projectionSchema: "hm-arrangement-intent-plan-v1",
    presetId: plan.presetId,
    intentInputDigest: plan.intentInputDigest,
    effectiveChordTimelineDigest: plan.effectiveChordTimelineDigest,
    sourceLeadAtomizationDigest: plan.sourceLeadAtomizationDigest,
    effectiveConfigDigest: plan.effectiveConfigDigest,
    presetProfileVersion: plan.presetProfileVersion,
    presetProfileDigest: plan.presetProfileDigest,
    grammarVersion: plan.grammarVersion,
    plannerVersion: plan.plannerVersion,
    grammarConfigDigest: plan.grammarConfigDigest,
    plannerConfigDigest: plan.plannerConfigDigest,
    diagnosticRegistryVersion: plan.diagnosticRegistryVersion,
    diagnosticRegistryDigest: plan.diagnosticRegistryDigest,
    sectionIntents: sectionIntents.map((entry) => entry.projection),
    phraseIntents: phraseIntents.map((entry) => entry.projection),
  });
}

export async function digestActivityPlan(
  plan: ArrangementActivityPlan,
  ordinals: PlanOrdinalRegistry,
): Promise<SemanticDigest> {
  assertUniqueIds(plan.phraseActivityPlans, "phrase activity plan");
  const phrasePlans = canonicalProjected(plan.phraseActivityPlans, (phrase) => ({
    phraseOrdinal: ordinal(ordinals.phraseOrdinalById, phrase.phraseId),
    spans: canonicalProjected(phrase.activitySpans, (span) => ({
      trackOrdinal: ordinal(ordinals.trackOrdinalById, span.trackPlanId),
      range: span.range,
      activity: span.activity,
    })).map((entry) => entry.projection),
    attacks: canonicalProjected(phrase.attackEvents, (attack) => ({
      trackOrdinal: ordinal(ordinals.trackOrdinalById, attack.trackPlanId),
      position: attack.position,
      kind: attack.kind,
    })).map((entry) => entry.projection),
  }));
  return semanticDigest({
    projectionSchema: "hm-arrangement-activity-plan-v1",
    presetId: plan.presetId,
    intentPlanDigest: plan.intentPlanDigest,
    activityInputDigest: plan.activityInputDigest,
    activityPlannerVersion: plan.activityPlannerVersion,
    activityPlannerConfigDigest: plan.activityPlannerConfigDigest,
    diagnosticRegistryVersion: plan.diagnosticRegistryVersion,
    diagnosticRegistryDigest: plan.diagnosticRegistryDigest,
    sourceLeadAtomizationDigest: plan.sourceLeadAtomizationDigest,
    effectiveConfigDigest: plan.effectiveConfigDigest,
    presetProfileDigest: plan.presetProfileDigest,
    phrasePlans: phrasePlans.map((entry) => entry.projection),
  });
}

function directiveProjection(
  directive: HarmonyAnchorDirective,
  ordinals: PlanOrdinalRegistry,
  nctPlanOrdinalById?: Readonly<Record<string, number>>,
): object {
  const common = {
    kind: directive.kind,
    trackOrdinal: ordinal(ordinals.trackOrdinalById, directive.trackPlanId),
    position: directive.position,
  };
  if (directive.kind === "chord-tone") {
    return {
      ...common,
      chordSpanOrdinal: ordinal(ordinals.chordSpanOrdinalById, directive.chordSpanId),
      selectedTone: directive.selectedTone,
    };
  }
  if (directive.kind === "lead-derived") {
    return {
      ...common,
      leadAtomOrdinal: ordinal(ordinals.leadAtomOrdinalById, directive.leadAtom.leadAtomId),
      sourceLeadAtomizationDigest: directive.leadAtom.sourceLeadAtomizationDigest,
      relation: directive.relation,
    };
  }
  if (!nctPlanOrdinalById) throw new RangeError("planned NCT ordinal registry is required");
  return {
    ...common,
    contextChordSpanOrdinal: ordinal(
      ordinals.chordSpanOrdinalById,
      directive.contextChordSpanId,
    ),
    nctPlanOrdinal: ordinal(nctPlanOrdinalById, directive.nctPlanId),
  };
}

function nctProjection(
  nct: NonChordTonePlan,
  directiveOrdinalById: Readonly<Record<string, number>>,
  ordinals: PlanOrdinalRegistry,
): object {
  const common = {
    kind: nct.kind,
    trackOrdinal: ordinal(ordinals.trackOrdinalById, nct.trackPlanId),
    position: nct.position,
    contextChordSpanOrdinal: ordinal(ordinals.chordSpanOrdinalById, nct.contextChordSpanId),
    targetChordSpanOrdinal: ordinal(ordinals.chordSpanOrdinalById, nct.targetChordSpanId),
    preparationDirectiveOrdinal: ordinal(directiveOrdinalById, nct.preparationDirectiveId),
    resolutionDirectiveOrdinal: ordinal(directiveOrdinalById, nct.resolutionDirectiveId),
    resolutionDeadline: nct.resolutionDeadline,
  };
  return nct.kind === "passing" || nct.kind === "neighbor"
    ? { ...common, direction: nct.direction }
    : nct.kind === "suspension"
      ? { ...common, resolutionDirection: nct.resolutionDirection }
      : common;
}

function assertAnchorGraph(
  plan: ArrangementAnchorPlan,
  phrase: PhraseAnchorPlan,
): void {
  assertUniqueIds(phrase.anchorDirectives, "anchor directive");
  assertUniqueIds(phrase.nctPlans, "NCT plan");
  const directiveById = new Map(phrase.anchorDirectives.map((item) => [item.id, item]));
  const nctById = new Map(phrase.nctPlans.map((item) => [item.id, item]));
  const planned = phrase.anchorDirectives.filter((item) => item.kind === "planned-nct");
  if (planned.length !== phrase.nctPlans.length
    || new Set(planned.map((item) => item.nctPlanId)).size !== planned.length
    || planned.some((item) => !nctById.has(item.nctPlanId))) {
    throw new RangeError("ANCHOR_LOCK_INVALID:NCT directive linkage");
  }
  for (const directive of phrase.anchorDirectives) {
    if (directive.kind === "lead-derived"
      && directive.leadAtom.sourceLeadAtomizationDigest !== plan.sourceLeadAtomizationDigest) {
      throw new RangeError("ANCHOR_LOCK_INVALID:lead atom digest mismatch");
    }
    if (directive.kind !== "planned-nct") continue;
    const nct = nctById.get(directive.nctPlanId);
    if (!nct
      || nct.trackPlanId !== directive.trackPlanId
      || nct.contextChordSpanId !== directive.contextChordSpanId
      || comparePositions(nct.position, directive.position) !== 0) {
      throw new RangeError("ANCHOR_LOCK_INVALID:planned NCT mismatch");
    }
  }
  for (const nct of phrase.nctPlans) {
    const preparation = directiveById.get(nct.preparationDirectiveId);
    const resolution = directiveById.get(nct.resolutionDirectiveId);
    if (!preparation || !resolution
      || preparation.kind === "planned-nct"
      || resolution.kind === "planned-nct") {
      throw new RangeError("ANCHOR_LOCK_INVALID:dangling or cross-phrase NCT endpoint");
    }
    if (preparation.trackPlanId !== nct.trackPlanId
      || resolution.trackPlanId !== nct.trackPlanId) {
      throw new RangeError("ANCHOR_LOCK_INVALID:cross-track NCT endpoint");
    }
    if (comparePositions(preparation.position, nct.position) >= 0
      || comparePositions(nct.position, resolution.position) >= 0
      || comparePositions(resolution.position, nct.resolutionDeadline) > 0) {
      throw new RangeError("ANCHOR_LOCK_INVALID:NCT position mismatch");
    }
  }
}

function canonicalAnchorPhrase(
  plan: ArrangementAnchorPlan,
  phrase: PhraseAnchorPlan,
  ordinals: PlanOrdinalRegistry,
): object {
  assertAnchorGraph(plan, phrase);
  const nonPlanned = canonicalProjected(
    phrase.anchorDirectives.filter((item) => item.kind !== "planned-nct"),
    (item) => directiveProjection(item, ordinals),
  );
  const endpointSemanticOrdinal = Object.fromEntries(
    nonPlanned.map((entry, index) => [entry.value.id, index]),
  );
  const nctPlans = canonicalProjected(phrase.nctPlans, (nct) => {
    const common = {
      kind: nct.kind,
      trackOrdinal: ordinal(ordinals.trackOrdinalById, nct.trackPlanId),
      position: nct.position,
      contextChordSpanOrdinal: ordinal(ordinals.chordSpanOrdinalById, nct.contextChordSpanId),
      targetChordSpanOrdinal: ordinal(ordinals.chordSpanOrdinalById, nct.targetChordSpanId),
      preparationEndpointOrdinal: ordinal(endpointSemanticOrdinal, nct.preparationDirectiveId),
      resolutionEndpointOrdinal: ordinal(endpointSemanticOrdinal, nct.resolutionDirectiveId),
      resolutionDeadline: nct.resolutionDeadline,
    };
    return nct.kind === "passing" || nct.kind === "neighbor"
      ? { ...common, direction: nct.direction }
      : nct.kind === "suspension"
        ? { ...common, resolutionDirection: nct.resolutionDirection }
        : common;
  });
  const nctPlanOrdinalById = Object.fromEntries(
    nctPlans.map((entry, index) => [entry.value.id, index]),
  );
  const directives = canonicalProjected(
    phrase.anchorDirectives,
    (directive) => directiveProjection(directive, ordinals, nctPlanOrdinalById),
  );
  const directiveOrdinalById = Object.fromEntries(
    directives.map((entry, index) => [entry.value.id, index]),
  );
  return {
    phraseOrdinal: ordinal(ordinals.phraseOrdinalById, phrase.phraseId),
    directives: directives.map((entry) => entry.projection),
    nctPlans: nctPlans.map((entry) => nctProjection(
      entry.value,
      directiveOrdinalById,
      ordinals,
    )),
  };
}

export async function digestAnchorPlan(
  plan: ArrangementAnchorPlan,
  ordinals: PlanOrdinalRegistry,
): Promise<SemanticDigest> {
  assertUniqueIds(plan.phraseAnchorPlans, "phrase anchor plan");
  const allDirectives = plan.phraseAnchorPlans.flatMap((phrase) => phrase.anchorDirectives);
  const allNcts = plan.phraseAnchorPlans.flatMap((phrase) => phrase.nctPlans);
  assertUniqueIds(allDirectives, "global anchor directive");
  assertUniqueIds(allNcts, "global NCT plan");
  const phrasePlans = plan.phraseAnchorPlans
    .map((phrase) => canonicalAnchorPhrase(plan, phrase, ordinals))
    .sort(compareCanonicalValues);
  if (new Set(phrasePlans.map((item) => canonicalJson(item))).size !== phrasePlans.length) {
    throw new RangeError("duplicate semantic phrase anchor plan");
  }
  return semanticDigest({
    projectionSchema: "hm-arrangement-anchor-plan-v1",
    presetId: plan.presetId,
    activityPlanDigest: plan.activityPlanDigest,
    anchorInputDigest: plan.anchorInputDigest,
    anchorPlannerVersion: plan.anchorPlannerVersion,
    anchorPlannerConfigDigest: plan.anchorPlannerConfigDigest,
    diagnosticRegistryVersion: plan.diagnosticRegistryVersion,
    diagnosticRegistryDigest: plan.diagnosticRegistryDigest,
    sourceLeadAtomizationDigest: plan.sourceLeadAtomizationDigest,
    effectiveConfigDigest: plan.effectiveConfigDigest,
    presetProfileDigest: plan.presetProfileDigest,
    phrasePlans,
  });
}
