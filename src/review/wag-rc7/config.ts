import {
  createPresetProfileRegistry,
  type ArrangementPresetId,
  type PresetDifficultyProfile,
} from "../../domain/config";
import { canonicalJson, semanticDigest, type SemanticDigest } from "../../domain/digest/canonical";
import type { SectionType } from "../../domain/source/model";
import type { TexturePatternId } from "../../domain/plans";
import frozenProjection from "./worship-arrangement-grammar-v1.rc7.canonical.json";
import {
  RC7_GRAMMAR_CONFIG_DIGEST,
  RC7_GRAMMAR_ID,
  RC7_GRAMMAR_VERSION,
  RC7_PRESET_ORDER,
  RC7_REVIEW_VERSIONS,
  RC7_TEXTURE_ORDER,
} from "./constants";

interface ConfigFraction {
  readonly n: number;
  readonly d: number;
}

interface IntensityRow {
  readonly P: number;
  readonly D2: number;
  readonly D3: number;
  readonly A: number;
  readonly spread: readonly [number, number];
  readonly V: 1 | 2 | 3;
}

interface UnisonContext {
  readonly leadOnlyCost: number;
  readonly leadOnlyEligible: boolean;
  readonly activeCost: number | null;
  readonly activeEligible: boolean | string;
  readonly activeRequiresAnyCue?: readonly string[];
  readonly sectionTypes?: readonly SectionType[];
}

