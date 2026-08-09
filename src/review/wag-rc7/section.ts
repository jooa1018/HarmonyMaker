import { basisPoints, extendedBasisPoints } from "../../domain/rates";
import type { SectionIntensityTarget } from "../../domain/plans";
import { RC7_FROZEN_CONFIG } from "./config";
import type { Rc7PipelineContext } from "./types";
import type { Rc7FeatureAnalysis } from "./features";

function roundHalfUp(value: number, numerator: number, denominator = 100): number {
  return Math.floor((value * numerator * 2 + denominator) / (2 * denominator));
}

export function planRc7Section(
  context: Rc7PipelineContext,
  analysis: Rc7FeatureAnalysis,
): SectionIntensityTarget {
  const { prepared, effectiveConfig } = context;
  const source = RC7_FROZEN_CONFIG.sectionIntensityBase[prepared.presetId][prepared.sectionDefinition.type];
  let participation = source.P;
  let twoPitch = source.D2;
  let threePitch = source.D3;
  let attack = source.A;
  let spreadMin = source.spread[0];
  let spreadMax = source.spread[1];
  let maxActiveVoiceCount = Math.min(source.V, effectiveConfig.maxActiveVoiceCount) as 1 | 2 | 3;

  if (prepared.sectionOccurrence.variant === "drop") {
    const drop = RC7_FROZEN_CONFIG.sectionVariantTransform.drop;
    participation = roundHalfUp(participation, drop.participationPercent);
    twoPitch = roundHalfUp(twoPitch, drop.twoPitchPercent);
    threePitch = drop.threePitchSetTo;
    attack = roundHalfUp(attack, drop.attackPercent);
    maxActiveVoiceCount = Math.min(maxActiveVoiceCount, drop.maxActiveVoiceCountCap) as 1 | 2;
    spreadMax = Math.min(spreadMax, drop.registerSpreadMaxCapSemitones);
  }

  if (effectiveConfig.maxHarmonyTracks === 0) {
    participation = 0;
    twoPitch = 0;
    threePitch = 0;
    attack = 0;
    spreadMin = 0;
    spreadMax = 0;
    maxActiveVoiceCount = 1;
  } else if (effectiveConfig.maxHarmonyTracks === 1) {
    twoPitch = Math.min(participation, twoPitch + Math.floor((threePitch + 1) / 2));
    threePitch = 0;
    maxActiveVoiceCount = Math.min(maxActiveVoiceCount, 2) as 1 | 2;
    spreadMax = Math.min(spreadMax, 12);
  }

  const chordCoverage = 10_000 - analysis.features.noChordCoverageBp;
  participation = roundHalfUp(participation, chordCoverage, 10_000);
  twoPitch = roundHalfUp(twoPitch, chordCoverage, 10_000);
  threePitch = roundHalfUp(threePitch, chordCoverage, 10_000);
  attack = roundHalfUp(attack, chordCoverage, 10_000);
  attack = Math.min(attack, effectiveConfig.maxHarmonyAttackRatioBp);
  if (maxActiveVoiceCount < 3) threePitch = 0;
  if (twoPitch + threePitch > participation) {
    twoPitch = Math.max(0, participation - threePitch);
  }
  if (twoPitch + threePitch === 0) {
    spreadMin = 0;
    spreadMax = 0;
  }
  if (participation < 0 || participation > 10_000
    || twoPitch < 0 || threePitch < 0
    || twoPitch + threePitch > participation) {
    throw new RangeError("SECTION_INTENSITY_INFEASIBLE");
  }

  return {
    participationCoverageBp: basisPoints(participation),
    harmonicDivergenceCoverageBp: basisPoints(twoPitch + threePitch),
    exactlyTwoPitchCoverageBp: basisPoints(twoPitch),
    exactlyThreePitchCoverageBp: basisPoints(threePitch),
    maxHarmonyAttackRatioBp: extendedBasisPoints(attack),
    registerSpreadRange: [spreadMin, spreadMax],
    maxActiveVoiceCount,
  };
}
