import { canonicalJson } from "../../domain/digest/canonical";
import { digestActivityPlan, digestAnchorPlan, digestIntentPlan } from "../../domain/digest/plans";
import { digestGenerationInput } from "../../domain/digest/stages";
import {
  addFractions,
  compareFractions,
  divideFractions,
  fraction,
  subtractFractions,
  type Fraction,
} from "../../domain/fraction";
import {
  buildArrangementCandidate,
  type CandidateOrdinalRegistry,
} from "../../domain/generation/candidate";
import type {
  FullSongMetrics,
  GeneratedNoteEventPayload,
  GeneratedVoiceEventPayload,
  RealizedHarmonyAnchor,
} from "../../domain/generation/model";
import type { HarmonyAnchorDirective, NonChordTonePlan } from "../../domain/plans";
import {
  containsPitch,
  pitchMidiNumber,
  type SpelledPitch,
} from "../../domain/pitch";
import { countRate, durationRate } from "../../domain/rates";
import {
  comparePositions,
  compareRanges,
  musicalRange,
  type MusicalPosition,
  type MusicalRange,
} from "../../domain/time";
import { RC7_FROZEN_CONFIG } from "./config";
import { RC7_REVIEW_VERSIONS } from "./constants";
import {
  chordSpanAt,
  intervalSemitones,
  leadPitchAt,
  midiToPitch,
  pitchClass,
  pitchesForToneInRange,
  positionInRange,
  positionToGlobalQ,
  primaryPulseDuration,
  rangeDurationQ,
  rangesOverlap,
  toneForPitch,
} from "./music";
import { measureDurationsForCase } from "./prepare";
import type {
  Rc7ActivityStageResult,
  Rc7AnchorStageResult,
  Rc7IntentStageResult,
} from "./stages";
import type {
  Rc7GenerationStageResult,
  Rc7NctClassification,
  Rc7PipelineContext,
  Rc7PitchCandidateTrace,
  Rc7PitchScoreSubtotals,
  Rc7RangeCheck,
  Rc7VerticalCheck,
  Rc7VerifiedAssignedTrack,
} from "./types";

interface PitchOption {
  readonly directive: HarmonyAnchorDirective;
  readonly track: Rc7VerifiedAssignedTrack;
  readonly pitch: SpelledPitch;
  readonly rejected: readonly string[];
  readonly subtotals: Rc7PitchScoreSubtotals;
  readonly totalCost: number;
  readonly canonicalPitchKey: string;
}

interface FractionInterval {
  readonly start: Fraction;
  readonly end: Fraction;
}

const ROLE_PRIORITY: Readonly<Record<string, number>> = Object.freeze({
  root: 0,
  third: 1,
  suspension: 1,
  seventh: 2,
  fifth: 3,
  color: 4,
});

function samePosition(left: MusicalPosition, right: MusicalPosition): boolean {
  return comparePositions(left, right) === 0;
}

function samePitch(left: SpelledPitch, right: SpelledPitch): boolean {
  return pitchMidiNumber(left) === pitchMidiNumber(right);
}

function pitchKey(pitch: SpelledPitch): string {
  return canonicalJson(pitch);
}

function safeCost(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`RC7_SOLVER_COST_INVALID:${label}`);
  }
  return value;
}

function subtotalTotal(subtotals: Rc7PitchScoreSubtotals): number {
  return safeCost(Object.values(subtotals).reduce((sum, value) => sum + value, 0), "subtotal");
}

function motionCost(distance: number): number | null {
  return RC7_FROZEN_CONFIG.pitchRanking.melodicMotionCostBySemitones
    .find((band) => distance >= band.min && distance <= band.max)?.cost ?? null;
}

function registerCost(
  context: Rc7PipelineContext,
  track: Rc7VerifiedAssignedTrack,
  pitch: SpelledPitch,
  duration: Fraction,
): number {
  const policy = RC7_FROZEN_CONFIG.pitchRanking.tessituraCost;
  if (track.preferredTessitura && containsPitch(track.preferredTessitura, pitch)) return policy.insidePreferred;
  if (containsPitch(track.comfortableRange, pitch)) return policy.insideComfortableOutsidePreferred;
  let result = policy.insideHardOutsideComfortable;
  const pulses = divideFractions(duration, primaryPulseDuration(context.prepared.meterFamily));
  if (pulses.n > pulses.d) {
    const wholePulses = Math.ceil(pulses.n / pulses.d);
    result += Math.min(
      policy.longSustainOutsideComfortableAdditionalCap,
      policy.longSustainOutsideComfortableAdditionalBase
        + Math.max(0, wholePulses - 1) * policy.longSustainOutsideComfortablePerPulseAfterFirst,
    );
  }
  return result;
}

function roleBaseCost(role: string, preset: Rc7PipelineContext["prepared"]["presetId"]): number {
  const policy = RC7_FROZEN_CONFIG.pitchRanking.roleBaseCost;
  if (role === "color") return preset === "full" ? policy.colorFull : policy.colorStandard;
  return policy[role as keyof typeof policy] ?? policy.fifth;
}

