import { canonicalJson } from "../domain/digest/canonical";
import { validateHarmonyProject, type HarmonyProject } from "../domain/project";
import { isPlainRecord } from "../domain/validation";
import { loadProductExecutionRegistry } from "./registry";
import { exactJson } from "../import/workspace/encoding";

// One verified serialized value per module realm. This reuses content
// validation across file import -> saveNew -> load, never authorization or an
// external snapshot flag. No project graph is shared with a caller.
const MAX_VERIFIED_PROJECT_CHARS = 16_000_000;
let verifiedTransfer: { readonly encoded: string; readonly registryKey: string } | undefined;
function rememberTransfer(project: HarmonyProject, encoded: string, exact: string, registryKey: string): void {
  // Edited snapshots need graph-local attestations established by the normal
  // validator on every import. Serialized equality cannot supply that authority.
  if(Object.values(project.variants).some(variant=>variant.lifecycle==='generation-attempted'
    && (variant.editedSnapshots.length>0 || variant.outputEdits.length>0)))return;
  if(encoded.length>MAX_VERIFIED_PROJECT_CHARS){verifiedTransfer=undefined;return;}
  // Canonical NFC must not turn a different opaque proof/evidence string into
  // the previously verified bytes. Noncanonical originals use full validation.
  if(encoded===exact)verifiedTransfer={encoded,registryKey};
}
function captureProject(project: HarmonyProject) {
  try {
    const exact=exactJson(project),canonical=canonicalJson(project);
    return {exact,canonical};
  }catch{throw new RangeError("PROJECT_INTEGRITY_INVALID");}
}
function ensureUnchanged(project: HarmonyProject, captured: {exact:string;canonical:string}):void {
  try{if(exactJson(project)===captured.exact&&canonicalJson(project)===captured.canonical)return;}catch{}
  throw new RangeError("PROJECT_MUTATED_DURING_EXPORT");
}

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
  const captured=captureProject(project),registry=structuredClone(await loadProductExecutionRegistry()),registryKey=canonicalJson(registry);
  const hit=verifiedTransfer;
  if(hit?.encoded===captured.exact&&hit.registryKey===registryKey) {
    ensureUnchanged(project,captured);return hit.encoded;
  }
  ensureUnchanged(project,captured);
  const validation = await validateHarmonyProject(project, registry);
  if (validation.status !== "complete") throw new RangeError("PROJECT_INTEGRITY_INVALID");
  ensureUnchanged(project,captured);
  rememberTransfer(project,captured.canonical,captured.exact,registryKey);
  return captured.canonical;
}

export async function importHarmonyProject(encoded: string): Promise<HarmonyProject> {
  let value: unknown;
  try { value = JSON.parse(encoded); } catch { throw new RangeError("PROJECT_FILE_MALFORMED"); }
  const registry=structuredClone(await loadProductExecutionRegistry()),registryKey=canonicalJson(registry),hit=verifiedTransfer;
  if(hit?.encoded===encoded&&hit.registryKey===registryKey)return value as HarmonyProject;
  const validation = await validateHarmonyProject(migrateMissingCandidateHarmonyRoles(value), registry);
  if (validation.status !== "complete") throw new RangeError("PROJECT_INTEGRITY_INVALID");
  rememberTransfer(validation.value,canonicalJson(validation.value),exactJson(validation.value),registryKey);
  return validation.value;
}
