import { canonicalJson, semanticId } from "../../domain/digest/canonical";
import {
  addFractions,
  compareFractions,
  fraction,
  subtractFractions,
} from "../../domain/fraction";
import { containsPitch, pitchMidiNumber } from "../../domain/pitch";
import type {
  CadencePolicy,
  GrammarCandidateTrace,
  PhraseArrangementIntent,
  SectionIntensityTarget,
  TexturePatternId,
} from "../../domain/plans";
import type { VocalPlacementRole } from "../../domain/performer";
import { comparePositions } from "../../domain/time";
import { RC7_FROZEN_CONFIG } from "./config";
import { RC7_TEXTURE_ORDER } from "./constants";
import { deriveRc7Features, type Rc7FeatureAnalysis } from "./features";
import {
  chordTonePitchClass,
  midiToPitch,
  positionInRange,
  positionToGlobalQ,
  rangeDurationQ,
  rangeFromGlobalQ,
  roundHalfUpBasisPoints,
  scaleFraction,
} from "./music";
import { measureDurationsForCase } from "./prepare";
import {
  legalPitchesForObligation,
  resolveRolesAndObligations,
  type Rc7RoleResolution,
} from "./roles";
import {
  constructAccentResponses,
  constructActiveUnisonResponses,
  constructLeadOnlyResponse,
  constructPadResponses,
  constructSuspensionResponses,
  constructTppResponses,
  constructU2sResponses,
  type Rc7ConstructedResponse,
} from "./responses";
import { planRc7Section } from "./section";
import type {
  Rc7GrammarSelection,
  Rc7OpportunitySemanticPayload,
  Rc7PipelineContext,
  Rc7PreparedCase,
  Rc7ResponseSpan,
  Rc7ScoredOpportunity,
  Rc7ScorePart,
  Rc7SymbolicHarmonyRoleObligation,
  Rc7VerifiedAssignedTrack,
} from "./types";

const INELIGIBLE = RC7_FROZEN_CONFIG.ineligibleGrammarScore;

function deriveCadencePolicy(prepared: Rc7PreparedCase): CadencePolicy {
  const sectionEnd = {
    performanceMeasureIndex: prepared.sectionOccurrence.endPerformanceMeasureIndexExclusive,
    offset: fraction(0),
  };
  const relation = comparePositions(prepared.phrase.range.end, sectionEnd);
  if (relation > 0) throw new RangeError("PHRASE_COVERAGE_INVALID");
  if (relation < 0) return "looping";
  if (prepared.sectionDefinition.type === "ending"
    || prepared.sectionOccurrence.variant === "final"
    || prepared.sectionDefinition.type === "chorus"
    || prepared.sectionDefinition.type === "tag") return "closed";
  return "open";
}

function textureOrdinal(textureId: TexturePatternId): number {
  const ordinal = RC7_TEXTURE_ORDER.indexOf(textureId);
  if (ordinal < 0) throw new RangeError(`unknown texture: ${textureId}`);
  return ordinal;
}

function unisonContext(
  prepared: Rc7PreparedCase,
  analysis: Rc7FeatureAnalysis,
  activeFeasible: boolean,
): string {
  if (!activeFeasible) return "active-hard-infeasible";
  if (prepared.sectionOccurrence.variant === "drop") return "drop";
  if (analysis.cues.some((cue) => [
    "late-long-note",
    "lyric-emphasis-confirmed",
    "lyric-emphasis-musicxml-accent-suggested",
    "lead-rest-reentry",
    "active-continuation",
  ].includes(cue.semantic))) return "independent-direct-lift-cue";
  if (["pre-chorus", "chorus", "bridge", "tag", "ending"].includes(prepared.sectionDefinition.type)) {
    return "dense-section-family";
  }
  return "initial-sparse";
}

function attackActivityCost(textureId: TexturePatternId, analysis: Rc7FeatureAnalysis): number {
  const bands = RC7_FROZEN_CONFIG.featureDerivation.leadAttackRatePerQuarterBandsBp;
  if (analysis.leadAttackRatePerQuarterBp <= bands.lowMax) return 0;
  const band = analysis.leadAttackRatePerQuarterBp <= bands.mediumMax
    ? "medium"
    : analysis.leadAttackRatePerQuarterBp <= bands.highMax ? "high" : "very-high";
  return RC7_FROZEN_CONFIG.activityPenaltyCost[band][textureId];
}