function verticalPolicy(
  context: Rc7PipelineContext,
  directive: HarmonyAnchorDirective,
  pitch: SpelledPitch,
  lead: SpelledPitch | null,
  held: boolean,
): { readonly cost: number; readonly rejected: readonly string[] } {
  if (!lead) return { cost: 0, rejected: [] };
  const interval = intervalSemitones(pitch, lead);
  const rejected: string[] = [];
  if (interval === 0) {
    if (!held) rejected.push("INDEPENDENT_UNISON_ATTACK");
    return { cost: held ? 350 : 0, rejected };
  }
  if (interval === 1 || interval === 12 || interval >= 17) {
    rejected.push("VERTICAL_INTERVAL_INELIGIBLE");
    return { cost: 0, rejected };
  }
  if (interval === 2) {
    const explicitFull = context.prepared.presetId === "full"
      && directive.kind !== "lead-derived";
    if (!held && !explicitFull) rejected.push("WHOLE_STEP_ATTACK_REQUIRES_FULL_EXPLICIT");
    return { cost: held ? 350 : 1_800, rejected };
  }
  if (interval <= 4) return { cost: 150, rejected };
  if (interval === 5) return { cost: 350, rejected };
  if (interval === 6) {
    const span = chordSpanAt(directive.position, context.prepared.effectiveChordTimeline.spans);
    const leadIsChordTone = span?.parseResult.status === "ok"
      && toneForPitch(span.parseResult.chord, lead) !== undefined;
    if (context.prepared.presetId === "simple" || !leadIsChordTone) {
      rejected.push("TRITONE_POLICY_INELIGIBLE");
    }
    return { cost: 1_100, rejected };
  }
  if (interval === 7) return { cost: 300, rejected };
  if (interval <= 9) return { cost: 150, rejected };
  if (interval === 10) return { cost: 500, rejected };
  if (interval === 11) {
    const span = chordSpanAt(directive.position, context.prepared.effectiveChordTimeline.spans);
    if (span?.parseResult.status !== "ok" || toneForPitch(span.parseResult.chord, lead) === undefined) {
      rejected.push("MAJOR_SEVENTH_REQUIRES_CHORD_TONE_LEAD");
    }
    return { cost: 900, rejected };
  }
  return { cost: 2_000, rejected };
}

function identityCosts(
  context: Rc7PipelineContext,
  directive: HarmonyAnchorDirective,
  pitch: SpelledPitch,
  lead: SpelledPitch | null,
): Pick<Rc7PitchScoreSubtotals, "identityContext" | "identityPriority" | "localToneRole" | "leadDuplication"> {
  if (directive.kind === "lead-derived") {
    return { identityContext: 0, identityPriority: 0, localToneRole: 0, leadDuplication: 0 };
  }
  const span = chordSpanAt(directive.position, context.prepared.effectiveChordTimeline.spans);
  const chord = span?.parseResult.status === "ok" ? span.parseResult.chord : null;
  const selectedTone = directive.kind === "chord-tone"
    ? directive.selectedTone
    : chord ? toneForPitch(chord, pitch) : undefined;
  const leadTone = chord && lead ? toneForPitch(chord, lead) : undefined;
  const role = selectedTone?.role ?? "suspension";
  const critical = role === "root" || role === "third" || role === "seventh" || role === "suspension";
  const leadDuplicates = Boolean(leadTone && leadTone.role === role);
  const identityContext = leadDuplicates && critical
    ? RC7_FROZEN_CONFIG.pitchRanking.identityContextCost.duplicatesIdentityCriticalRoleAlreadyInLead
    : critical
      ? RC7_FROZEN_CONFIG.pitchRanking.identityContextCost.candidateSuppliesMissingIdentityCriticalRole
      : RC7_FROZEN_CONFIG.pitchRanking.identityContextCost.candidateMissesAvailableMissingIdentityCriticalRole;
  return {
    identityContext,
    identityPriority: (ROLE_PRIORITY[role] ?? ROLE_PRIORITY.color)
      * RC7_FROZEN_CONFIG.pitchRanking.identityPriorityStepCost,
    localToneRole: roleBaseCost(role, context.prepared.presetId),
    leadDuplication: leadDuplicates
      ? RC7_FROZEN_CONFIG.pitchRanking.leadDuplicateAdditionalCost[
        role as keyof typeof RC7_FROZEN_CONFIG.pitchRanking.leadDuplicateAdditionalCost
      ] ?? 0
      : 0,
  };
}

function directiveDuration(
  context: Rc7PipelineContext,
  activity: Rc7ActivityStageResult,
  directive: HarmonyAnchorDirective,
): Fraction {
  const phrasePlan = activity.plan.phraseActivityPlans[0];
  const span = phrasePlan.activitySpans.find((candidate) => candidate.trackPlanId === directive.trackPlanId
    && positionInRange(directive.position, candidate.range));
  return span ? rangeDurationQ(span.range, measureDurationsForCase(context.prepared)) : fraction(0);
}

function nctForDirective(
  ncts: readonly NonChordTonePlan[],
  directive: HarmonyAnchorDirective,
): NonChordTonePlan | undefined {
  if (directive.kind === "planned-nct") return ncts.find((nct) => nct.id === directive.nctPlanId);
  return ncts.find((nct) => nct.resolutionDirectiveId === directive.id
    || nct.preparationDirectiveId === directive.id);
}

function relationCandidates(
  directive: Extract<HarmonyAnchorDirective, { readonly kind: "lead-derived" }>,
  track: Rc7VerifiedAssignedTrack,
  role: "upper" | "lower",
  context: Rc7PipelineContext,
): readonly SpelledPitch[] {
  const atom = context.prepared.sourceLeadAtomization.atoms.find((candidate) => candidate.id === directive.leadAtom.leadAtomId);
  if (!atom?.pitch || directive.leadAtom.sourceLeadAtomizationDigest !== context.prepared.sourceLeadAtomization.digest) return [];
  if (directive.relation === "unison") return [atom.pitch];
  const midi = pitchMidiNumber(atom.pitch) + (role === "upper" ? 12 : -12);
  if (midi < 0 || midi > 127) return [];
  return [midiToPitch(midi)];
}

