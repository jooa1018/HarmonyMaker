import { canonicalJson } from "../domain/digest/canonical";
import { validateHarmonyProject, type HarmonyProject } from "../domain/project";
import { loadProductExecutionRegistry } from "./registry";

export async function exportHarmonyProject(project: HarmonyProject): Promise<string> {
  const validation = await validateHarmonyProject(project, await loadProductExecutionRegistry());
  if (validation.status !== "complete") throw new RangeError("PROJECT_INTEGRITY_INVALID");
  return canonicalJson(project);
}

export async function importHarmonyProject(encoded: string): Promise<HarmonyProject> {
  let value: unknown;
  try { value = JSON.parse(encoded); } catch { throw new RangeError("PROJECT_FILE_MALFORMED"); }
  const validation = await validateHarmonyProject(value, await loadProductExecutionRegistry());
  if (validation.status !== "complete") throw new RangeError("PROJECT_INTEGRITY_INVALID");
  return validation.value;
}