function leadRangeCost(textureId: TexturePatternId, analysis: Rc7FeatureAnalysis): number {
  const bands = RC7_FROZEN_CONFIG.featureDerivation.leadRangeBandsSemitones;
  if (analysis.features.leadRangeSemitones <= bands.compactMax) return 0;
  return analysis.features.leadRangeSemitones <= bands.moderateMax
    ? RC7_FROZEN_CONFIG.leadRangePenaltyCost.moderate[textureId]
    : RC7_FROZEN_CONFIG.leadRangePenaltyCost.wide[textureId];
}

function isLateSustainedEmphasis(response: Rc7ConstructedResponse, analysis: Rc7FeatureAnalysis): boolean {
  return Boolean(response.cue
    && (response.cue.semantic === "lyric-emphasis-confirmed"
      || response.cue.semantic === "lyric-emphasis-musicxml-accent-suggested")
    && analysis.cues.some((cue) => cue.semantic === "late-long-note"
      && cue.sourceAtomOrdinal === response.cue!.sourceAtomOrdinal));
}

function cueTextureFitCost(
  textureId: TexturePatternId,
  response: Rc7ConstructedResponse,
  analysis: Rc7FeatureAnalysis,
): number {
  if (!response.cue) return 0;
  const emphasis = response.cue.semantic === "lyric-emphasis-confirmed"
    || response.cue.semantic === "lyric-emphasis-musicxml-accent-suggested";
  if (!emphasis) return textureId === "SUSTAINED_PAD"
    && response.lyricPolicy === "no-new-lyric"
    ? RC7_FROZEN_CONFIG.textureLimits.SUSTAINED_PAD.lyricPolicySubcandidates.noNewLyric.cueCost
    : 0;
  if (textureId === "UNISON_TO_SPLIT" && !isLateSustainedEmphasis(response, analysis)) {
    return RC7_FROZEN_CONFIG.splitPolicy.confirmedEmphasisTextureFit.u2sCostWhenShortOrEarly;
  }
  if (textureId === "ACCENT_BLOCK" && isLateSustainedEmphasis(response, analysis)) {
    return RC7_FROZEN_CONFIG.splitPolicy.confirmedEmphasisTextureFit.accentCostWhenLateSustained;
  }
  if (textureId === "SUSTAINED_PAD" && response.lyricPolicy === "no-new-lyric") {
    return RC7_FROZEN_CONFIG.textureLimits.SUSTAINED_PAD.lyricPolicySubcandidates.noNewLyric.cueCost;
  }
  return 0;
}

function responseCoverageBp(
  prepared: Rc7PreparedCase,
  responseByTrackPlanId: Readonly<Record<string, readonly Rc7ResponseSpan[]>>,
): number {
  const durations = measureDurationsForCase(prepared);
  const phraseDuration = rangeDurationQ(prepared.phrase.range, durations);
  const boundaries = Object.values(responseByTrackPlanId).flatMap((spans) => spans.map((span) => span.range));
  if (boundaries.length === 0) return 0;
  const intervals = boundaries.map((range) => ({
    start: positionToGlobalQ(range.start, durations),
    end: positionToGlobalQ(range.end, durations),
  })).sort((left, right) => compareFractions(left.start, right.start));
  const merged: Array<{ start: typeof intervals[number]["start"]; end: typeof intervals[number]["end"] }> = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && compareFractions(interval.start, previous.end) <= 0) {
      if (compareFractions(interval.end, previous.end) > 0) previous.end = interval.end;
    } else merged.push({ ...interval });
  }
  const active = merged.reduce((sum, interval) => addFractions(sum, subtractFractions(interval.end, interval.start)), fraction(0));
  return roundHalfUpBasisPoints(active, phraseDuration);
}

