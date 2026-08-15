import { APPLICATION_ALGORITHM_VERSION_REGISTRY } from "../app/algorithm-version-registry";
import { createPresetProfileRegistry, type PresetProfileRegistry } from "../domain/config";
import {
  createDiagnosticRegistry,
  DIAGNOSTIC_CODES,
  type DiagnosticCode,
  type DiagnosticDefinition,
  type DiagnosticRegistry,
  type DiagnosticScope,
  type DiagnosticSeverity,
} from "../domain/diagnostics";
import { semanticDigest, type SemanticDigest } from "../domain/digest/canonical";
import type { AlgorithmConfigDigestRegistry, AlgorithmVersionRegistry } from "../domain/registries";
import baselinePayload from "./wag-v1-diagnostic-baseline.canonical.json";
import extensionPayload from "./wag-v1-diagnostic-extension.canonical.json";
import grammarPayload from "./worship-arrangement-grammar-v1.0.1.canonical.json";

export const FROZEN_WAG_AUTHORITY = Object.freeze({
  grammarConfigDigest: "5a71f18d5687c4884f8dad209c162f39b8152c1e3030fc4af4b429c7c41f4482" as SemanticDigest,
  presetProfileDigest: "ae0fce2af71b10e7f387521b22fe737cb840f02881b95121761b2953154cd681" as SemanticDigest,
  baselineDiagnosticDigest: "96e396a1fdb97a9cc9eba2b21a20c709cd5a96285126bfba1a406cba2f42ef70" as SemanticDigest,
  extensionDiagnosticDigest: "aee570a5fc6110107979c40708ebb0b48f645e23853a0e75084854c2cd6ce794" as SemanticDigest,
  diagnosticRegistryDigest: "0bdb9f5067cba55dad165d3679460a04f21e98b450a4624fa21eca1ffa3dcc77" as SemanticDigest,
  diagnosticDefinitionCount: 99,
  grammarVersion: "grammar-v1.0.1",
  presetProfileVersion: "preset-profile-v2-b15-v0",
  diagnosticRegistryVersion: "diagnostic-registry-v3-wag1-v0",
});

export const WAG_OWNED_CONFIG_DIGEST_BINDINGS: Readonly<Pick<
  AlgorithmConfigDigestRegistry,
  | "plannerConfigDigest"
  | "grammarConfigDigest"
  | "activityPlannerConfigDigest"
  | "anchorPlannerConfigDigest"
  | "solverConfigDigest"
  | "assemblerConfigDigest"
  | "validatorConfigDigest"
  | "metricConfigDigest"
>> = Object.freeze({
  plannerConfigDigest: FROZEN_WAG_AUTHORITY.grammarConfigDigest,
  grammarConfigDigest: FROZEN_WAG_AUTHORITY.grammarConfigDigest,
  activityPlannerConfigDigest: FROZEN_WAG_AUTHORITY.grammarConfigDigest,
  anchorPlannerConfigDigest: FROZEN_WAG_AUTHORITY.grammarConfigDigest,
  solverConfigDigest: FROZEN_WAG_AUTHORITY.grammarConfigDigest,
  assemblerConfigDigest: FROZEN_WAG_AUTHORITY.grammarConfigDigest,
  validatorConfigDigest: FROZEN_WAG_AUTHORITY.grammarConfigDigest,
  metricConfigDigest: FROZEN_WAG_AUTHORITY.grammarConfigDigest,
});

const WAG_VERSION_BINDINGS: Readonly<Partial<AlgorithmVersionRegistry>> = Object.freeze({
  grammarVersion: FROZEN_WAG_AUTHORITY.grammarVersion,
  presetProfileVersion: FROZEN_WAG_AUTHORITY.presetProfileVersion,
  plannerVersion: "planner-v2-wag1-v0-r1",
  activityPlannerVersion: "activity-planner-v2-lead-coupled-v0-r1",
  anchorPlannerVersion: "anchor-planner-v2-b15-local-v0-r1",
  solverVersion: "solver-v2-b15-local-v0-r1",
  assemblerVersion: "assembler-v2-lasc-v0-r1",
  validatorVersion: "validator-v2-lasi-v0-r1",
  metricsVersion: "metrics-v2-lasi-v0-r1",
  diagnosticRegistryVersion: FROZEN_WAG_AUTHORITY.diagnosticRegistryVersion,
});

