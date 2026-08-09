import {
  canonicalJson,
  semanticId,
  type SemanticDigest,
} from "../../domain/digest/canonical";
import {
  digestActivityPlan,
  digestAnchorPlan,
  digestIntentPlan,
} from "../../domain/digest/plans";
import {
  digestActivityInput,
  digestAnchorInput,
} from "../../domain/digest/stages";
import {
  addFractions,
  compareFractions,
  fraction,
  subtractFractions,
  type Fraction,
} from "../../domain/fraction";
import type { AnchorLock } from "../../domain/locks";
import {
  durationRate,
  extendedCountRate,
} from "../../domain/rates";
import type {
  ArrangementActivityPlan,
  ArrangementAnchorPlan,
  ArrangementIntentPlan,
  HarmonyAnchorDirective,
  NonChordTonePlan,
  PhraseActivityPlan,
  PhraseAnchorPlan,
  PhraseArrangementIntent,
  SectionArrangementIntent,
  VoiceActivityDirective,
  VoiceActivitySpan,
  VoiceAttackEvent,
} from "../../domain/plans";
import { comparePositions, compareRanges } from "../../domain/time";
import {
  createIntentWitness,
  verifyIntentWitness,
} from "./authority";
import {
  RC7_GRAMMAR_CONFIG_DIGEST,
  RC7_GRAMMAR_ID,
  RC7_GRAMMAR_VERSION,
  RC7_REVIEW_VERSIONS,
} from "./constants";
import {
  planRc7Phrase,
  reconstructWinningOpportunity,
} from "./grammar";
import {
  positionInRange,
  positionToGlobalQ,
  rangeDurationQ,
} from "./music";
import { measureDurationsForCase } from "./prepare";
import type {
  Rc7GrammarSelection,
  Rc7IntentInputReconstructionWitness,
  Rc7PipelineContext,
  Rc7ScoredOpportunity,
  Rc7VerifiedAssignedTrack,
} from "./types";

const EMPTY_DIGEST = "0".repeat(64) as SemanticDigest;

export interface Rc7IntentStageResult {
  readonly plan: ArrangementIntentPlan;
  readonly serializedAuthoritativePlan: string;
  readonly reloadedPlan: ArrangementIntentPlan;
  readonly witness: Rc7IntentInputReconstructionWitness;
  readonly assignedTracks: readonly Rc7VerifiedAssignedTrack[];
  readonly selection: Rc7GrammarSelection;
  readonly rehydratedSelection: Rc7GrammarSelection;
  readonly rehydratedWinner: Rc7ScoredOpportunity;
}

export interface Rc7ActivityStageResult {
  readonly plan: ArrangementActivityPlan;
  readonly winner: Rc7ScoredOpportunity;
  readonly rehydratedOpportunityKey: string;
}

export interface Rc7AnchorStageResult {
  readonly plan: ArrangementAnchorPlan;
  readonly winner: Rc7ScoredOpportunity;
}

function splitReason(
  reason: Rc7ScoredOpportunity["splitReason"],
): "LATE_LONG_NOTE" | "LATE_CHORD_CHANGE" | "CONFIRMED_LYRIC_EMPHASIS" | "PHRASE_MIDPOINT" {
  return reason ?? "PHRASE_MIDPOINT";
}

function orderedTrackRoles(
  intent: PhraseArrangementIntent,
  context: Rc7PipelineContext,
): readonly PhraseArrangementIntent["trackRoles"][number][] {
  return [...intent.trackRoles].sort((left, right) => (
    context.ordinals.trackOrdinalById[left.trackPlanId]
      - context.ordinals.trackOrdinalById[right.trackPlanId]
  ));
}

async function sectionIntent(
  context: Rc7PipelineContext,
  selection: Rc7GrammarSelection,
): Promise<SectionArrangementIntent> {
  return {
    id: await semanticId("section-intent", {
      presetId: context.prepared.presetId,
      sectionOccurrenceOrdinal: 0,
      intensityTarget: selection.intensityTarget,
      grammarVersion: RC7_GRAMMAR_VERSION,
    }),
    sectionOccurrenceId: context.prepared.sectionOccurrence.id,
    presetId: context.prepared.presetId,
    intensityTarget: selection.intensityTarget,
    grammarRuleIds: ["WAGV1_RC7_SECTION_INTENSITY"],
  };
}

