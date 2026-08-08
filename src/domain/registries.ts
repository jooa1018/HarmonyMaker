import type { SemanticDigest } from "./digest/canonical";

export interface AlgorithmVersionRegistry {
  readonly domainSchemaVersion: string;
  readonly digestCodecVersion: string;
  readonly chordParserVersion: string;
  readonly chordTimelineResolverVersion: string;
  readonly performanceExpanderVersion: string;
  readonly sourceLeadAtomizerVersion: string;
  readonly presetProfileVersion: string;
  readonly candidateProjectionVersion: string;
  readonly plannerVersion: string;
  readonly grammarVersion: string;
  readonly activityPlannerVersion: string;
  readonly anchorPlannerVersion: string;
  readonly solverVersion: string;
  readonly assemblerVersion: string;
  readonly validatorVersion: string;
  readonly metricsVersion: string;
  readonly diagnosticRegistryVersion: string;
  readonly accompanimentVersion: string;
  readonly editMaterializerVersion: string;
  readonly practiceShareCodecVersion: string;
  readonly omrNormalizerVersion: string;
  readonly evidenceMappingVersion: string;
}
export interface AlgorithmConfigDigestRegistry {
  readonly plannerConfigDigest: SemanticDigest;
  readonly grammarConfigDigest: SemanticDigest;
  readonly activityPlannerConfigDigest: SemanticDigest;
  readonly anchorPlannerConfigDigest: SemanticDigest;
  readonly solverConfigDigest: SemanticDigest;
  readonly assemblerConfigDigest: SemanticDigest;
  readonly validatorConfigDigest: SemanticDigest;
  readonly metricConfigDigest: SemanticDigest;
  readonly accompanimentConfigDigest: SemanticDigest;
  readonly diagnosticRegistryDigest: SemanticDigest;
}
export interface AlgorithmExecutionRegistry { readonly versions: AlgorithmVersionRegistry; readonly configDigests: AlgorithmConfigDigestRegistry }
export interface RegistryExpectation { readonly versions: Partial<AlgorithmVersionRegistry>; readonly configDigests: Partial<AlgorithmConfigDigestRegistry> }
export type RegistryValidationResult = { readonly status: "valid" } | { readonly status: "blocked"; readonly code: "ALGORITHM_CONFIG_MISMATCH"; readonly mismatches: readonly string[] };

export function validateExecutionRegistry(actual: AlgorithmExecutionRegistry, expected: RegistryExpectation): RegistryValidationResult {
  const mismatches: string[] = [];
  for (const key of Object.keys(expected.versions) as (keyof AlgorithmVersionRegistry)[]) {
    if (actual.versions[key] !== expected.versions[key]) mismatches.push(`version:${key}`);
  }
  for (const key of Object.keys(expected.configDigests) as (keyof AlgorithmConfigDigestRegistry)[]) {
    if (actual.configDigests[key] !== expected.configDigests[key]) mismatches.push(`config:${key}`);
  }
  return mismatches.length === 0 ? { status: "valid" } : { status: "blocked", code: "ALGORITHM_CONFIG_MISMATCH", mismatches };
}