function scoreParts(
  prepared: Rc7PreparedCase,
  analysis: Rc7FeatureAnalysis,
  target: SectionIntensityTarget,
  textureId: TexturePatternId,
  response: Rc7ConstructedResponse,
  responseByTrackPlanId: Readonly<Record<string, readonly Rc7ResponseSpan[]>>,
  roleCost: number,
  unisonRealizationCost: number,
  secondTrackForgoneCost: number,
): readonly Rc7ScorePart[] {
  const prior = RC7_FROZEN_CONFIG.textureBasePriorCost[prepared.presetId][prepared.sectionDefinition.type][textureId];
  if (prior === null) throw new RangeError("ineligible texture reached scoring");
  const coverageBp = responseCoverageBp(prepared, responseByTrackPlanId);
  const excess = Math.max(0, coverageBp - target.participationCoverageBp);
  const overPolicy = RC7_FROZEN_CONFIG.intensityDeviationCostPerBasisPoint.participation;
  return [
    { code: "sectionTexturePrior", cost: prior },
    { code: "cueCost", cost: response.cue?.cueCost ?? 0 },
    { code: "cueTextureFitCost", cost: cueTextureFitCost(textureId, response, analysis) },
    { code: "leadActivityCost", cost: attackActivityCost(textureId, analysis) },
    { code: "leadRangeCost", cost: leadRangeCost(textureId, analysis) },
    {
      code: "noChordFragmentationCost",
      cost: textureId === "UNISON" ? 0 : Math.floor((analysis.features.noChordCoverageBp + 2) / 5),
    },
    {
      code: "dropVariantCost",
      cost: prepared.sectionOccurrence.variant === "drop" ? RC7_FROZEN_CONFIG.dropTexturePenaltyCost[textureId] : 0,
    },
    { code: "unisonRealizationCost", cost: unisonRealizationCost },
    { code: "secondTrackForgoneCost", cost: secondTrackForgoneCost },
    { code: "roleAssignmentCost", cost: roleCost },
    {
      code: "opportunityOverDensityCost",
      cost: Math.min(overPolicy.perMetricCostCap, excess * overPolicy.over),
    },
  ];
}

function copyResponseByTrack(
  tracks: readonly Rc7VerifiedAssignedTrack[],
  response: Rc7ConstructedResponse,
): Readonly<Record<string, readonly Rc7ResponseSpan[]>> {
  return Object.fromEntries(tracks.map((track) => [track.trackPlanId, response.spans]));
}

function clippedSecondTrackSpans(
  prepared: Rc7PreparedCase,
  analysis: Rc7FeatureAnalysis,
  response: Rc7ConstructedResponse,
): readonly Rc7ResponseSpan[] {
  const first = response.spans[0];
  if (!first) return [];
  const durations = measureDurationsForCase(prepared);
  const startQ = positionToGlobalQ(first.range.start, durations);
  const globalCap = RC7_FROZEN_CONFIG.automaticThreePitchGlobalCap[prepared.presetId];
  const capFromCoverage = scaleFraction(analysis.phraseDurationQ, globalCap.coverageBp, 10_000);
  const capFromPulse = scaleFraction(
    analysis.primaryPulseQ,
    globalCap.maxPulses.n,
    globalCap.maxPulses.d,
  );
  const onePulse = analysis.primaryPulseQ;
  const allowed = [capFromCoverage, capFromPulse, onePulse]
    .sort(compareFractions)[0];
  const endQ = [
    positionToGlobalQ(first.range.end, durations),
    addFractions(startQ, allowed),
  ].sort(compareFractions)[0];
  if (compareFractions(endQ, startQ) <= 0) return [];
  const range = rangeFromGlobalQ(startQ, endQ, durations);
  return [{
    ...first,
    range,
    sourceAtomOrdinals: first.sourceAtomOrdinals.filter((ordinal) => (
      comparePositions(analysis.phraseAtoms[ordinal].range.start, range.end) < 0
    )),
    attackOrdinals: first.attackOrdinals.filter((ordinal) => (
      comparePositions(analysis.phraseAtoms[ordinal].range.start, range.end) < 0
    )),
  }];
}

function directSecondTrackCue(prepared: Rc7PreparedCase, response: Rc7ConstructedResponse): boolean {
  const semantic = response.cue?.semantic;
  const normalized = semantic === "lyric-emphasis-confirmed" || semantic === "lyric-emphasis-musicxml-accent-suggested"
    ? "production-lyric-emphasis"
    : semantic;
  return Boolean(normalized && (prepared.presetId === "standard"
    ? RC7_FROZEN_CONFIG.secondHarmonyTrackPolicy.standardDirectCueClasses.some((value) => value === normalized)
    : prepared.presetId === "full"
      ? RC7_FROZEN_CONFIG.secondHarmonyTrackPolicy.fullDirectCueClasses.some((value) => value === normalized)
      : false));
}