async function phraseIntent(
  context: Rc7PipelineContext,
  section: SectionArrangementIntent,
  winner: Rc7ScoredOpportunity,
): Promise<PhraseArrangementIntent> {
  const trackRoles = await Promise.all(winner.activeTrackPlanIds.map(async (trackPlanId, index) => ({
    id: await semanticId("track-role", {
      phraseOrdinal: 0,
      trackOrdinal: winner.activeTrackOrdinals[index],
      placementRole: winner.roleByTrackPlanId[trackPlanId],
      opportunityKey: winner.key,
    }),
    phraseId: context.prepared.phrase.id,
    trackPlanId,
    placementRole: winner.roleByTrackPlanId[trackPlanId],
  })));
  return {
    id: await semanticId("phrase-intent", {
      phraseOrdinal: 0,
      textureId: winner.textureId,
      activeTrackOrdinals: winner.activeTrackOrdinals,
      roleTuple: winner.semanticPayload.roleTuple,
      lyricPolicy: winner.semanticPayload.lyricPolicy,
      cadencePolicy: winner.cadencePolicy,
      splitPositionOrNull: winner.semanticPayload.splitPositionOrNull,
    }),
    phraseId: context.prepared.phrase.id,
    presetId: context.prepared.presetId,
    sectionIntentId: section.id,
    textureId: winner.textureId,
    trackRoles,
    lyricPolicy: winner.semanticPayload.lyricPolicy,
    cadencePolicy: winner.cadencePolicy,
    ...(winner.semanticPayload.splitPositionOrNull === null
      ? {}
      : {
          splitDirective: {
            position: winner.semanticPayload.splitPositionOrNull,
            reasonCode: splitReason(winner.splitReason),
          },
        }),
    grammarRuleIds: [
      RC7_REVIEW_VERSIONS.responseSelectorVersion,
      winner.semanticPayload.responseConstructorId,
    ],
  };
}

async function buildIntentPlan(
  context: Rc7PipelineContext,
  intentInputDigest: SemanticDigest,
  selection: Rc7GrammarSelection,
): Promise<ArrangementIntentPlan> {
  const section = await sectionIntent(context, selection);
  const phrase = await phraseIntent(context, section, selection.winner);
  const base: ArrangementIntentPlan = {
    stage: "intent",
    presetId: context.prepared.presetId,
    intentInputDigest,
    effectiveChordTimelineDigest: context.prepared.effectiveChordTimeline.digest,
    sourceLeadAtomizationDigest: context.prepared.sourceLeadAtomization.digest,
    effectiveConfigDigest: context.effectiveConfig.digest,
    presetProfileVersion: context.effectiveConfig.presetProfileVersion,
    presetProfileDigest: context.effectiveConfig.presetProfileDigest,
    grammarId: RC7_GRAMMAR_ID,
    grammarVersion: RC7_GRAMMAR_VERSION,
    plannerVersion: RC7_REVIEW_VERSIONS.plannerVersion,
    grammarConfigDigest: RC7_GRAMMAR_CONFIG_DIGEST as SemanticDigest,
    plannerConfigDigest: context.plannerConfigDigest,
    diagnosticRegistryVersion: RC7_REVIEW_VERSIONS.diagnosticRegistryVersion,
    diagnosticRegistryDigest: context.diagnosticRegistryDigest,
    sectionIntents: [section],
    phraseIntents: [phrase],
    intentPlanDigest: EMPTY_DIGEST,
  };
  return { ...base, intentPlanDigest: await digestIntentPlan(base, context.ordinals) };
}