function rawCandidates(
  context: Rc7PipelineContext,
  directive: HarmonyAnchorDirective,
  track: Rc7VerifiedAssignedTrack,
  role: "upper" | "lower",
  realizedByDirective: ReadonlyMap<string, SpelledPitch>,
  ncts: readonly NonChordTonePlan[],
): readonly SpelledPitch[] {
  if (directive.kind === "lead-derived") return relationCandidates(directive, track, role, context);
  if (directive.kind === "planned-nct") {
    const nct = ncts.find((candidate) => candidate.id === directive.nctPlanId);
    const held = nct ? realizedByDirective.get(nct.preparationDirectiveId) : undefined;
    return held ? [held] : [];
  }
  const span = context.prepared.effectiveChordTimeline.spans.find((candidate) => candidate.id === directive.chordSpanId);
  if (!span || span.parseResult.status !== "ok") return [];
  return pitchesForToneInRange(span.parseResult.chord, directive.selectedTone, track.hardRange);
}

function directionRejection(
  directive: HarmonyAnchorDirective,
  pitch: SpelledPitch,
  nct: NonChordTonePlan | undefined,
  realizedByDirective: ReadonlyMap<string, SpelledPitch>,
): string | null {
  if (!nct || nct.resolutionDirectiveId !== directive.id) return null;
  const preparation = realizedByDirective.get(nct.preparationDirectiveId);
  if (!preparation) return "NCT_PREPARATION_NOT_REALIZED";
  const distance = pitchMidiNumber(pitch) - pitchMidiNumber(preparation);
  const direction = nct.kind === "suspension" ? nct.resolutionDirection
    : nct.kind === "passing" || nct.kind === "neighbor" ? nct.direction
      : null;
  if (nct.kind === "anticipation") return samePitch(pitch, preparation) ? null : "ANTICIPATION_ENDPOINT_MISMATCH";
  const expectedSign = direction === "up" ? 1 : -1;
  return Math.sign(distance) === expectedSign && Math.abs(distance) <= 2 && Math.abs(distance) >= 1
    ? null
    : "NCT_RESOLUTION_DIRECTION_OR_DISTANCE";
}

function pitchOptions(
  context: Rc7PipelineContext,
  activity: Rc7ActivityStageResult,
  anchor: Rc7AnchorStageResult,
  directive: HarmonyAnchorDirective,
  track: Rc7VerifiedAssignedTrack,
  role: "upper" | "lower",
  previousPitch: SpelledPitch | undefined,
  realizedByDirective: ReadonlyMap<string, SpelledPitch>,
): readonly PitchOption[] {
  const ncts = anchor.plan.phraseAnchorPlans[0].nctPlans;
  const nct = nctForDirective(ncts, directive);
  const lock = context.prepared.locks.solver.find((candidate) => candidate.trackPlanId === directive.trackPlanId
    && samePosition(candidate.position, directive.position));
  const raw = lock ? [lock.pitch] : rawCandidates(context, directive, track, role, realizedByDirective, ncts);
  const duration = directiveDuration(context, activity, directive);
  const lead = leadPitchAt(directive.position, context.prepared.sourceLeadAtomization.atoms);
  return [...new Map(raw.map((pitch) => [pitchKey(pitch), pitch])).values()]
    .map((pitch): PitchOption => {
      const rejected: string[] = [];
      if (!containsPitch(track.hardRange, pitch)) rejected.push("PITCH_OUTSIDE_HARD_RANGE");
      if (directive.kind !== "lead-derived" && lead) {
        const signed = pitchMidiNumber(pitch) - pitchMidiNumber(lead);
        if ((role === "upper" && (signed <= 0 || signed > 16))
          || (role === "lower" && (signed >= 0 || signed < -16))) {
          rejected.push("PLACEMENT_ROLE_CROSSING_OR_SEPARATION");
        }
      }
      const motion = previousPitch ? intervalSemitones(previousPitch, pitch) : 0;
      if (previousPitch && motion > context.effectiveConfig.hardMaxLeapSemitones) {
        rejected.push("HARD_MAX_LEAP_EXCEEDED");
      }
      const motionBase = motionCost(motion);
      if (motionBase === null) rejected.push("MELODIC_MOTION_BAND_INELIGIBLE");
      const directionIssue = directionRejection(directive, pitch, nct, realizedByDirective);
      if (directionIssue) rejected.push(directionIssue);
      if (lock && rawCandidates(context, directive, track, role, realizedByDirective, ncts)
        .every((candidate) => pitchMidiNumber(candidate) !== pitchMidiNumber(lock.pitch))) {
        rejected.push("SOLVER_LOCK_CONTRADICTS_PERSISTED_ANCHOR");
      }
      const held = directive.kind === "planned-nct";
      const vertical = directive.kind === "lead-derived"
        ? { cost: 0, rejected: [] as readonly string[] }
        : verticalPolicy(context, directive, pitch, lead, held);
      rejected.push(...vertical.rejected);
      const identity = identityCosts(context, directive, pitch, lead);
      const subtotals: Rc7PitchScoreSubtotals = {
        registerAndSustainStress: registerCost(context, track, pitch, duration),
        melodicMotion: (motionBase ?? 0)
          + (motion > context.effectiveConfig.preferredMaxLeapSemitones
            ? RC7_FROZEN_CONFIG.pitchRanking.abovePreferredLeapAdditionalCost
            : 0),
        roleContinuityCrossingLeadSeparation: 0,
        ...identity,
        verticalInterval: vertical.cost,
        jointVoicing: 0,
      };
      return {
        directive,
        track,
        pitch,
        rejected,
        subtotals,
        totalCost: subtotalTotal(subtotals),
        canonicalPitchKey: pitchKey(pitch),
      };
    })
    .sort((left, right) => left.totalCost - right.totalCost
      || left.canonicalPitchKey.localeCompare(right.canonicalPitchKey));
}