function secondTrackTextureEligible(prepared: Rc7PreparedCase, textureId: TexturePatternId): boolean {
  return prepared.presetId === "standard"
    ? RC7_FROZEN_CONFIG.secondHarmonyTrackPolicy.standardEligibleTextures.includes(textureId)
    : prepared.presetId === "full"
      ? RC7_FROZEN_CONFIG.secondHarmonyTrackPolicy.fullEligibleTextures.includes(textureId)
      : false;
}

function leadDerivedRole(
  track: Rc7VerifiedAssignedTrack,
): VocalPlacementRole {
  return track.previousPlacementRole ?? (track.trackOrdinal === 1 ? "upper" : "lower");
}

function phraseSpanForCanonicalOrdinal(
  analysis: Rc7FeatureAnalysis,
  canonicalOrdinal: number,
) {
  const localOrdinal = analysis.phraseChordSpanOrdinals.indexOf(canonicalOrdinal);
  return localOrdinal < 0 ? undefined : analysis.phraseChordSpans[localOrdinal];
}

function activeUnisonFeasible(
  analysis: Rc7FeatureAnalysis,
  response: Rc7ConstructedResponse,
  track: Rc7VerifiedAssignedTrack,
): boolean {
  const ordinals = new Set(response.spans.flatMap((span) => span.sourceAtomOrdinals));
  return [...ordinals].every((ordinal) => {
    const pitch = analysis.phraseAtoms[ordinal]?.pitch;
    return !pitch || containsPitch(track.hardRange, pitch);
  });
}

function suspensionRoleResolution(
  prepared: Rc7PreparedCase,
  analysis: Rc7FeatureAnalysis,
  response: Rc7ConstructedResponse,
  track: Rc7VerifiedAssignedTrack,
): Rc7RoleResolution | null {
  const chain = response.suspensionChain;
  if (!chain) return null;
  const target = phraseSpanForCanonicalOrdinal(analysis, chain.targetChordSpanOrdinal);
  if (!target || target.parseResult.status !== "ok") return null;
  const targetChord = target.parseResult.chord;
  const obligation: Rc7SymbolicHarmonyRoleObligation = {
    anchorPosition: chain.resolutionPosition,
    chordSpanCanonicalOrdinal: chain.targetChordSpanOrdinal,
    degree: chain.resolutionTone.degree,
    alteration: chain.resolutionTone.alteration,
    role: chain.resolutionTone.role,
    origin: chain.resolutionTone.origin,
  };
  for (const role of ["upper", "lower"] as const) {
    const resolutionPitches = legalPitchesForObligation(analysis, obligation, track, role);
    const contextSpan = phraseSpanForCanonicalOrdinal(analysis, chain.contextChordSpanOrdinal);
    if (!contextSpan) return null;
    const contextParseResult = contextSpan.parseResult;
    const heldPc = chordTonePitchClass(
      contextParseResult.status === "ok" ? contextParseResult.chord : targetChord,
      chain.heldTone,
    );
    if (resolutionPitches.some((pitch) => {
      const direction = chain.resolutionDirection === "down" ? 1 : -1;
      return [1, 2].some((distance) => {
        const expectedHeld = pitchMidiNumber(pitch) + direction * distance;
        return ((expectedHeld % 12) + 12) % 12 === heldPc
          && containsPitch(track.hardRange, midiToPitch(expectedHeld));
      });
    })) return {
      roleByTrackPlanId: { [track.trackPlanId]: role },
      primary: [obligation],
      secondary: [],
      rangeStressCostByTrackOrdinal: { [track.trackOrdinal]: 0 },
    };
  }
  return null;
}

