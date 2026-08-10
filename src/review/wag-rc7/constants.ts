import type { ArrangementPresetId } from "../../domain/config";
import type { TexturePatternId } from "../../domain/plans";

export const RC7_GRAMMAR_ID = "worship-arrangement-grammar-v1" as const;
export const RC7_GRAMMAR_VERSION = "1.0.0-rc.7" as const;
export const RC7_GRAMMAR_CONFIG_DIGEST =
  "a84e33b33785c4d2cd58ef7fcc8374f25f8e933806e0efaa95d350015c36a21a" as const;
export const RC7_REVIEW_PACKAGE_SHA256 =
  "98a218bbc35866eb3cd71428698f52f2a4012170b8404b7b85b576d0679aa999" as const;

export const RC7_TEXTURE_ORDER: readonly TexturePatternId[] = [
  "UNISON",
  "UNISON_TO_SPLIT",
  "TWO_PART_PARALLEL",
  "ACCENT_BLOCK",
  "SUSTAINED_PAD",
  "SUSPENSION_RELEASE",
];

export const RC7_PRESET_ORDER: readonly ArrangementPresetId[] = [
  "simple",
  "standard",
  "full",
];

export const RC7_REVIEW_VERSIONS = Object.freeze({
  plannerVersion: "wag-rc7-review-intent-v1",
  activityPlannerVersion: "wag-rc7-review-activity-v1",
  anchorPlannerVersion: "wag-rc7-review-anchor-v1",
  solverVersion: "wag-rc7-review-solver-v1",
  assemblerVersion: "wag-rc7-review-assembler-v1",
  validatorVersion: "wag-rc7-review-validator-v1",
  metricsVersion: "wag-rc7-review-metrics-v1",
  candidateProjectionVersion: "candidate-projection-v1",
  diagnosticRegistryVersion: "wag-rc7-review-diagnostics-v1",
  responseSelectorVersion: "select-texture-activity-opportunity-v5",
});

export const RC7_REVIEW_BOUNDARY = Object.freeze({
  production: false,
  isolated: true,
  persistsHarmonyProject: false,
  mutatesHarmonyProject: false,
  reviewOnly: true,
});

export const RC7_LISTENING_AXES = [
  "Lead clarity",
  "harmony naturalness",
  "density appropriateness",
  "section lift",
  "entry timing",
  "release timing",
  "voice-leading smoothness",
  "range comfort",
  "lyric interference",
  "mud / clutter",
  "third-voice usefulness",
  "overall worship-pop plausibility",
] as const;
