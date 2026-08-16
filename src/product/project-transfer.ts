import { canonicalJson } from "../domain/digest/canonical";
import { validateHarmonyProject, type HarmonyProject } from "../domain/project";
import { isPlainRecord } from "../domain/validation";
import { loadProductExecutionRegistry } from "./registry";

function nestedValue(value: unknown, ...keys: readonly string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isPlainRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function migrateMissingCandidateHarmonyRoles(value: unknown): unknown {
  if (!isPlainRecord(value) || value.schemaVersion !== 9 || !isPlainRecord(value.variants)) return value;
  let changed = false;
  const variants = Object.fromEntries(Object.entries(value.variants).map(([presetId, variant]) => {
    if (!isPlainRecord(variant) || variant.lifecycle !== "generation-attempted" || "candidateHarmonyRoles" in variant) {
      return [presetId, variant];
    }
    changed = true;
    const { activeArrangement, ...withoutActiveArrangement } = variant;
    void activeArrangement;
    const previousArtifactDigests = [
      nestedValue(variant, "intentPlan", "intentPlanDigest"),
      nestedValue(variant, "activityPlan", "activityPlanDigest"),
      nestedValue(variant, "anchorPlan", "anchorPlanDigest"),
      nestedValue(variant, "generationResult", "digests", "generationInputDigest"),
    ].filter((digest): digest is string => typeof digest === "string");
    return [presetId, {
      ...withoutActiveArrangement,
      candidateHarmonyRoles: [],
      staleness: variant.staleness ?? {
        staleFrom: "generation",
        staleDiagnosticIds: [],
        previousArtifactDigests,
      },
    }];
  }));
  return changed ? { ...value, variants } : value;
}

export async function exportHarmonyProject(project: HarmonyProject): Promise<string> {
  const validation = await validateHarmonyProject(project, await loadProductExecutionRegistry());
  if (validation.status !== "complete") throw new RangeError("PROJECT_INTEGRITY_INVALID");
  return canonicalJson(project);
}

export async function importHarmonyProject(encoded: string): Promise<HarmonyProject> {
  let value: unknown;
  try { value = JSON.parse(encoded); } catch { throw new RangeError("PROJECT_FILE_MALFORMED"); }
  const validation = await validateHarmonyProject(migrateMissingCandidateHarmonyRoles(value), await loadProductExecutionRegistry());
  if (validation.status !== "complete") throw new RangeError("PROJECT_INTEGRITY_INVALID");
  return validation.value;
}