function reconstructFromIntent(
  selection: Rc7GrammarSelection,
  intent: PhraseArrangementIntent,
  context: Rc7PipelineContext,
): Rc7ScoredOpportunity {
  const roles = orderedTrackRoles(intent, context);
  const trackOrdinals = roles.map((role) => context.ordinals.trackOrdinalById[role.trackPlanId]);
  const roleTuple = roles.map((role) => role.placementRole);
  const candidates = selection.opportunities.filter((candidate) => (
    candidate.textureId === intent.textureId
      && canonicalJson(candidate.activeTrackOrdinals) === canonicalJson(trackOrdinals)
      && canonicalJson(candidate.semanticPayload.roleTuple) === canonicalJson(roleTuple)
      && candidate.semanticPayload.lyricPolicy === intent.lyricPolicy
      && candidate.cadencePolicy === intent.cadencePolicy
      && canonicalJson(candidate.semanticPayload.splitPositionOrNull)
        === canonicalJson(intent.splitDirective?.position ?? null)
  ));
  const reconstructed = reconstructWinningOpportunity(
    selection,
    intent,
    trackOrdinals,
    roleTuple,
  );
  if (!candidates.some((candidate) => candidate.key === reconstructed.key)) {
    throw new RangeError("ACTIVITY_SPAN_INVALID:opportunity reconstruction drift");
  }
  return reconstructed;
}

export async function runRc7IntentStage(
  context: Rc7PipelineContext,
): Promise<Rc7IntentStageResult> {
  const { digest, witness } = await createIntentWitness(context);
  const assignedTracks = await verifyIntentWitness(context, digest, witness);
  const selection = await planRc7Phrase(context, assignedTracks);
  const plan = await buildIntentPlan(context, digest, selection);

  // This string is the only persisted-like boundary in the harness. It contains
  // authoritative plan semantics only: no opportunity list, cache, or trace.
  const serializedAuthoritativePlan = canonicalJson(plan);
  const reloadedPlan = JSON.parse(serializedAuthoritativePlan) as ArrangementIntentPlan;
  if ("grammarTrace" in reloadedPlan || await digestIntentPlan(reloadedPlan, context.ordinals) !== plan.intentPlanDigest) {
    throw new RangeError("STALE_REFERENCE:serialized Intent authority");
  }

  const verifiedAfterReload = await verifyIntentWitness(
    context,
    reloadedPlan.intentInputDigest,
    witness,
  );
  const rehydratedSelection = await planRc7Phrase(context, verifiedAfterReload);
  const reloadedPhrase = reloadedPlan.phraseIntents[0];
  if (!reloadedPhrase) throw new RangeError("STALE_REFERENCE:missing PhraseIntent");
  const rehydratedWinner = reconstructFromIntent(rehydratedSelection, reloadedPhrase, context);
  if (rehydratedWinner.key !== selection.winner.key) {
    throw new RangeError("ACTIVITY_SPAN_INVALID:Grammar winner parity");
  }
  return {
    plan,
    serializedAuthoritativePlan,
    reloadedPlan,
    witness,
    assignedTracks: verifiedAfterReload,
    selection,
    rehydratedSelection,
    rehydratedWinner,
  };
}

function activityDirective(span: Rc7ScoredOpportunity["responseByTrackPlanId"][string][number]): VoiceActivityDirective {
  if (span.behavior === "rest") return { state: "rest" };
  if (span.behavior === "unison-double" || span.behavior === "octave-double") {
    return { state: "lead-derived", behavior: span.behavior };
  }
  if (span.behavior === "sustained-pad") {
    return { state: "sustain", behavior: "sustained-pad" };
  }
  return { state: "independent-note", behavior: "independent-harmony" };
}

interface GlobalInterval {
  readonly start: Fraction;
  readonly end: Fraction;
}

function mergedIntervals(intervals: readonly GlobalInterval[]): readonly GlobalInterval[] {
  const ordered = [...intervals].sort((left, right) => compareFractions(left.start, right.start)
    || compareFractions(left.end, right.end));
  const result: GlobalInterval[] = [];
  for (const interval of ordered) {
    const previous = result.at(-1);
    if (!previous || compareFractions(interval.start, previous.end) > 0) {
      result.push(interval);
    } else if (compareFractions(interval.end, previous.end) > 0) {
      result[result.length - 1] = { start: previous.start, end: interval.end };
    }
  }
  return result;
}