export interface Rc7GrammarConfig {
  readonly grammarId: typeof RC7_GRAMMAR_ID;
  readonly grammarVersion: typeof RC7_GRAMMAR_VERSION;
  readonly canonicalOrders: {
    readonly texture: readonly TexturePatternId[];
    readonly preset: readonly ArrangementPresetId[];
    readonly section: readonly SectionType[];
    readonly placementRole: readonly ("upper" | "lower")[];
  };
  readonly presetProfileMirror: Readonly<Record<ArrangementPresetId, Omit<PresetDifficultyProfile, "presetId">>>;
  readonly sectionIntensityBase: Readonly<Record<ArrangementPresetId, Readonly<Record<SectionType, IntensityRow>>>>;
  readonly sectionVariantTransform: {
    readonly drop: {
      readonly participationPercent: number;
      readonly twoPitchPercent: number;
      readonly threePitchSetTo: number;
      readonly attackPercent: number;
      readonly maxActiveVoiceCountCap: 2;
      readonly registerSpreadMaxCapSemitones: number;
    };
  };
  readonly textureBasePriorCost: Readonly<Record<ArrangementPresetId, Readonly<Record<SectionType, Readonly<Record<TexturePatternId, number | null>>>>>>;
  readonly textureLimits: {
    readonly UNISON: {
      readonly activeUnisonBoundedCoverageBp: Readonly<Record<ArrangementPresetId, { readonly min: number; readonly max: number }>>;
      readonly activeUnisonMinimumLeadAttacks: number;
      readonly fullPhraseAttackForAttackAutomaticAllowed: false;
      readonly realizationClassifier: {
        readonly contexts: Readonly<Record<string, UnisonContext>>;
        readonly independentDirectLiftCueClasses: readonly string[];
        readonly precedence: readonly string[];
      };
    };
    readonly UNISON_TO_SPLIT: {
      readonly automaticHarmonyTracksMax: Readonly<Record<ArrangementPresetId, number>>;
      readonly minPhrasePulses: Readonly<Record<ArrangementPresetId, number>>;
      readonly secondTrackAllowedSections: readonly SectionType[];
      readonly secondTrackMaxThreePitchPhraseCoverageBp: Readonly<Record<ArrangementPresetId, number>>;
    };
    readonly TWO_PART_PARALLEL: {
      readonly boundedWindowCoverageBp: Readonly<Record<ArrangementPresetId, { readonly min: number; readonly max: number }>>;
      readonly boundedWindowMinimumRun: {
        readonly minimumLeadAttacks: number;
        readonly minimumPrimaryPulses: ConfigFraction;
      };
      readonly entryCueClasses: readonly string[];
      readonly fullPhraseAutomatic: { readonly allowed: false };
    };
    readonly ACCENT_BLOCK: {
      readonly automaticThreePitchPhraseCoverageCapBp: Readonly<Record<ArrangementPresetId, number>>;
      readonly maxBlocksPerPhrase: Readonly<Record<ArrangementPresetId, number>>;
      readonly minOnsetSpacingPulses: Readonly<Record<ArrangementPresetId, ConfigFraction>>;
    };
    readonly SUSTAINED_PAD: {
      readonly automaticHarmonyTracksMax: Readonly<Record<ArrangementPresetId, number>>;
      readonly automaticSingleSustainCapPulses: Readonly<Record<ArrangementPresetId, number>>;
      readonly minCommonTonePrimaryPulses: Readonly<Record<ArrangementPresetId, number>>;
      readonly secondTrackAllowedSections: readonly SectionType[];
      readonly lyricPolicySubcandidates: {
        readonly holdCurrentVowel: { readonly cueCost: number };
        readonly noNewLyric: { readonly cueCost: number };
      };
      readonly sustainedPitchVerticalPolicy: {
        readonly transientUnisonOrWholeStep: {
          readonly cost: number;
          readonly maximumCoverageBp: number;
          readonly maximumConsecutivePrimaryPulseFraction: ConfigFraction;
        };
      };
    };
    readonly SUSPENSION_RELEASE: {
      readonly maxOpportunitiesPerPhrase: Readonly<Record<ArrangementPresetId, number>>;
      readonly resolutionDeadlinePrimaryPulses: ConfigFraction;
      readonly entryCueClasses: readonly string[];
    };
  };
  readonly activityResponseConstructors: Readonly<Record<string, { readonly responseConstructorId: string }>>;
  readonly activityPenaltyCost: Readonly<Record<"medium" | "high" | "very-high", Readonly<Record<TexturePatternId, number>>>>;
  readonly leadRangePenaltyCost: Readonly<Record<"moderate" | "wide", Readonly<Record<TexturePatternId, number>>>>;
  readonly dropTexturePenaltyCost: Readonly<Record<TexturePatternId, number>>;
  readonly splitCueCost: {
    readonly confirmedLateLongNote: number;
    readonly confirmedLyricEmphasis: number;
    readonly lateChordChange: number;
    readonly musicXmlAccentSuggested: number;
    readonly phraseMidpointFallbackLockedOnly: number;
  };
  readonly splitPolicy: {
    readonly automaticMidpointAllowedPresets: readonly ArrangementPresetId[];
    readonly lockedMidpointFallbackAllowedPresets: readonly ArrangementPresetId[];
    readonly midpointAllowedSections: readonly SectionType[];
    readonly midpointMaxLeadAttackRateBp: number;
    readonly midpointMinPhrasePulses: number;
    readonly minPostSplitPrimaryPulses: Readonly<Record<ArrangementPresetId, ConfigFraction>>;
    readonly confirmedEmphasisTextureFit: {
      readonly accentCostWhenLateSustained: number;
      readonly u2sCostWhenShortOrEarly: number;
    };
  };
  readonly accentCueCost: {
    readonly confirmedEmphasis: number;
    readonly musicXmlSuggestedAccent: number;
    readonly confirmedEmphasisTextureFit: {
      readonly lateSustainedEmphasisAdditionalCost: number;
      readonly shortOrEarlyEmphasisAdditionalCost: number;
      readonly u2sShortOrEarlyCompetingCost: number;
    };
  };
  readonly featureDerivation: {
    readonly lateRegionStartRatio: ConfigFraction;
    readonly lateLongNoteMinPrimaryPulses: ConfigFraction;
    readonly lateChordChangeMinRemainingPrimaryPulses: ConfigFraction;
    readonly leadAttackRatePerQuarterBandsBp: {
      readonly lowMax: number;
      readonly mediumMax: number;
      readonly highMax: number;
    };
    readonly leadRangeBandsSemitones: {
      readonly compactMax: number;
      readonly moderateMax: number;
    };
  };
  readonly automaticThreePitchGlobalCap: Readonly<Record<ArrangementPresetId, { readonly coverageBp: number; readonly maxPulses: ConfigFraction }>>;
  readonly secondHarmonyTrackPolicy: {
    readonly eligibleSections: readonly SectionType[];
    readonly standardDirectCueClasses: readonly string[];
    readonly fullDirectCueClasses: readonly string[];
    readonly standardEligibleTextures: readonly TexturePatternId[];
    readonly fullEligibleTextures: readonly TexturePatternId[];
    readonly oneTrackSiblingForgoneCost: Readonly<Record<ArrangementPresetId, number | null>>;
    readonly requiresBothTracksComfortableMissBp: number;
  };
  readonly rolePolicy: {
    readonly comfortableMissCostBandsBp: readonly { readonly maxMissBp: number; readonly cost: number }[];
    readonly preferredMissCostBandsBp: readonly { readonly maxMissBp: number; readonly cost: number }[];
    readonly roleChangeCost: Readonly<Record<ArrangementPresetId, number | null>>;
    readonly preferredIndependentVerticalIntervalSemitones: readonly [number, number];
    readonly maxIndependentVerticalIntervalSemitones: number;
  };
  readonly pitchRanking: {
    readonly identityContextCost: {
      readonly candidateMissesAvailableMissingIdentityCriticalRole: number;
      readonly candidateSuppliesMissingIdentityCriticalRole: number;
      readonly duplicatesIdentityCriticalRoleAlreadyInLead: number;
      readonly wholeStackMissingIdentityCriticalRoleCost: number;
    };
    readonly identityPriorityStepCost: number;
    readonly roleBaseCost: Readonly<Record<string, number>>;
    readonly leadDuplicateAdditionalCost: Readonly<Record<string, number>>;
    readonly tessituraCost: {
      readonly insidePreferred: number;
      readonly insideComfortableOutsidePreferred: number;
      readonly insideHardOutsideComfortable: number;
      readonly longSustainOutsideComfortableAdditionalBase: number;
      readonly longSustainOutsideComfortablePerPulseAfterFirst: number;
      readonly longSustainOutsideComfortableAdditionalCap: number;
    };
    readonly melodicMotionCostBySemitones: readonly { readonly min: number; readonly max: number; readonly cost: number }[];
    readonly abovePreferredLeapAdditionalCost: number;
    readonly verticalIntervalToLead: readonly { readonly semitones: number; readonly cost: number | null; readonly policy: string }[];
    readonly twoHarmonyJointRules: {
      readonly adjacentIntervalMinSemitones: number;
      readonly adjacentIntervalAbove12Cost: number;
      readonly registerSpreadOutsideTargetPerSemitoneCost: number;
    };
  };
  readonly nctPolicy: Readonly<Record<ArrangementPresetId, {
    readonly allowedKinds: readonly string[];
    readonly maxPerPhrasePerTrack: number;
    readonly maxSimultaneous: number;
  }>>;
  readonly nctSelectionCost: Readonly<Record<string, unknown>>;
  readonly reasonCodes: readonly string[];
  readonly intensityDeviationCostPerBasisPoint: {
    readonly participation: { readonly over: number; readonly perMetricCostCap: number };
  };
  readonly ineligibleGrammarScore: number;
  readonly maxEligibleGrammarScoreExclusive: number;
  readonly rc7FixedSemanticContract: Readonly<Record<string, unknown>>;
}