function padRoleResolution(
  prepared: Rc7PreparedCase,
  analysis: Rc7FeatureAnalysis,
  response: Rc7ConstructedResponse,
  track: Rc7VerifiedAssignedTrack,
): Rc7RoleResolution | null {
  const firstSpan = response.spans[0];
  if (!firstSpan) return null;
  const chordSpans = analysis.phraseChordSpans.filter((span) => (
    comparePositions(span.range.start, firstSpan.range.end) < 0
      && comparePositions(span.range.end, firstSpan.range.start) > 0
      && span.parseResult.status === "ok"
  ));
  if (chordSpans.length === 0 || chordSpans[0].parseResult.status !== "ok") return null;
  const firstChord = chordSpans[0].parseResult.chord;
  const commonPcs = chordSpans.slice(1).reduce((set, span) => {
    const parseResult = span.parseResult;
    if (parseResult.status !== "ok") return new Set<number>();
    const pcs = new Set(parseResult.chord.tones.map((tone) => chordTonePitchClass(parseResult.chord, tone)));
    return new Set([...set].filter((pc) => pcs.has(pc)));
  }, new Set(firstChord.tones.map((tone) => chordTonePitchClass(firstChord, tone))));
  const leadAttacks = analysis.phraseAtoms.filter((atom) => atom.pitch
    && !atom.tiedFromPrevious
    && positionInRange(atom.range.start, firstSpan.range));
  for (const role of ["upper", "lower"] as const) {
    for (const tone of firstChord.tones) {
      if (!commonPcs.has(chordTonePitchClass(firstChord, tone))) continue;
      const obligation: Rc7SymbolicHarmonyRoleObligation = {
        anchorPosition: firstSpan.range.start,
        chordSpanCanonicalOrdinal: analysis.phraseChordSpanOrdinals[
          analysis.phraseChordSpans.indexOf(chordSpans[0])
        ],
        degree: tone.degree,
        alteration: tone.alteration,
        role: tone.role,
        origin: tone.origin,
      };
      const legal = legalPitchesForObligation(analysis, obligation, track, role).filter((candidate) => leadAttacks.every((atom) => {
        const interval = Math.abs(pitchMidiNumber(candidate) - pitchMidiNumber(atom.pitch!));
        return interval !== 0 && interval !== 1 && interval !== 12;
      }));
      if (legal.length > 0) return {
        roleByTrackPlanId: { [track.trackPlanId]: role },
        primary: [obligation],
        secondary: [],
        rangeStressCostByTrackOrdinal: { [track.trackOrdinal]: 0 },
      };
    }
  }
  return null;
}

function responseConstructors(
  textureId: TexturePatternId,
  prepared: Rc7PreparedCase,
  analysis: Rc7FeatureAnalysis,
  target: SectionIntensityTarget,
): readonly Rc7ConstructedResponse[] {
  if (textureId === "UNISON") {
    return [constructLeadOnlyResponse(), ...constructActiveUnisonResponses(prepared, analysis, target.maxHarmonyAttackRatioBp)];
  }
  if (textureId === "UNISON_TO_SPLIT") return constructU2sResponses(prepared, analysis, target.maxHarmonyAttackRatioBp);
  if (textureId === "TWO_PART_PARALLEL") return constructTppResponses(prepared, analysis, target.maxHarmonyAttackRatioBp);
  if (textureId === "ACCENT_BLOCK") return constructAccentResponses(prepared, analysis, target.maxHarmonyAttackRatioBp);
  if (textureId === "SUSTAINED_PAD") return constructPadResponses(prepared, analysis);
  return constructSuspensionResponses(prepared, analysis);
}