function intervalDuration(intervals: readonly GlobalInterval[]): Fraction {
  return intervals.reduce(
    (total, interval) => addFractions(total, subtractFractions(interval.end, interval.start)),
    fraction(0),
  );
}

function overlapDuration(left: readonly GlobalInterval[], right: readonly GlobalInterval[]): Fraction {
  let total = fraction(0);
  for (const a of left) {
    for (const b of right) {
      const start = compareFractions(a.start, b.start) >= 0 ? a.start : b.start;
      const end = compareFractions(a.end, b.end) <= 0 ? a.end : b.end;
      if (compareFractions(start, end) < 0) total = addFractions(total, subtractFractions(end, start));
    }
  }
  return total;
}

function activityMetrics(
  context: Rc7PipelineContext,
  selection: Rc7GrammarSelection,
  spans: readonly VoiceActivitySpan[],
  attacks: readonly VoiceAttackEvent[],
) {
  const durations = measureDurationsForCase(context.prepared);
  const phraseDuration = rangeDurationQ(context.prepared.phrase.range, durations);
  const active = mergedIntervals(spans
    .filter((span) => span.activity.state !== "rest")
    .map((span) => ({
      start: positionToGlobalQ(span.range.start, durations),
      end: positionToGlobalQ(span.range.end, durations),
    })));
  const leadRests = mergedIntervals(context.prepared.sourceLeadAtomization.atoms
    .filter((atom) => atom.pitch === null)
    .map((atom) => ({
      start: positionToGlobalQ(atom.range.start, durations),
      end: positionToGlobalQ(atom.range.end, durations),
    })));
  const activeTrackCount = new Set(
    spans.filter((span) => span.activity.state !== "rest").map((span) => span.trackPlanId),
  ).size;
  return {
    participationCoverage: durationRate(intervalDuration(active), phraseDuration),
    harmonyAttackRatio: extendedCountRate(attacks.filter((attack) => attack.kind === "attack").length,
      selection.features.leadAttackCount),
    harmonyOverLeadRestCoverage: durationRate(overlapDuration(active, leadRests), phraseDuration),
    maxSimultaneousHarmonyTracks: Math.min(2, activeTrackCount) as 0 | 1 | 2,
  };
}

