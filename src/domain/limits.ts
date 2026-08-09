export interface CoreInputLimits {
  readonly maxSourceMeasures: 160;
  readonly maxPerformanceMeasures: 160;
  readonly maxLeadAtoms: 600;
  readonly maxPhraseRegions: 80;
  readonly maxSectionOccurrences: 32;
  readonly maxResolvedChordSpans: 320;
  readonly maxGeneratedTrackPlans: 2;
  readonly maxLocks: 1_000;
}

export const CORE_INPUT_LIMITS: CoreInputLimits = Object.freeze({
  maxSourceMeasures: 160,
  maxPerformanceMeasures: 160,
  maxLeadAtoms: 600,
  maxPhraseRegions: 80,
  maxSectionOccurrences: 32,
  maxResolvedChordSpans: 320,
  maxGeneratedTrackPlans: 2,
  maxLocks: 1_000,
});

export type CoreInputCountKey = keyof CoreInputLimits;

export interface CoreInputLimitViolation {
  readonly limit: CoreInputCountKey;
  readonly actual: number;
  readonly maximum: number;
}

export function validateCoreInputLimits(
  counts: Readonly<Partial<Record<CoreInputCountKey, number>>>,
): readonly CoreInputLimitViolation[] {
  const violations: CoreInputLimitViolation[] = [];
  for (const limit of Object.keys(CORE_INPUT_LIMITS) as CoreInputCountKey[]) {
    const actual = counts[limit];
    if (actual === undefined) continue;
    if (!Number.isSafeInteger(actual) || actual < 0 || actual > CORE_INPUT_LIMITS[limit]) {
      violations.push({ limit, actual, maximum: CORE_INPUT_LIMITS[limit] });
    }
  }
  return violations;
}