interface FrozenProjection {
  readonly projectionSchema: "hm-worship-arrangement-grammar-config-v1";
  readonly value: Rc7GrammarConfig;
}

const projection = frozenProjection as unknown as FrozenProjection;

function sameProfile(
  left: PresetDifficultyProfile,
  right: Omit<PresetDifficultyProfile, "presetId">,
): boolean {
  const productProfile = Object.fromEntries(Object.entries(left).filter(([key]) => key !== "presetId"));
  return canonicalJson(productProfile) === canonicalJson(right);
}

export async function verifyFrozenRc7Config(): Promise<{
  readonly config: Rc7GrammarConfig;
  readonly digest: SemanticDigest;
}> {
  if (projection.projectionSchema !== "hm-worship-arrangement-grammar-config-v1") {
    throw new RangeError("RC7_CONFIG_PROJECTION_SCHEMA_MISMATCH");
  }
  const digest = await semanticDigest(projection);
  if (digest !== RC7_GRAMMAR_CONFIG_DIGEST) {
    throw new RangeError("RC7_GRAMMAR_CONFIG_DIGEST_MISMATCH");
  }
  const config = projection.value;
  if (config.grammarId !== RC7_GRAMMAR_ID || config.grammarVersion !== RC7_GRAMMAR_VERSION) {
    throw new RangeError("RC7_GRAMMAR_VERSION_MISMATCH");
  }
  if (JSON.stringify(config.canonicalOrders.texture) !== JSON.stringify(RC7_TEXTURE_ORDER)
    || JSON.stringify(config.canonicalOrders.preset) !== JSON.stringify(RC7_PRESET_ORDER)) {
    throw new RangeError("RC7_CANONICAL_ORDER_MISMATCH");
  }
  if (config.textureLimits.TWO_PART_PARALLEL.fullPhraseAutomatic.allowed
    || config.textureLimits.UNISON.fullPhraseAttackForAttackAutomaticAllowed) {
    throw new RangeError("RC7_AUTOMATIC_FULL_PHRASE_REENABLED");
  }
  const registry = await createPresetProfileRegistry("preset-profile-v1");
  for (const presetId of RC7_PRESET_ORDER) {
    if (!sameProfile(registry.profiles[presetId], config.presetProfileMirror[presetId])) {
      throw new RangeError(`RC7_PRESET_PROFILE_MIRROR_MISMATCH:${presetId}`);
    }
  }
  return { config, digest };
}

