import { describe, expect, it } from "vitest";
import type { SemanticDigest } from "./digest/canonical";
import { validateExecutionRegistry, type AlgorithmExecutionRegistry, type AlgorithmVersionRegistry } from "./registries";

const d = "0".repeat(64) as SemanticDigest;
const versions: AlgorithmVersionRegistry = { domainSchemaVersion: "9", digestCodecVersion: "1", chordParserVersion: "1", chordTimelineResolverVersion: "1", performanceExpanderVersion: "1", sourceLeadAtomizerVersion: "1", presetProfileVersion: "1", candidateProjectionVersion: "1", plannerVersion: "1", grammarVersion: "1", activityPlannerVersion: "1", anchorPlannerVersion: "1", solverVersion: "1", assemblerVersion: "1", validatorVersion: "1", metricsVersion: "1", diagnosticRegistryVersion: "1", accompanimentVersion: "1", editMaterializerVersion: "1", practiceShareCodecVersion: "1", omrNormalizerVersion: "1", evidenceMappingVersion: "1" };
const registry: AlgorithmExecutionRegistry = { versions, configDigests: { plannerConfigDigest: d, grammarConfigDigest: d, activityPlannerConfigDigest: d, anchorPlannerConfigDigest: d, solverConfigDigest: d, assemblerConfigDigest: d, validatorConfigDigest: d, metricConfigDigest: d, accompanimentConfigDigest: d, diagnosticRegistryDigest: d } };

describe("algorithm execution registry", () => {
  it("accepts exact version/config equality", () => {
    expect(validateExecutionRegistry(registry, { versions: { solverVersion: "1" }, configDigests: { solverConfigDigest: d } })).toEqual({ status: "valid" });
  });

  it("blocks same version with different config and same config with different version", () => {
    expect(validateExecutionRegistry(registry, { versions: { solverVersion: "1" }, configDigests: { solverConfigDigest: "1".repeat(64) as SemanticDigest } })).toMatchObject({ status: "blocked", code: "ALGORITHM_CONFIG_MISMATCH", mismatches: ["config:solverConfigDigest"] });
    expect(validateExecutionRegistry(registry, { versions: { solverVersion: "2" }, configDigests: { solverConfigDigest: d } })).toMatchObject({ status: "blocked", mismatches: ["version:solverVersion"] });
  });
});