function cartesian<T>(sets: readonly (readonly T[])[]): readonly (readonly T[])[] {
  return sets.reduce<readonly (readonly T[])[]>(
    (rows, set) => rows.flatMap((row) => set.map((value) => [...row, value])),
    [[]],
  );
}

function jointResult(
  context: Rc7PipelineContext,
  options: readonly PitchOption[],
  intent: Rc7IntentStageResult,
): { readonly rejected: readonly string[]; readonly costs: readonly number[] } {
  const costs = options.map(() => 0);
  const rejected: string[] = [];
  for (let leftIndex = 0; leftIndex < options.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < options.length; rightIndex += 1) {
      const left = options[leftIndex];
      const right = options[rightIndex];
      if (left.directive.kind === "lead-derived" || right.directive.kind === "lead-derived") continue;
      const distance = intervalSemitones(left.pitch, right.pitch);
      if (distance === 0 || pitchClass(left.pitch) === pitchClass(right.pitch)) {
        rejected.push("JOINT_SAME_PITCH_OR_PITCH_CLASS");
        continue;
      }
      if (distance < RC7_FROZEN_CONFIG.pitchRanking.twoHarmonyJointRules.adjacentIntervalMinSemitones) {
        rejected.push("JOINT_ADJACENT_INTERVAL_TOO_NARROW");
        continue;
      }
      if (distance > 12) costs[rightIndex] += RC7_FROZEN_CONFIG.pitchRanking.twoHarmonyJointRules.adjacentIntervalAbove12Cost;
    }
  }
  if (options.length > 1) {
    const lead = leadPitchAt(options[0].directive.position, context.prepared.sourceLeadAtomization.atoms);
    const midis = options.map((option) => pitchMidiNumber(option.pitch));
    if (lead) midis.push(pitchMidiNumber(lead));
    const spread = Math.max(...midis) - Math.min(...midis);
    const target = intent.plan.sectionIntents[0].intensityTarget.registerSpreadRange;
    const miss = spread < target[0] ? target[0] - spread : spread > target[1] ? spread - target[1] : 0;
    costs[costs.length - 1] += miss
      * RC7_FROZEN_CONFIG.pitchRanking.twoHarmonyJointRules.registerSpreadOutsideTargetPerSemitoneCost;
  }
  return { rejected, costs };
}

function traceForOption(
  option: PitchOption,
  jointVoicing: number,
  selected: boolean,
): Rc7PitchCandidateTrace {
  const subtotals = { ...option.subtotals, jointVoicing };
  return {
    directiveId: option.directive.id,
    trackOrdinal: option.track.trackOrdinal,
    position: option.directive.position,
    pitch: option.pitch,
    eligible: option.rejected.length === 0,
    rejectionReasons: option.rejected,
    subtotals,
    totalCost: subtotalTotal(subtotals),
    selected,
    canonicalPitchKey: option.canonicalPitchKey,
  };
}

function candidateOrdinalRegistry(
  context: Rc7PipelineContext,
  directives: readonly HarmonyAnchorDirective[],
): CandidateOrdinalRegistry {
  const lyrics = [...context.prepared.lyricTokens]
    .sort((left, right) => {
      const leftAtom = context.prepared.sourceLeadAtomization.atoms.find((atom) => atom.lyricTokenIds.includes(left.id));
      const rightAtom = context.prepared.sourceLeadAtomization.atoms.find((atom) => atom.lyricTokenIds.includes(right.id));
      return leftAtom && rightAtom ? compareRanges(leftAtom.range, rightAtom.range) : left.id.localeCompare(right.id);
    });
  const orderedDirectives = [...directives].sort((left, right) => (
    context.ordinals.trackOrdinalById[left.trackPlanId]
      - context.ordinals.trackOrdinalById[right.trackPlanId]
      || comparePositions(left.position, right.position)
      || left.kind.localeCompare(right.kind)
  ));
  return {
    trackOrdinalById: context.ordinals.trackOrdinalById,
    lyricOrdinalById: Object.fromEntries(lyrics.map((token, ordinal) => [token.id, ordinal])),
    anchorDirectiveOrdinalById: Object.fromEntries(orderedDirectives.map((directive, ordinal) => [directive.id, ordinal])),
  };
}

function intersectionRange(
  left: MusicalRange,
  right: MusicalRange,
  durations: readonly Fraction[],
): MusicalRange | null {
  const start = comparePositions(left.start, right.start) >= 0 ? left.start : right.start;
  const end = comparePositions(left.end, right.end) <= 0 ? left.end : right.end;
  return comparePositions(start, end) < 0 ? musicalRange(start, end, durations) : null;
}

function sourceForDirective(directive: HarmonyAnchorDirective): GeneratedNoteEventPayload["source"] {
  if (directive.kind === "lead-derived") return directive.relation === "octave" ? "octave-double" : "unison";
  return directive.kind === "planned-nct" ? "planned-nct" : "anchor";
}

function withTies(events: readonly GeneratedNoteEventPayload[]): readonly GeneratedNoteEventPayload[] {
  const ordered = [...events].sort((left, right) => compareRanges(left.range, right.range));
  return ordered.map((event, index) => {
    const previous = ordered[index - 1];
    const next = ordered[index + 1];
    return {
      ...event,
      tieStop: Boolean(previous && comparePositions(previous.range.end, event.range.start) === 0
        && samePitch(previous.pitch, event.pitch)),
      tieStart: Boolean(next && comparePositions(event.range.end, next.range.start) === 0
        && samePitch(event.pitch, next.pitch)),
    };
  });
}