async function scoredOpportunity(
  context: Rc7PipelineContext,
  analysis: Rc7FeatureAnalysis,
  target: SectionIntensityTarget,
  assignedTracks: readonly Rc7VerifiedAssignedTrack[],
  textureId: TexturePatternId,
  response: Rc7ConstructedResponse,
  trackCount: 0 | 1 | 2,
  roles: Rc7RoleResolution,
  secondTrackForgoneCost: number,
): Promise<Rc7ScoredOpportunity> {
  const activeTracks = assignedTracks.slice(0, trackCount);
  const responseByTrackPlanId = copyResponseByTrack(activeTracks, response);
  if (trackCount === 2) {
    const second = activeTracks[1];
    (responseByTrackPlanId as Record<string, readonly Rc7ResponseSpan[]>)[second.trackPlanId] = clippedSecondTrackSpans(context.prepared, analysis, response);
  }
  const activeTrackOrdinals = activeTracks.map((track) => track.trackOrdinal);
  const roleTuple = activeTracks.map((track) => roles.roleByTrackPlanId[track.trackPlanId]);
  const allSpans = activeTracks.flatMap((track) => responseByTrackPlanId[track.trackPlanId] ?? []);
  const payload: Rc7OpportunitySemanticPayload = {
    textureOrdinal: textureOrdinal(textureId),
    activeTrackOrdinals,
    roleTuple,
    normalizedCueSemantic: response.cue?.semantic ?? null,
    splitPositionOrNull: response.splitPosition,
    sourceAtomCanonicalOrdinals: [...new Set(allSpans.flatMap((span) => span.sourceAtomOrdinals))].sort((a, b) => a - b),
    exactRanges: allSpans.map((span) => span.range),
    attackOrdinals: [...new Set(allSpans.flatMap((span) => span.attackOrdinals))].sort((a, b) => a - b),
    lyricPolicy: response.lyricPolicy,
    mandatoryAnchorPositions: response.mandatoryAnchorPositions,
    primaryHarmonyRoleObligationVector: roles.primary,
    secondTrackRoleContributionVector: roles.secondary,
    responseConstructorId: response.responseConstructorId,
  };
  const key = await semanticId("opp", payload);
  const activeFeasible = assignedTracks.length > 0
    && (trackCount === 0 || activeUnisonFeasible(analysis, response, assignedTracks[0]));
  const contextName = unisonContext(context.prepared, analysis, activeFeasible);
  const unisonCost = textureId === "UNISON"
    ? (trackCount === 0
      ? RC7_FROZEN_CONFIG.textureLimits.UNISON.realizationClassifier.contexts[contextName].leadOnlyCost
      : RC7_FROZEN_CONFIG.textureLimits.UNISON.realizationClassifier.contexts[contextName].activeCost ?? INELIGIBLE)
    : 0;
  const roleCost = Object.values(roles.rangeStressCostByTrackOrdinal).reduce((sum, value) => sum + value, 0);
  const parts = scoreParts(
    context.prepared,
    analysis,
    target,
    textureId,
    response,
    responseByTrackPlanId,
    roleCost,
    unisonCost,
    secondTrackForgoneCost,
  );
  const totalScore = parts.reduce((sum, part) => sum + part.cost, 0);
  if (!Number.isSafeInteger(totalScore) || totalScore >= RC7_FROZEN_CONFIG.maxEligibleGrammarScoreExclusive) {
    throw new RangeError("GRAMMAR_SCORE_INVALID");
  }
  return {
    key,
    textureId,
    cadencePolicy: deriveCadencePolicy(context.prepared),
    splitReason: response.splitReason,
    activeTrackPlanIds: activeTracks.map((track) => track.trackPlanId),
    activeTrackOrdinals,
    roleByTrackPlanId: roles.roleByTrackPlanId,
    responseByTrackPlanId,
    semanticPayload: payload,
    scoreParts: parts,
    totalScore,
    reasonOrdinal: response.cue?.reasonOrdinal ?? 0,
    canonicalSubcandidateKey: canonicalJson({ payload, cadencePolicy: deriveCadencePolicy(context.prepared) }),
    rangeStressCostByTrackOrdinal: roles.rangeStressCostByTrackOrdinal,
    suspensionChain: response.suspensionChain,
  };
}

function compareOpportunities(left: Rc7ScoredOpportunity, right: Rc7ScoredOpportunity): number {
  if (left.totalScore !== right.totalScore) return left.totalScore - right.totalScore;
  if (textureOrdinal(left.textureId) !== textureOrdinal(right.textureId)) {
    return textureOrdinal(left.textureId) - textureOrdinal(right.textureId);
  }
  const leftSplit = left.semanticPayload.splitPositionOrNull;
  const rightSplit = right.semanticPayload.splitPositionOrNull;
  if (Boolean(leftSplit) !== Boolean(rightSplit)) return leftSplit ? 1 : -1;
  if (leftSplit && rightSplit) {
    const position = comparePositions(leftSplit, rightSplit);
    if (position !== 0) return position;
  }
  const leftTracks = left.activeTrackOrdinals.join(",");
  const rightTracks = right.activeTrackOrdinals.join(",");
  if (leftTracks !== rightTracks) return leftTracks < rightTracks ? -1 : 1;
  const leftRoles = left.semanticPayload.roleTuple.join(",");
  const rightRoles = right.semanticPayload.roleTuple.join(",");
  if (leftRoles !== rightRoles) return leftRoles < rightRoles ? -1 : 1;
  if (left.key !== right.key) return left.key < right.key ? -1 : 1;
  return left.canonicalSubcandidateKey < right.canonicalSubcandidateKey ? -1
    : left.canonicalSubcandidateKey > right.canonicalSubcandidateKey ? 1 : 0;
}

