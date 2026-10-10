import { APPLICATION_ALGORITHM_VERSION_REGISTRY } from "../app/algorithm-version-registry";
import type { SongSourceDocument } from "../domain/source/model";
import { usesWag11, hasWag11Meter, quickHarmonyParts } from "../domain/quick-harmony-policy";

export const WAG_1_1_VERSIONS = Object.freeze({
  ...APPLICATION_ALGORITHM_VERSION_REGISTRY,
  grammarVersion: "grammar-v1.1",
  plannerVersion: "planner-v2-wag1.1",
  activityPlannerVersion: "activity-planner-v2-wag1.1",
  anchorPlannerVersion: "anchor-planner-v2-wag1.1",
  solverVersion: "solver-v2-wag1.1",
  assemblerVersion: "assembler-v2-wag1.1",
  validatorVersion: "validator-v2-wag1.1",
  metricsVersion: "metrics-v2-wag1.1",
});
export function algorithmVersionsForWag(grammarVersion: string) {
  if (grammarVersion === "grammar-v1.0.1") return APPLICATION_ALGORITHM_VERSION_REGISTRY;
  if (grammarVersion === "grammar-v1.1") return WAG_1_1_VERSIONS;
  throw new RangeError(`WAG_VERSION_UNSUPPORTED:${grammarVersion}`);
}
export function wagVersions(source?: SongSourceDocument, recordedVersion?: string) {
  return algorithmVersionsForWag(recordedVersion ?? (source && usesWag11(source) ? "grammar-v1.1" : "grammar-v1.0.1"));
}

/** Invocation-local policy snapshot; never cache mutable project/source objects. */
export function prepareWagPolicy(source: SongSourceDocument, recordedVersion?: string) {
  const parts = quickHarmonyParts(source);
  const versions = algorithmVersionsForWag(recordedVersion ?? (parts !== undefined || hasWag11Meter(source) ? "grammar-v1.1" : "grammar-v1.0.1"));
  return { parts, versions };
}