async function activityPlanForWinner(
  context: Rc7PipelineContext,
  intent: ArrangementIntentPlan,
  selection: Rc7GrammarSelection,
  winner: Rc7ScoredOpportunity,
): Promise<ArrangementActivityPlan> {
  const spans: VoiceActivitySpan[] = [];
  const attacks: VoiceAttackEvent[] = [];
  for (const [trackIndex, trackPlanId] of winner.activeTrackPlanIds.entries()) {
    const trackOrdinal = winner.activeTrackOrdinals[trackIndex];
    for (const [spanOrdinal, response] of (winner.responseByTrackPlanId[trackPlanId] ?? []).entries()) {
      spans.push({
        id: await semanticId("activity-span", {
          opportunityKey: winner.key,
          trackOrdinal,
          spanOrdinal,
          range: response.range,
          activity: activityDirective(response),
        }),
        trackPlanId,
        range: response.range,
        activity: activityDirective(response),
      });
      for (const atomOrdinal of response.attackOrdinals) {
        const atom = context.prepared.sourceLeadAtomization.atoms[atomOrdinal];
        if (!atom) throw new RangeError("ACTIVITY_SPAN_INVALID:attack atom ordinal");
        attacks.push({
          id: await semanticId("voice-attack", {
            opportunityKey: winner.key,
            trackOrdinal,
            position: atom.range.start,
            kind: "attack",
          }),
          trackPlanId,
          position: atom.range.start,
          kind: "attack",
        });
      }
    }
  }
  spans.sort((left, right) => context.ordinals.trackOrdinalById[left.trackPlanId]
    - context.ordinals.trackOrdinalById[right.trackPlanId] || compareRanges(left.range, right.range));
  const uniqueAttacks = [...new Map(attacks.map((attack) => [
    `${attack.trackPlanId}:${canonicalJson(attack.position)}:${attack.kind}`,
    attack,
  ])).values()].sort((left, right) => context.ordinals.trackOrdinalById[left.trackPlanId]
    - context.ordinals.trackOrdinalById[right.trackPlanId] || comparePositions(left.position, right.position));
  const inputDigest = await digestActivityInput({
    intentPlanDigest: intent.intentPlanDigest,
    sourceLeadAtomizationDigest: context.prepared.sourceLeadAtomization.digest,
    atomizerVersion: context.prepared.sourceLeadAtomization.atomizerVersion,
    effectiveConfigDigest: context.effectiveConfig.digest,
    presetProfileVersion: context.effectiveConfig.presetProfileVersion,
    presetProfileDigest: context.effectiveConfig.presetProfileDigest,
    locks: context.prepared.locks.activity,
    activityPlannerVersion: RC7_REVIEW_VERSIONS.activityPlannerVersion,
    activityPlannerConfigDigest: context.activityPlannerConfigDigest,
    diagnosticRegistryVersion: RC7_REVIEW_VERSIONS.diagnosticRegistryVersion,
    diagnosticRegistryDigest: context.diagnosticRegistryDigest,
  }, context.ordinals);
  const phrase: PhraseActivityPlan = {
    id: await semanticId("phrase-activity", { phraseOrdinal: 0, opportunityKey: winner.key }),
    phraseId: context.prepared.phrase.id,
    intentId: intent.phraseIntents[0].id,
    activitySpans: spans,
    attackEvents: uniqueAttacks,
    realizedMetrics: activityMetrics(context, selection, spans, uniqueAttacks),
  };
  const base: ArrangementActivityPlan = {
    stage: "activity-realized",
    presetId: context.prepared.presetId,
    intentPlanDigest: intent.intentPlanDigest,
    activityInputDigest: inputDigest,
    activityPlannerVersion: RC7_REVIEW_VERSIONS.activityPlannerVersion,
    activityPlannerConfigDigest: context.activityPlannerConfigDigest,
    diagnosticRegistryVersion: RC7_REVIEW_VERSIONS.diagnosticRegistryVersion,
    diagnosticRegistryDigest: context.diagnosticRegistryDigest,
    sourceLeadAtomizationDigest: context.prepared.sourceLeadAtomization.digest,
    effectiveConfigDigest: context.effectiveConfig.digest,
    presetProfileDigest: context.effectiveConfig.presetProfileDigest,
    phraseActivityPlans: [phrase],
    activityPlanDigest: EMPTY_DIGEST,
  };
  return { ...base, activityPlanDigest: await digestActivityPlan(base, context.ordinals) };
}

function activityProjection(
  context: Rc7PipelineContext,
  spans: readonly VoiceActivitySpan[],
): string {
  return canonicalJson([...spans].map((span) => ({
    trackOrdinal: context.ordinals.trackOrdinalById[span.trackPlanId],
    range: span.range,
    activity: span.activity,
  })).sort((left, right) => left.trackOrdinal - right.trackOrdinal
    || compareRanges(left.range, right.range)));
}

function winnerActivityProjection(
  context: Rc7PipelineContext,
  winner: Rc7ScoredOpportunity,
): string {
  const spans = winner.activeTrackPlanIds.flatMap((trackPlanId) => (
    (winner.responseByTrackPlanId[trackPlanId] ?? []).map((span): VoiceActivitySpan => ({
      id: "projection-only",
      trackPlanId,
      range: span.range,
      activity: activityDirective(span),
    }))
  ));
  return activityProjection(context, spans);
}

