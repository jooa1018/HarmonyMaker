import { APPLICATION_ALGORITHM_VERSION_REGISTRY } from "../app/algorithm-version-registry";
import type { SongSourceDocument } from "../domain/source/model";
import { usesWag11, hasWag11Meter, quickHarmonyParts, hasSourceTuplets } from "../domain/quick-harmony-policy";

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
export const WAG_1_2_VERSIONS = Object.freeze({
  ...WAG_1_1_VERSIONS,
  grammarVersion:"grammar-v1.2", plannerVersion:"planner-v2-wag1.2", activityPlannerVersion:"activity-planner-v2-wag1.2",
  anchorPlannerVersion:"anchor-planner-v2-wag1.2", solverVersion:"solver-v2-wag1.2", assemblerVersion:"assembler-v2-wag1.2",
  validatorVersion:"validator-v2-wag1.2", metricsVersion:"metrics-v2-wag1.2",
});
export function algorithmVersionsForWag(grammarVersion: string) {
  if (grammarVersion === "grammar-v1.0.1") return APPLICATION_ALGORITHM_VERSION_REGISTRY;
  if (grammarVersion === "grammar-v1.1") return WAG_1_1_VERSIONS;
  if (grammarVersion === "grammar-v1.2") return WAG_1_2_VERSIONS;
  throw new RangeError(`WAG_VERSION_UNSUPPORTED:${grammarVersion}`);
}
export function wagVersions(source?: SongSourceDocument, recordedVersion?: string) {
  return algorithmVersionsForWag(recordedVersion ?? (source && hasSourceTuplets(source) ? "grammar-v1.2" : source && usesWag11(source) ? "grammar-v1.1" : "grammar-v1.0.1"));
}

/** Invocation-local policy snapshot; never cache mutable project/source objects. */
export function prepareWagPolicy(source: SongSourceDocument, recordedVersion?: string) {
  const parts = quickHarmonyParts(source);
  const versions = algorithmVersionsForWag(recordedVersion ?? (hasSourceTuplets(source) ? "grammar-v1.2" : parts !== undefined || hasWag11Meter(source) ? "grammar-v1.1" : "grammar-v1.0.1"));
  return { parts, versions };
}
