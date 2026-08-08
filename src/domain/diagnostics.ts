import { semanticDigest, type SemanticDigest } from "./digest/canonical";
import type { MusicalRange } from "./time";

export type DiagnosticSeverity = "info" | "warning" | "error" | "blocking";
export type DiagnosticScope =
  | "input" | "chord" | "performance" | "planner" | "activity" | "anchor"
  | "solver" | "validation" | "import" | "omr" | "share" | "evaluation" | "rights";

export const DIAGNOSTIC_CODES = [
  "INPUT_INVALID_FRACTION", "INPUT_FRACTION_LIMIT_EXCEEDED", "INPUT_EVENT_OVERLAP",
  "INPUT_INVALID_TIE", "INPUT_LIMIT_EXCEEDED", "INPUT_KEY_SIGNATURE_INCONSISTENT",
  "INPUT_BEAT_GROUPS_INVALID", "UNSUPPORTED_KEY_SIGNATURE", "UNSUPPORTED_BEAT_GROUPING",
  "UNSUPPORTED_METER", "UNSUPPORTED_MODULATION", "UNSUPPORTED_PERFORMANCE_FLOW",
  "PERFORMANCE_EXPANSION_FAILED", "PERFORMANCE_REPEAT_UNMATCHED", "PERFORMANCE_REPEAT_NESTED",
  "SECTION_COVERAGE_INVALID", "PHRASE_COVERAGE_INVALID", "SOURCE_CHORD_PARSE_FAILED",
  "SOURCE_CHORD_UNCONFIRMED", "SOURCE_CHORD_GAP", "SOURCE_CHORD_CARRY_WITHOUT_PREVIOUS",
  "EFFECTIVE_CHORD_TIMELINE_STALE", "CHORD_RESOLVER_VERSION_MISMATCH", "SOURCE_NO_CHORD_REGION",
  "SOURCE_LEAD_UNCLASSIFIED_NCT", "TRACK_PLAN_MISSING", "TRACK_ASSIGNMENT_INVALID",
  "TRACK_ROLE_CONFLICT", "TRACK_ORDINAL_INVALID", "PERFORMER_RANGE_INVALID",
  "PERFORMER_DOUBLE_BOOKED", "STALE_REFERENCE", "STAGE_LOCK_SCOPE_INVALID",
  "ANCHOR_LOCK_INVALID", "CANONICAL_DIGEST_CODEC_FAILED", "SECTION_UNCONFIRMED",
  "PHRASE_SPLIT_APPLIED", "NO_ELIGIBLE_TEXTURE", "SECTION_INTENSITY_INFEASIBLE",
  "GRAMMAR_NOT_ACCEPTED", "GRAMMAR_BLOCKED", "ACTIVITY_SPAN_INVALID",
  "HARMONY_ATTACK_RATIO_EXCEEDED", "LYRIC_POLICY_VIOLATION", "METRIC_NO_MELODY_DURATION",
  "GEN_ANCHOR_LIMIT_EXCEEDED", "GEN_NO_PITCH_CANDIDATE", "GEN_SEARCH_BUDGET_EXHAUSTED",
  "GEN_TIMEOUT", "GEN_CANCELLED", "GENERATED_OUT_OF_RANGE", "GENERATED_VOICE_CROSSING",
  "GENERATED_ILLEGAL_NCT", "GENERATED_UNRESOLVED_SUSPENSION", "GENERATED_CHORD_ROLE_CONFLICT",
  "GENERATED_NO_CHORD_POLICY_VIOLATION", "IMPORT_CORRUPT_XML", "IMPORT_UNSUPPORTED_ELEMENT",
  "IMPORT_ARCHIVE_UNSAFE", "OMR_INPUT_QUALITY_LOW", "OMR_PROVIDER_CAPABILITY_MISSING",
  "OMR_PROVIDER_FAILED", "OMR_PROVIDER_NEEDS_INPUT", "OMR_EVIDENCE_GRANULARITY_LOW",
  "OMR_MEASURE_DURATION_INVALID", "OMR_TIE_INVALID", "OMR_CHORD_UNPARSEABLE",
  "OMR_REVIEW_REQUIRED", "OMR_DELETE_FAILED", "OMR_QUOTA_EXCEEDED",
  "RIGHTS_GENERATION_NOT_CONFIRMED", "RIGHTS_PROVIDER_TRANSFER_NOT_CONFIRMED",
  "RIGHTS_SHARE_NOT_CONFIRMED", "RIGHTS_EVALUATION_NOT_CONFIRMED", "SHARE_PAYLOAD_TOO_LARGE",
  "SHARE_PAYLOAD_INVALID", "EDIT_BASE_CANDIDATE_STALE", "EDIT_SNAPSHOT_INVALID",
  "EDIT_MATERIALIZATION_BLOCKED", "GENERATION_RESULT_STATE_INVALID", "OMR_EVIDENCE_TRANSFORM_MISSING",
  "OMR_EVIDENCE_CODEC_FAILED", "OMR_REVIEW_RESOLUTION_INVALID", "OMR_EVIDENCE_TARGET_UNMAPPED",
  "SHARE_STORE_REQUIRED", "SOURCE_REVISION_INVALID", "SOURCE_REVISION_MISMATCH",
  "SOURCE_ID_REMAP_REQUIRED", "SOURCE_ID_REMAP_FAILED", "SOURCE_LEAD_ATOMIZATION_STALE",
  "SECTION_INTENSITY_AUTHORITY_INVALID", "PRESET_PROFILE_VERSION_MISMATCH",
  "ALGORITHM_CONFIG_MISMATCH", "CANDIDATE_PROJECTION_INVALID",
] as const;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