export async function runRc7ActivityStage(
  context: Rc7PipelineContext,
  intent: Rc7IntentStageResult,
): Promise<Rc7ActivityStageResult> {
  const phraseIntent = intent.reloadedPlan.phraseIntents[0];
  if (!phraseIntent) throw new RangeError("ACTIVITY_SPAN_INVALID:missing persisted Intent");
  const winner = reconstructFromIntent(intent.rehydratedSelection, phraseIntent, context);
  const plan = await activityPlanForWinner(context, intent.reloadedPlan, intent.rehydratedSelection, winner);
  if (winnerActivityProjection(context, winner)
    !== activityProjection(context, plan.phraseActivityPlans[0].activitySpans)) {
    throw new RangeError("ACTIVITY_SPAN_INVALID:persisted Activity opportunity parity");
  }
  for (const lock of context.prepared.locks.activity) {
    if (lock.presetId !== context.prepared.presetId
      || lock.phraseId !== context.prepared.phrase.id
      || !plan.phraseActivityPlans[0].activitySpans.some((span) => (
        span.trackPlanId === lock.trackPlanId
          && compareRanges(span.range, lock.range) === 0
          && canonicalJson(span.activity) === canonicalJson(lock.activity)
      ))) {
      throw new RangeError("ACTIVITY_SPAN_INVALID:ActivityLock contradicts persisted Intent opportunity");
    }
  }
  return { plan, winner, rehydratedOpportunityKey: winner.key };
}

function matchingObligationTone(
  context: Rc7PipelineContext,
  obligation: Rc7ScoredOpportunity["semanticPayload"]["primaryHarmonyRoleObligationVector"][number],
) {
  const span = context.prepared.effectiveChordTimeline.spans[obligation.chordSpanCanonicalOrdinal];
  if (!span || span.parseResult.status !== "ok") {
    throw new RangeError("ANCHOR_LOCK_INVALID:missing chord span");
  }
  const tone = span.parseResult.chord.tones.find((candidate) => (
    candidate.degree === obligation.degree
      && candidate.alteration === obligation.alteration
      && candidate.role === obligation.role
      && candidate.origin === obligation.origin
  ));
  if (!tone) throw new RangeError("ANCHOR_LOCK_INVALID:missing role obligation tone");
  return { span, tone };
}