function buildPayloads(
  context: Rc7PipelineContext,
  activity: Rc7ActivityStageResult,
  anchor: Rc7AnchorStageResult,
  realizedByDirective: ReadonlyMap<string, SpelledPitch>,
): Readonly<Record<string, readonly GeneratedVoiceEventPayload[]>> {
  const durations = measureDurationsForCase(context.prepared);
  const directives = anchor.plan.phraseAnchorPlans[0].anchorDirectives;
  const byTrack: Record<string, readonly GeneratedVoiceEventPayload[]> = {};
  for (const trackPlanId of anchor.winner.activeTrackPlanIds) {
    const trackDirectives = directives.filter((directive) => directive.trackPlanId === trackPlanId)
      .sort((left, right) => comparePositions(left.position, right.position));
    const responseSpans = anchor.winner.responseByTrackPlanId[trackPlanId] ?? [];
    const notes: GeneratedNoteEventPayload[] = [];
    for (const response of responseSpans) {
      if (response.behavior === "rest") continue;
      if (response.behavior === "unison-double" || response.behavior === "octave-double") {
        for (const atomOrdinal of response.sourceAtomOrdinals) {
          const atom = context.prepared.sourceLeadAtomization.atoms[atomOrdinal];
          if (!atom?.pitch) continue;
          const range = intersectionRange(atom.range, response.range, durations);
          if (!range) continue;
          const origin = [...trackDirectives]
            .reverse()
            .find((directive) => directive.kind === "lead-derived"
              && comparePositions(directive.position, range.start) <= 0);
          if (!origin) throw new RangeError("RC7_SOLVER_MISSING_LEAD_DERIVED_ANCHOR");
          const pitch = realizedByDirective.get(origin.id);
          if (!pitch) throw new RangeError("RC7_SOLVER_UNREALIZED_LEAD_DERIVED_ANCHOR");
          notes.push({
            kind: "note",
            range,
            pitch,
            tieStart: false,
            tieStop: false,
            lyricTokenIds: atom.lyricTokenIds,
            source: sourceForDirective(origin),
            originDirectiveId: origin.id,
          });
        }
        continue;
      }
      const inside = trackDirectives.filter((directive) => positionInRange(directive.position, response.range));
      if (inside.length === 0) throw new RangeError("RC7_SOLVER_ACTIVE_SPAN_WITHOUT_ANCHOR");
      for (let index = 0; index < inside.length; index += 1) {
        const directive = inside[index];
        const end = inside[index + 1]?.position ?? response.range.end;
        if (comparePositions(directive.position, end) >= 0) continue;
        const pitch = realizedByDirective.get(directive.id);
        if (!pitch) throw new RangeError("RC7_SOLVER_UNREALIZED_ANCHOR");
        const leadAtom = context.prepared.sourceLeadAtomization.atoms.find((atom) => positionInRange(directive.position, atom.range));
        notes.push({
          kind: "note",
          range: musicalRange(directive.position, end, durations),
          pitch,
          tieStart: false,
          tieStop: false,
          lyricTokenIds: anchor.winner.semanticPayload.lyricPolicy === "same-lyrics"
            ? leadAtom?.lyricTokenIds ?? []
            : [],
          source: sourceForDirective(directive),
          originDirectiveId: directive.id,
        });
      }
    }
    byTrack[trackPlanId] = withTies(notes);
  }
  return byTrack;
}

function intervalUnion(values: readonly FractionInterval[]): readonly FractionInterval[] {
  const ordered = [...values].sort((left, right) => compareFractions(left.start, right.start)
    || compareFractions(left.end, right.end));
  const result: FractionInterval[] = [];
  for (const value of ordered) {
    const prior = result.at(-1);
    if (!prior || compareFractions(value.start, prior.end) > 0) result.push(value);
    else if (compareFractions(value.end, prior.end) > 0) result[result.length - 1] = { start: prior.start, end: value.end };
  }
  return result;
}

function intervalDuration(values: readonly FractionInterval[]): Fraction {
  return values.reduce((sum, value) => addFractions(sum, subtractFractions(value.end, value.start)), fraction(0));
}