function nominalUnisonRoles(track: Rc7VerifiedAssignedTrack): Rc7RoleResolution {
  return {
    roleByTrackPlanId: { [track.trackPlanId]: leadDerivedRole(track) },
    primary: [],
    secondary: [],
    rangeStressCostByTrackOrdinal: { [track.trackOrdinal]: 0 },
  };
}

function satisfiesPlacementRoleLocks(
  context: Rc7PipelineContext,
  roles: Rc7RoleResolution,
): boolean {
  return context.prepared.locks.intent
    .filter((lock) => lock.kind === "placement-role")
    .every((lock) => roles.roleByTrackPlanId[lock.trackPlanId] === lock.placementRole);
}

async function enumerateTexture(
  context: Rc7PipelineContext,
  analysis: Rc7FeatureAnalysis,
  target: SectionIntensityTarget,
  assignedTracks: readonly Rc7VerifiedAssignedTrack[],
  textureId: TexturePatternId,
): Promise<readonly Rc7ScoredOpportunity[]> {
  const prior = RC7_FROZEN_CONFIG.textureBasePriorCost[context.prepared.presetId][context.prepared.sectionDefinition.type][textureId];
  if (prior === null) return [];
  const textureLocks = context.prepared.locks.intent.filter((lock) => lock.kind === "texture");
  if (textureLocks.some((lock) => lock.textureId !== textureId)) return [];
  const responses = responseConstructors(textureId, context.prepared, analysis, target);
  const results: Rc7ScoredOpportunity[] = [];
  for (const response of responses) {
    if (textureId === "UNISON" && response.spans.length === 0) {
      const roles: Rc7RoleResolution = { roleByTrackPlanId: {}, primary: [], secondary: [], rangeStressCostByTrackOrdinal: {} };
      if (satisfiesPlacementRoleLocks(context, roles)) {
        results.push(await scoredOpportunity(context, analysis, target, assignedTracks, textureId, response, 0, roles, 0));
      }
      continue;
    }
    if (assignedTracks.length === 0) continue;
    let oneTrackRoles: Rc7RoleResolution | null;
    if (textureId === "UNISON") {
      if (!activeUnisonFeasible(analysis, response, assignedTracks[0])) continue;
      oneTrackRoles = nominalUnisonRoles(assignedTracks[0]);
    } else if (textureId === "SUSPENSION_RELEASE") {
      oneTrackRoles = suspensionRoleResolution(context.prepared, analysis, response, assignedTracks[0]);
    } else if (textureId === "SUSTAINED_PAD") {
      oneTrackRoles = padRoleResolution(context.prepared, analysis, response, assignedTracks[0]);
    } else {
      oneTrackRoles = resolveRolesAndObligations(
        context.prepared,
        analysis,
        assignedTracks,
        1,
        response.mandatoryAnchorPositions,
      );
    }
    if (!oneTrackRoles) continue;

    const mayUseSecond = context.effectiveConfig.maxHarmonyTracks >= 2
      && assignedTracks.length >= 2
      && RC7_FROZEN_CONFIG.secondHarmonyTrackPolicy.eligibleSections.includes(context.prepared.sectionDefinition.type)
      && directSecondTrackCue(context.prepared, response)
      && secondTrackTextureEligible(context.prepared, textureId)
      && response.mandatoryAnchorPositions.length > 0;
    let twoTrackRoles: Rc7RoleResolution | null = null;
    if (mayUseSecond) {
      twoTrackRoles = resolveRolesAndObligations(
        context.prepared,
        analysis,
        assignedTracks,
        2,
        response.mandatoryAnchorPositions,
      );
      if (twoTrackRoles && clippedSecondTrackSpans(context.prepared, analysis, response).length === 0) twoTrackRoles = null;
    }
    const forgone = twoTrackRoles
      ? RC7_FROZEN_CONFIG.secondHarmonyTrackPolicy.oneTrackSiblingForgoneCost[context.prepared.presetId] ?? 0
      : 0;
    if (satisfiesPlacementRoleLocks(context, oneTrackRoles)) results.push(await scoredOpportunity(
      context,
      analysis,
      target,
      assignedTracks,
      textureId,
      response,
      1,
      oneTrackRoles,
      forgone,
    ));
    if (twoTrackRoles && satisfiesPlacementRoleLocks(context, twoTrackRoles)) results.push(await scoredOpportunity(
      context,
      analysis,
      target,
      assignedTracks,
      textureId,
      response,
      2,
      twoTrackRoles,
      0,
    ));
  }
  return results.sort(compareOpportunities);
}