async function automaticAnchorDirectives(
  context: Rc7PipelineContext,
  activity: Rc7ActivityStageResult,
): Promise<{ readonly directives: readonly HarmonyAnchorDirective[]; readonly ncts: readonly NonChordTonePlan[] }> {
  const { winner } = activity;
  const directives: HarmonyAnchorDirective[] = [];
  const ncts: NonChordTonePlan[] = [];

  for (const [trackIndex, trackPlanId] of winner.activeTrackPlanIds.entries()) {
    const trackOrdinal = winner.activeTrackOrdinals[trackIndex];
    const responseSpans = winner.responseByTrackPlanId[trackPlanId] ?? [];
    const unisonAtomOrdinals = new Set(responseSpans
      .filter((span) => span.behavior === "unison-double" || span.behavior === "octave-double")
      .flatMap((span) => span.attackOrdinals));
    for (const atomOrdinal of [...unisonAtomOrdinals].sort((left, right) => left - right)) {
      const atom = context.prepared.sourceLeadAtomization.atoms[atomOrdinal];
      if (!atom || atom.pitch === null) throw new RangeError("ANCHOR_LOCK_INVALID:lead-derived atom");
      const behavior = responseSpans.find((span) => span.attackOrdinals.includes(atomOrdinal))?.behavior;
      directives.push({
        kind: "lead-derived",
        id: await semanticId("anchor", { winner: winner.key, trackOrdinal, atomOrdinal, kind: "lead-derived" }),
        trackPlanId,
        position: atom.range.start,
        leadAtom: {
          leadAtomId: atom.id,
          sourceLeadAtomizationDigest: context.prepared.sourceLeadAtomization.digest,
        },
        relation: behavior === "octave-double" ? "octave" : "unison",
      });
    }

    if (winner.suspensionChain && trackIndex === 0) {
      const chain = winner.suspensionChain;
      const contextSpan = context.prepared.effectiveChordTimeline.spans[chain.contextChordSpanOrdinal];
      const targetSpan = context.prepared.effectiveChordTimeline.spans[chain.targetChordSpanOrdinal];
      if (!contextSpan || !targetSpan) throw new RangeError("ANCHOR_LOCK_INVALID:suspension chord graph");
      const preparationId = await semanticId("anchor", {
        winner: winner.key, trackOrdinal, kind: "suspension-preparation",
      });
      const resolutionId = await semanticId("anchor", {
        winner: winner.key, trackOrdinal, kind: "suspension-resolution",
      });
      const nctId = await semanticId("nct", { winner: winner.key, trackOrdinal, kind: "suspension" });
      const suspensionDirectiveId = await semanticId("anchor", {
        winner: winner.key, trackOrdinal, kind: "planned-suspension",
      });
      directives.push({
        kind: "chord-tone",
        id: preparationId,
        trackPlanId,
        position: chain.preparationPosition,
        chordSpanId: contextSpan.id,
        selectedTone: chain.heldTone,
      }, {
        kind: "planned-nct",
        id: suspensionDirectiveId,
        trackPlanId,
        position: chain.suspensionPosition,
        contextChordSpanId: contextSpan.id,
        nctPlanId: nctId,
      }, {
        kind: "chord-tone",
        id: resolutionId,
        trackPlanId,
        position: chain.resolutionPosition,
        chordSpanId: targetSpan.id,
        selectedTone: chain.resolutionTone,
      });
      ncts.push({
        kind: "suspension",
        id: nctId,
        trackPlanId,
        position: chain.suspensionPosition,
        contextChordSpanId: contextSpan.id,
        targetChordSpanId: targetSpan.id,
        preparationDirectiveId: preparationId,
        resolutionDirectiveId: resolutionId,
        resolutionDeadline: chain.resolutionPosition,
        resolutionDirection: chain.resolutionDirection,
      });
      continue;
    }

    const vector = trackIndex === 0
      ? winner.semanticPayload.primaryHarmonyRoleObligationVector
      : winner.semanticPayload.secondTrackRoleContributionVector;
    for (const [obligationOrdinal, obligation] of vector.entries()) {
      const { span, tone } = matchingObligationTone(context, obligation);
      directives.push({
        kind: "chord-tone",
        id: await semanticId("anchor", {
          winner: winner.key,
          trackOrdinal,
          obligationOrdinal,
          kind: "chord-tone",
        }),
        trackPlanId,
        position: obligation.anchorPosition,
        chordSpanId: span.id,
        selectedTone: tone,
      });
    }
  }
  directives.sort((left, right) => context.ordinals.trackOrdinalById[left.trackPlanId]
    - context.ordinals.trackOrdinalById[right.trackPlanId] || comparePositions(left.position, right.position));
  return { directives, ncts };
}

function anchorLockDirective(lock: AnchorLock): HarmonyAnchorDirective | null {
  if (lock.kind === "anchor-chord-tone") {
    return {
      kind: "chord-tone",
      id: lock.id,
      trackPlanId: lock.trackPlanId,
      position: lock.position,
      chordSpanId: lock.chordSpanId,
      selectedTone: lock.selectedTone,
    };
  }
  if (lock.kind === "anchor-lead-derived") {
    return {
      kind: "lead-derived",
      id: lock.id,
      trackPlanId: lock.trackPlanId,
      position: lock.position,
      leadAtom: lock.leadAtom,
      relation: lock.relation,
    };
  }
  return null;
}