function densityMetrics(
  context: Rc7PipelineContext,
  activity: Rc7ActivityStageResult,
  payloads: Readonly<Record<string, readonly GeneratedVoiceEventPayload[]>>,
  realizedAnchors: readonly RealizedHarmonyAnchor[],
): FullSongMetrics["densityBySectionOccurrence"][string] {
  const durations = measureDurationsForCase(context.prepared);
  const phraseDuration = rangeDurationQ(context.prepared.phrase.range, durations);
  const notes = Object.values(payloads).flat().filter(
    (event): event is GeneratedNoteEventPayload => event.kind === "note",
  );
  const boundaries = [
    positionToGlobalQ(context.prepared.phrase.range.start, durations),
    positionToGlobalQ(context.prepared.phrase.range.end, durations),
    ...notes.flatMap((event) => [
      positionToGlobalQ(event.range.start, durations),
      positionToGlobalQ(event.range.end, durations),
    ]),
  ].sort(compareFractions).filter((value, index, all) => index === 0 || compareFractions(value, all[index - 1]) !== 0);
  const oneTrack: FractionInterval[] = [];
  const twoTracks: FractionInterval[] = [];
  const divergent: FractionInterval[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (compareFractions(start, end) >= 0) continue;
    const position = context.prepared.phrase.range.start.performanceMeasureIndex === 0
      ? context.prepared.sourceLeadAtomization.atoms.find((atom) => {
        const atomStart = positionToGlobalQ(atom.range.start, durations);
        const atomEnd = positionToGlobalQ(atom.range.end, durations);
        return compareFractions(atomStart, start) <= 0 && compareFractions(start, atomEnd) < 0;
      })?.range.start ?? context.prepared.phrase.range.start
      : context.prepared.phrase.range.start;
    void position;
    const active = Object.values(payloads).filter((events) => events.some((event) => {
      const eventStart = positionToGlobalQ(event.range.start, durations);
      const eventEnd = positionToGlobalQ(event.range.end, durations);
      return event.kind === "note" && compareFractions(eventStart, start) <= 0 && compareFractions(start, eventEnd) < 0;
    }));
    const interval = { start, end };
    if (active.length === 1) oneTrack.push(interval);
    if (active.length >= 2) twoTracks.push(interval);
    if (active.some((events) => events.some((event) => event.kind === "note"
      && event.source !== "unison" && event.source !== "octave-double"
      && compareFractions(positionToGlobalQ(event.range.start, durations), start) <= 0
      && compareFractions(start, positionToGlobalQ(event.range.end, durations)) < 0))) divergent.push(interval);
  }
  const spreads = realizedAnchors.flatMap((anchor) => {
    const lead = leadPitchAt(anchor.position, context.prepared.sourceLeadAtomization.atoms);
    const harmony = realizedAnchors.filter((candidate) => samePosition(candidate.position, anchor.position));
    const pitches = [...harmony.map((candidate) => pitchMidiNumber(candidate.pitch)), ...(lead ? [pitchMidiNumber(lead)] : [])];
    return pitches.length >= 2 ? [Math.max(...pitches) - Math.min(...pitches)] : [];
  }).sort((left, right) => left - right);
  const medianSpread = spreads.length === 0 ? 0 : spreads[Math.floor((spreads.length - 1) / 2)];
  const activityMetrics = activity.plan.phraseActivityPlans[0].realizedMetrics;
  return {
    ...activityMetrics,
    harmonicDivergenceCoverage: durationRate(intervalDuration(intervalUnion(divergent)), phraseDuration),
    exactlyTwoPitchCoverage: durationRate(intervalDuration(intervalUnion(oneTrack)), phraseDuration),
    exactlyThreePitchCoverage: durationRate(intervalDuration(intervalUnion(twoTracks)), phraseDuration),
    medianRegisterSpreadSemitones: medianSpread,
  };
}

function maxLeaps(
  payloads: Readonly<Record<string, readonly GeneratedVoiceEventPayload[]>>,
): Readonly<Record<string, number>> {
  return Object.fromEntries(Object.entries(payloads).map(([trackPlanId, events]) => {
    const pitches = events.filter((event): event is GeneratedNoteEventPayload => event.kind === "note")
      .sort((left, right) => compareRanges(left.range, right.range)).map((event) => event.pitch);
    let maximum = 0;
    for (let index = 1; index < pitches.length; index += 1) maximum = Math.max(maximum, intervalSemitones(pitches[index - 1], pitches[index]));
    return [trackPlanId, maximum];
  }));
}

function validatePayloads(
  context: Rc7PipelineContext,
  anchor: Rc7AnchorStageResult,
  candidate: Rc7GenerationStageResult["candidate"],
): {
  readonly rangeChecks: readonly Rc7RangeCheck[];
  readonly verticalChecks: readonly Rc7VerticalCheck[];
  readonly nct: readonly Rc7NctClassification[];
} {
  const trackById = new Map(context.prepared.performers.flatMap((entry) => context.prepared.assignments
    .filter((assignment) => assignment.performerId === entry.profile.id)
    .map((assignment) => [assignment.trackPlanId, entry.profile] as const)));
  const directives = new Map(anchor.plan.phraseAnchorPlans[0].anchorDirectives.map((directive) => [directive.id, directive]));
  const nctById = new Map(anchor.plan.phraseAnchorPlans[0].nctPlans.map((nct) => [nct.id, nct]));
  const rangeChecks: Rc7RangeCheck[] = [];
  const verticalChecks: Rc7VerticalCheck[] = [];
  const classifications: Rc7NctClassification[] = [];
  for (const [trackPlanId, events] of Object.entries(candidate.generatedEventsByTrack)) {
    const performer = trackById.get(trackPlanId);
    if (!performer) throw new RangeError("RC7_SOLVER_DANGLING_TRACK_ASSIGNMENT");
    for (const event of events) {
      if (event.kind === "rest") continue;
      const inside = containsPitch(performer.hardRange, event.pitch);
      rangeChecks.push({ eventId: event.id, trackPlanId, pitch: event.pitch, insideHardRange: inside });
      if (!inside) throw new RangeError("RC7_SOLVER_HARD_RANGE_VIOLATION");
      const directive = event.originDirectiveId ? directives.get(event.originDirectiveId) : undefined;
      const lead = leadPitchAt(event.range.start, context.prepared.sourceLeadAtomization.atoms);
      const independent = event.source !== "unison" && event.source !== "octave-double";
      const interval = lead ? intervalSemitones(event.pitch, lead) : null;
      const legal = !independent || interval === null || interval !== 0;
      verticalChecks.push({
        eventId: event.id,
        position: event.range.start,
        intervalToLead: interval,
        legal,
        reason: legal ? "hard vertical policy satisfied" : "fresh independent unison attack",
      });
      if (!legal) throw new RangeError("RC7_SOLVER_INDEPENDENT_UNISON_ATTACK");
      if (anchor.winner.textureId === "SUSTAINED_PAD" && independent) {
        for (const atom of context.prepared.sourceLeadAtomization.atoms) {
          if (!atom.pitch || !rangesOverlap(atom.range, event.range)) continue;
          const heldInterval = intervalSemitones(event.pitch, atom.pitch);
          const padLegal = heldInterval !== 1;
          verticalChecks.push({
            eventId: event.id,
            position: atom.range.start,
            intervalToLead: heldInterval,
            legal: padLegal,
            reason: padLegal ? "Pad avoids Lead semitone" : "Pad overlaps Lead by a semitone",
          });
          if (!padLegal) throw new RangeError("RC7_SOLVER_PAD_SEMITONE_COLLISION");
        }
      }
      const nctPlan = directive?.kind === "planned-nct" ? nctById.get(directive.nctPlanId) : undefined;
      const classification: Rc7NctClassification["classification"] = event.source === "unison" || event.source === "octave-double"
        ? "lead-derived"
        : nctPlan?.kind ?? "chord-tone";
      classifications.push({ eventId: event.id, classification, legal: true });
    }
  }
  return { rangeChecks, verticalChecks, nct: classifications };
}