interface FrozenDiagnosticDefinition {
  readonly code: string;
  readonly defaultSeverity: string;
  readonly blocksGeneration: boolean;
  readonly blocksComplete: boolean;
  readonly scope: string;
}

export interface LoadedFrozenWagAuthority {
  readonly grammarConfig: typeof grammarPayload;
  readonly grammarConfigDigest: SemanticDigest;
  readonly presetProfiles: PresetProfileRegistry;
  readonly diagnostics: DiagnosticRegistry;
  readonly wagOwnedConfigDigests: typeof WAG_OWNED_CONFIG_DIGEST_BINDINGS;
}

function fail(reason: string): never {
  throw new RangeError(`FROZEN_WAG_AUTHORITY_MISMATCH:${reason}`);
}

function assertVersionBindings(): void {
  for (const [key, expected] of Object.entries(WAG_VERSION_BINDINGS)) {
    if (APPLICATION_ALGORITHM_VERSION_REGISTRY[key as keyof AlgorithmVersionRegistry] !== expected) {
      fail(`version:${key}`);
    }
  }
}

function diagnosticDefinitions(): Readonly<Record<DiagnosticCode, DiagnosticDefinition>> {
  const entries = [
    ...(baselinePayload.definitions as readonly FrozenDiagnosticDefinition[]),
    ...(extensionPayload.definitions as readonly FrozenDiagnosticDefinition[]),
  ];
  if (entries.length !== FROZEN_WAG_AUTHORITY.diagnosticDefinitionCount) fail("diagnostic-count");
  if (new Set(entries.map(({ code }) => code)).size !== entries.length) fail("diagnostic-duplicate");
  const accepted = new Set<string>(DIAGNOSTIC_CODES);
  if (accepted.size !== entries.length || entries.some(({ code }) => !accepted.has(code))) {
    fail("diagnostic-code-set");
  }
  return Object.fromEntries(entries.map((definition) => [definition.code, {
    code: definition.code as DiagnosticCode,
    defaultSeverity: definition.defaultSeverity as DiagnosticSeverity,
    blocksGeneration: definition.blocksGeneration,
    blocksComplete: definition.blocksComplete,
    scope: definition.scope as DiagnosticScope,
  }])) as Readonly<Record<DiagnosticCode, DiagnosticDefinition>>;
}

export async function loadFrozenWagAuthority(): Promise<LoadedFrozenWagAuthority> {
  const [grammarConfigDigest, baselineDigest, extensionDigest, presetProfiles] = await Promise.all([
    semanticDigest(grammarPayload),
    semanticDigest(baselinePayload),
    semanticDigest(extensionPayload),
    createPresetProfileRegistry(FROZEN_WAG_AUTHORITY.presetProfileVersion),
  ]);
  if (grammarConfigDigest !== FROZEN_WAG_AUTHORITY.grammarConfigDigest) fail("grammar-config-digest");
  if (baselineDigest !== FROZEN_WAG_AUTHORITY.baselineDiagnosticDigest) fail("diagnostic-baseline-digest");
  if (extensionDigest !== FROZEN_WAG_AUTHORITY.extensionDiagnosticDigest) fail("diagnostic-extension-digest");
  if (presetProfiles.presetProfileDigest !== FROZEN_WAG_AUTHORITY.presetProfileDigest) fail("preset-profile-digest");
  assertVersionBindings();
  const diagnostics = await createDiagnosticRegistry(
    FROZEN_WAG_AUTHORITY.diagnosticRegistryVersion,
    diagnosticDefinitions(),
  );
  if (diagnostics.registryDigest !== FROZEN_WAG_AUTHORITY.diagnosticRegistryDigest) {
    fail("diagnostic-registry-digest");
  }
  return {
    grammarConfig: grammarPayload,
    grammarConfigDigest,
    presetProfiles,
    diagnostics,
    wagOwnedConfigDigests: WAG_OWNED_CONFIG_DIGEST_BINDINGS,
  };
}