export async function runRc7AnchorStage(
  context: Rc7PipelineContext,
  activity: Rc7ActivityStageResult,
): Promise<Rc7AnchorStageResult> {
  if (await digestActivityPlan(activity.plan, context.ordinals) !== activity.plan.activityPlanDigest
    || winnerActivityProjection(context, activity.winner)
      !== activityProjection(context, activity.plan.phraseActivityPlans[0].activitySpans)) {
    throw new RangeError("STALE_REFERENCE:Anchor requires persisted Activity authority");
  }
  const automatic = await automaticAnchorDirectives(context, activity);
  const explicit = context.prepared.locks.anchor.map(anchorLockDirective).filter(
    (directive): directive is HarmonyAnchorDirective => directive !== null,
  );
  if (context.prepared.locks.anchor.some((lock) => lock.kind === "anchor-planned-nct")) {
    throw new RangeError("ANCHOR_LOCK_INVALID:review harness requires explicit NCT endpoint expansion");
  }
  const activitySpans = activity.plan.phraseActivityPlans[0].activitySpans;
  for (const directive of explicit) {
    if (!context.prepared.locks.anchor.some((lock) => lock.id === directive.id
      && lock.presetId === context.prepared.presetId
      && lock.phraseId === context.prepared.phrase.id)
      || !activitySpans.some((span) => span.trackPlanId === directive.trackPlanId
        && span.activity.state !== "rest"
        && positionInRange(directive.position, span.range))) {
      throw new RangeError("ANCHOR_LOCK_INVALID:lock is outside persisted Activity authority");
    }
  }
  const explicitTargets = new Set(explicit.map((directive) => (
    `${directive.trackPlanId}:${canonicalJson(directive.position)}`
  )));
  const directives = [
    ...automatic.directives.filter((directive) => !explicitTargets.has(
      `${directive.trackPlanId}:${canonicalJson(directive.position)}`,
    )),
    ...explicit,
  ];
  if (new Set(directives.map((directive) => directive.id)).size !== directives.length) {
    throw new RangeError("ANCHOR_LOCK_INVALID:duplicate directive");
  }
  const inputDigest = await digestAnchorInput({
    activityPlanDigest: activity.plan.activityPlanDigest,
    sourceLeadAtomizationDigest: context.prepared.sourceLeadAtomization.digest,
    atomizerVersion: context.prepared.sourceLeadAtomization.atomizerVersion,
    effectiveConfigDigest: context.effectiveConfig.digest,
    presetProfileVersion: context.effectiveConfig.presetProfileVersion,
    presetProfileDigest: context.effectiveConfig.presetProfileDigest,
    locks: context.prepared.locks.anchor,
    anchorPlannerVersion: RC7_REVIEW_VERSIONS.anchorPlannerVersion,
    anchorPlannerConfigDigest: context.anchorPlannerConfigDigest,
    diagnosticRegistryVersion: RC7_REVIEW_VERSIONS.diagnosticRegistryVersion,
    diagnosticRegistryDigest: context.diagnosticRegistryDigest,
  }, context.ordinals);
  const phrase: PhraseAnchorPlan = {
    id: await semanticId("phrase-anchor", { phraseOrdinal: 0, activityPlanDigest: activity.plan.activityPlanDigest }),
    phraseId: context.prepared.phrase.id,
    activityPlanId: activity.plan.phraseActivityPlans[0].id,
    anchorDirectives: directives,
    nctPlans: automatic.ncts,
  };
  const base: ArrangementAnchorPlan = {
    stage: "anchor-realized",
    presetId: context.prepared.presetId,
    activityPlanDigest: activity.plan.activityPlanDigest,
    anchorInputDigest: inputDigest,
    anchorPlannerVersion: RC7_REVIEW_VERSIONS.anchorPlannerVersion,
    anchorPlannerConfigDigest: context.anchorPlannerConfigDigest,
    diagnosticRegistryVersion: RC7_REVIEW_VERSIONS.diagnosticRegistryVersion,
    diagnosticRegistryDigest: context.diagnosticRegistryDigest,
    sourceLeadAtomizationDigest: context.prepared.sourceLeadAtomization.digest,
    effectiveConfigDigest: context.effectiveConfig.digest,
    presetProfileDigest: context.effectiveConfig.presetProfileDigest,
    phraseAnchorPlans: [phrase],
    anchorPlanDigest: EMPTY_DIGEST,
  };
  const plan = { ...base, anchorPlanDigest: await digestAnchorPlan(base, context.ordinals) };
  return { plan, winner: activity.winner };
}