export function selectNctPath(nctPathCost: number, plainChordTonePathCost: number): "nct" | "plain" {
  if (!Number.isSafeInteger(nctPathCost) || !Number.isSafeInteger(plainChordTonePathCost)
    || nctPathCost < 0 || plainChordTonePathCost < 0) {
    throw new RangeError("RC7_NCT_PATH_COST_INVALID");
  }
  return nctPathCost < plainChordTonePathCost ? "nct" : "plain";
}

export async function runRc7GenerationStage(
  context: Rc7PipelineContext,
  intent: Rc7IntentStageResult,
  activity: Rc7ActivityStageResult,
  anchor: Rc7AnchorStageResult,
): Promise<Rc7GenerationStageResult> {
  if (await digestIntentPlan(intent.reloadedPlan, context.ordinals) !== intent.reloadedPlan.intentPlanDigest
    || await digestActivityPlan(activity.plan, context.ordinals) !== activity.plan.activityPlanDigest
    || await digestAnchorPlan(anchor.plan, context.ordinals) !== anchor.plan.anchorPlanDigest
    || anchor.plan.activityPlanDigest !== activity.plan.activityPlanDigest) {
    throw new RangeError("STALE_REFERENCE:Solver requires persisted Anchor authority");
  }
  const generationInputDigest = await digestGenerationInput({
    anchorPlanDigest: anchor.plan.anchorPlanDigest,
    effectiveConfigDigest: context.effectiveConfig.digest,
    presetProfileVersion: context.effectiveConfig.presetProfileVersion,
    presetProfileDigest: context.effectiveConfig.presetProfileDigest,
    locks: context.prepared.locks.solver,
    solverVersion: RC7_REVIEW_VERSIONS.solverVersion,
    assemblerVersion: RC7_REVIEW_VERSIONS.assemblerVersion,
    validatorVersion: RC7_REVIEW_VERSIONS.validatorVersion,
    metricsVersion: RC7_REVIEW_VERSIONS.metricsVersion,
    candidateProjectionVersion: RC7_REVIEW_VERSIONS.candidateProjectionVersion,
    solverConfigDigest: context.solverConfigDigest,
    assemblerConfigDigest: context.assemblerConfigDigest,
    validatorConfigDigest: context.validatorConfigDigest,
    metricConfigDigest: context.metricConfigDigest,
    diagnosticRegistryVersion: RC7_REVIEW_VERSIONS.diagnosticRegistryVersion,
    diagnosticRegistryDigest: context.diagnosticRegistryDigest,
  }, context.ordinals);
  const phraseAnchor = anchor.plan.phraseAnchorPlans[0];
  const directives = [...phraseAnchor.anchorDirectives].sort((left, right) => comparePositions(left.position, right.position)
    || context.ordinals.trackOrdinalById[left.trackPlanId] - context.ordinals.trackOrdinalById[right.trackPlanId]
    || left.kind.localeCompare(right.kind));
  const duplicateTargets = directives.map((directive) => `${context.ordinals.trackOrdinalById[directive.trackPlanId]}:${canonicalJson(directive.position)}`);
  if (new Set(duplicateTargets).size !== duplicateTargets.length) throw new RangeError("RC7_SOLVER_DUPLICATE_ANCHOR_TARGET");
  for (const lock of context.prepared.locks.solver) {
    if (lock.phraseId !== context.prepared.phrase.id || lock.presetId !== context.prepared.presetId
      || !directives.some((directive) => directive.trackPlanId === lock.trackPlanId
        && samePosition(directive.position, lock.position))) {
      throw new RangeError("STAGE_LOCK_SCOPE_INVALID:SolverLock");
    }
  }
  const trackById = new Map(intent.assignedTracks.map((track) => [track.trackPlanId, track]));
  const realizedByDirective = new Map<string, SpelledPitch>();
  const priorByTrack = new Map<string, SpelledPitch>();
  const trace: Rc7PitchCandidateTrace[] = [];
  const directiveGroups: HarmonyAnchorDirective[][] = [];
  for (const directive of directives) {
    const prior = directiveGroups.at(-1);
    if (!prior || !samePosition(prior[0].position, directive.position)) directiveGroups.push([directive]);
    else prior.push(directive);
  }
  interface SelectedGroup {
    readonly options: readonly PitchOption[];
    readonly jointCosts: readonly number[];
    readonly optionSets: readonly (readonly PitchOption[])[];
  }
  interface SelectedPath {
    readonly cost: number;
    readonly key: string;
    readonly groups: readonly SelectedGroup[];
  }
  const search = (
    groupIndex: number,
    priorState: ReadonlyMap<string, SpelledPitch>,
    realizedState: ReadonlyMap<string, SpelledPitch>,
  ): SelectedPath | null => {
    if (groupIndex >= directiveGroups.length) return { cost: 0, key: "[]", groups: [] };
    const group = directiveGroups[groupIndex];
    const optionSets = group.map((directive) => {
      const track = trackById.get(directive.trackPlanId);
      const role = anchor.winner.roleByTrackPlanId[directive.trackPlanId];
      if (!track || !role) throw new RangeError("RC7_SOLVER_DANGLING_TRACK_ROLE");
      return pitchOptions(context, activity, anchor, directive, track, role, priorState.get(track.trackPlanId), realizedState);
    });
    if (optionSets.some((options) => options.length === 0)) return null;
    const combinations = cartesian(optionSets).map((options) => {
      const joint = jointResult(context, options, intent);
      const rejected = [...options.flatMap((option) => option.rejected), ...joint.rejected];
      const total = options.reduce((sum, option, index) => sum + option.totalCost + joint.costs[index], 0);
      const key = canonicalJson(options.map((option) => ({
        trackOrdinal: option.track.trackOrdinal,
        pitch: option.pitch,
      })));
      return { options, joint, rejected, total, key };
    }).filter((combination) => combination.rejected.length === 0)
      .sort((left, right) => left.total - right.total || left.key.localeCompare(right.key));
    let best: SelectedPath | null = null;
    for (const combination of combinations) {
      const nextPrior = new Map(priorState);
      const nextRealized = new Map(realizedState);
      for (const option of combination.options) {
        nextPrior.set(option.track.trackPlanId, option.pitch);
        nextRealized.set(option.directive.id, option.pitch);
      }
      const suffix = search(groupIndex + 1, nextPrior, nextRealized);
      if (!suffix) continue;
      const candidate: SelectedPath = {
        cost: combination.total + suffix.cost,
        key: `${combination.key}:${suffix.key}`,
        groups: [{ options: combination.options, jointCosts: combination.joint.costs, optionSets }, ...suffix.groups],
      };
      if (!best || candidate.cost < best.cost || (candidate.cost === best.cost && candidate.key < best.key)) best = candidate;
    }
    return best;
  };
  const selectedPath = search(0, priorByTrack, realizedByDirective);
  if (!selectedPath) {
    throw new RangeError(`RC7_SOLVER_NO_LEGAL_VOICING:${directiveGroups.map((group) => group.map((directive) => directive.id).join(",")).join("|")}`);
  }
  for (const selectedGroup of selectedPath.groups) {
    for (let setIndex = 0; setIndex < selectedGroup.optionSets.length; setIndex += 1) {
      const selectedOption = selectedGroup.options[setIndex];
      trace.push(...selectedGroup.optionSets[setIndex].map((option) => traceForOption(
        option,
        samePitch(option.pitch, selectedOption.pitch) ? selectedGroup.jointCosts[setIndex] : 0,
        samePitch(option.pitch, selectedOption.pitch),
      )));
      realizedByDirective.set(selectedOption.directive.id, selectedOption.pitch);
      priorByTrack.set(selectedOption.track.trackPlanId, selectedOption.pitch);
    }
  }
  const payloadsByTrack = buildPayloads(context, activity, anchor, realizedByDirective);
  const realizedAnchors: RealizedHarmonyAnchor[] = directives.map((directive) => {
    const pitch = realizedByDirective.get(directive.id);
    if (!pitch) throw new RangeError("RC7_SOLVER_MISSING_REALIZED_ANCHOR");
    return { directiveId: directive.id, trackPlanId: directive.trackPlanId, position: directive.position, pitch };
  });
  const nctTotal = phraseAnchor.nctPlans.length;
  const nctResolved = phraseAnchor.nctPlans.filter((nct) => realizedByDirective.has(nct.preparationDirectiveId)
    && realizedByDirective.has(nct.resolutionDirectiveId)).length;
  const metrics: FullSongMetrics = {
    densityBySectionOccurrence: {
      [context.prepared.sectionOccurrence.id]: densityMetrics(context, activity, payloadsByTrack, realizedAnchors),
    },
    maxLeapSemitonesByTrack: maxLeaps(payloadsByTrack),
    hardDiagnosticCount: 0,
    plannedNctResolution: countRate(nctResolved, nctTotal),
    sourceChordRespect: countRate(realizedAnchors.length, realizedAnchors.length),
  };
  const ordinals = candidateOrdinalRegistry(context, directives);
  const candidate = await buildArrangementCandidate({
    presetId: context.prepared.presetId,
    candidateStatus: "complete",
    anchorPlanDigest: anchor.plan.anchorPlanDigest,
    effectiveConfigDigest: context.effectiveConfig.digest,
    presetProfileDigest: context.effectiveConfig.presetProfileDigest,
    effectiveChordTimelineDigest: context.prepared.effectiveChordTimeline.digest,
    sourceLeadAtomizationDigest: context.prepared.sourceLeadAtomization.digest,
    tracks: Object.entries(payloadsByTrack).map(([trackPlanId, events]) => ({ trackPlanId, events })),
    realizedAnchors,
    ordinals,
    metrics,
    diagnostics: [],
    canonicalPathKey: anchor.winner.key,
  });
  const legality = validatePayloads(context, anchor, candidate);
  return {
    generationInputDigest,
    candidate,
    payloadsByTrack,
    realizedAnchors,
    rangeChecks: legality.rangeChecks,
    verticalLegalityChecks: legality.verticalChecks,
    nctClassification: legality.nct,
    pitchTrace: trace,
  };
}