export async function planRc7Phrase(
  context: Rc7PipelineContext,
  assignedTracks: readonly Rc7VerifiedAssignedTrack[],
): Promise<Rc7GrammarSelection> {
  const analysis = deriveRc7Features(context.prepared);
  const intensityTarget = planRc7Section(context, analysis);
  const byTexture = await Promise.all(RC7_TEXTURE_ORDER.map(async (textureId) => ({
    textureId,
    values: await enumerateTexture(context, analysis, intensityTarget, assignedTracks, textureId),
  })));
  const orderedOpportunities = byTexture.flatMap((entry) => entry.values).sort(compareOpportunities);
  const opportunities = [...new Map(orderedOpportunities.map((candidate) => [candidate.key, candidate])).values()]
    .sort(compareOpportunities);
  if (opportunities.length === 0) throw new RangeError("NO_ELIGIBLE_TEXTURE");
  const trace: GrammarCandidateTrace[] = byTexture.map(({ textureId, values }) => values[0]
    ? {
        id: `trace:${context.prepared.caseId}:${textureOrdinal(textureId)}`,
        phraseId: context.prepared.phrase.id,
        presetId: context.prepared.presetId,
        textureId,
        eligible: true,
        score: values[0].totalScore as GrammarCandidateTrace["score"],
        reasonCodes: ["WAGV1_ELIGIBLE", "WAGV1_EXACT_RESPONSE_CONSTRUCTOR"],
      }
    : {
        id: `trace:${context.prepared.caseId}:${textureOrdinal(textureId)}`,
        phraseId: context.prepared.phrase.id,
        presetId: context.prepared.presetId,
        textureId,
        eligible: false,
        score: INELIGIBLE as GrammarCandidateTrace["score"],
        reasonCodes: ["WAGV1_ACTIVATION_CUE_REQUIRED"],
      });
  return {
    features: analysis.features,
    intensityTarget,
    cues: analysis.cues,
    opportunities,
    trace,
    winner: opportunities[0],
  };
}

export function reconstructWinningOpportunity(
  selection: Rc7GrammarSelection,
  intent: Pick<PhraseArrangementIntent, "textureId" | "lyricPolicy" | "cadencePolicy" | "splitDirective">,
  trackOrdinals: readonly number[],
  roleTuple: readonly VocalPlacementRole[],
): Rc7ScoredOpportunity {
  const compatible = selection.opportunities.filter((candidate) => candidate.textureId === intent.textureId
    && canonicalJson(candidate.activeTrackOrdinals) === canonicalJson(trackOrdinals)
    && canonicalJson(candidate.semanticPayload.roleTuple) === canonicalJson(roleTuple)
    && candidate.semanticPayload.lyricPolicy === intent.lyricPolicy
    && candidate.cadencePolicy === intent.cadencePolicy
    && canonicalJson(candidate.semanticPayload.splitPositionOrNull)
      === canonicalJson(intent.splitDirective?.position ?? null));
  const ordered = compatible.sort(compareOpportunities);
  if (!ordered[0]) throw new RangeError("ACTIVITY_SPAN_INVALID:automatic opportunity missing");
  if (new Set(ordered.map((candidate) => candidate.key)).size !== ordered.length) {
    throw new RangeError("ACTIVITY_SPAN_INVALID:duplicate automatic opportunity key");
  }
  return ordered[0];
}

export function compareRc7Opportunities(left: Rc7ScoredOpportunity, right: Rc7ScoredOpportunity): number {
  return compareOpportunities(left, right);
}