export async function createRc7StageConfigDigests(): Promise<{
  readonly plannerConfigDigest: SemanticDigest;
  readonly activityPlannerConfigDigest: SemanticDigest;
  readonly anchorPlannerConfigDigest: SemanticDigest;
  readonly solverConfigDigest: SemanticDigest;
  readonly assemblerConfigDigest: SemanticDigest;
  readonly validatorConfigDigest: SemanticDigest;
  readonly metricConfigDigest: SemanticDigest;
  readonly diagnosticRegistryDigest: SemanticDigest;
}> {
  const stageDigest = (stage: string, version: string) => semanticDigest({
    projectionSchema: "hm-wag-rc7-review-stage-config-v1",
    stage,
    version,
    grammarConfigDigest: RC7_GRAMMAR_CONFIG_DIGEST,
  });
  return {
    plannerConfigDigest: await stageDigest("intent", RC7_REVIEW_VERSIONS.plannerVersion),
    activityPlannerConfigDigest: await stageDigest("activity", RC7_REVIEW_VERSIONS.activityPlannerVersion),
    anchorPlannerConfigDigest: await stageDigest("anchor", RC7_REVIEW_VERSIONS.anchorPlannerVersion),
    solverConfigDigest: await stageDigest("solver", RC7_REVIEW_VERSIONS.solverVersion),
    assemblerConfigDigest: await stageDigest("assembler", RC7_REVIEW_VERSIONS.assemblerVersion),
    validatorConfigDigest: await stageDigest("validator", RC7_REVIEW_VERSIONS.validatorVersion),
    metricConfigDigest: await stageDigest("metrics", RC7_REVIEW_VERSIONS.metricsVersion),
    diagnosticRegistryDigest: await semanticDigest({
      projectionSchema: "hm-wag-rc7-review-diagnostic-registry-v1",
      version: RC7_REVIEW_VERSIONS.diagnosticRegistryVersion,
      reasonCodes: projection.value.reasonCodes,
    }),
  };
}

export const RC7_FROZEN_CONFIG = projection.value;