export interface DiagnosticDefinition {
  readonly code: DiagnosticCode;
  readonly defaultSeverity: DiagnosticSeverity;
  readonly blocksGeneration: boolean;
  readonly blocksComplete: boolean;
  readonly scope: DiagnosticScope;
}
export interface DiagnosticRegistry {
  readonly registryVersion: string;
  readonly definitions: Readonly<Record<DiagnosticCode, DiagnosticDefinition>>;
  readonly registryDigest: SemanticDigest;
}
export interface DiagnosticLocation {
  readonly range?: MusicalRange;
  readonly phraseId?: string;
  readonly sectionOccurrenceId?: string;
  readonly sourceEventIds?: readonly string[];
  readonly trackPlanIds?: readonly string[];
}
export interface Diagnostic {
  readonly id: string;
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly messageKo: string;
  readonly location?: DiagnosticLocation;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

export async function createDiagnosticRegistry(
  registryVersion: string,
  definitions: Readonly<Record<DiagnosticCode, DiagnosticDefinition>>,
): Promise<DiagnosticRegistry> {
  for (const code of DIAGNOSTIC_CODES) {
    if (definitions[code]?.code !== code) throw new RangeError(`diagnostic definition missing: ${code}`);
  }
  const entries = DIAGNOSTIC_CODES.slice().sort().map((code) => definitions[code]);
  return { registryVersion, definitions, registryDigest: await semanticDigest({ registryVersion, entries }) };
}

export function diagnosticProjection(
  diagnostic: Diagnostic,
  registry: DiagnosticRegistry,
): object {
  const definition = registry.definitions[diagnostic.code];
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    blocksGeneration: definition.blocksGeneration,
    blocksComplete: definition.blocksComplete,
    location: diagnostic.location ?? null,
    details: diagnostic.details ?? null,
  };
}

export async function createDiagnostics(
  inputs: readonly Omit<Diagnostic, "id">[],
  registry: DiagnosticRegistry,
): Promise<readonly Diagnostic[]> {
  const expanded = await Promise.all(inputs.map(async (input) => ({
    input,
    locationKey: await semanticDigest({ scope: registry.definitions[input.code].scope, location: input.location ?? null }),
    detailsKey: await semanticDigest(input.details ?? null),
  })));
  expanded.sort((a, b) => a.input.code.localeCompare(b.input.code) || a.locationKey.localeCompare(b.locationKey) || a.detailsKey.localeCompare(b.detailsKey));
  const counts = new Map<string, number>();
  return expanded.map(({ input, locationKey }) => {
    const key = `${input.code}:${locationKey}`;
    const ordinal = counts.get(key) ?? 0;
    counts.set(key, ordinal + 1);
    return { ...input, id: `dg:${input.code}:${locationKey}:${ordinal}` };
  });
}

export function blocksGeneration(diagnostic: Diagnostic, registry: DiagnosticRegistry): boolean {
  return registry.definitions[diagnostic.code].blocksGeneration;
}
