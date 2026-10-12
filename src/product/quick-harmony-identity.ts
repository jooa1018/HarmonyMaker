import { semanticDigest } from "../domain/digest/canonical";
import type { QuickHarmonyChoice, QuickHarmonyPreparation } from "./quick-harmony";

/** Library identity only; never an input to music generation. */
export async function quickHarmonyProjectId(preparation: QuickHarmonyPreparation, choice: QuickHarmonyChoice): Promise<string> {
  if (!preparation.workspace) throw new Error("QUICK_HARMONY_WORKSPACE_REQUIRED");
  const parts = Array.isArray(choice.parts) ? [...new Set(choice.parts)].sort() : [preparation.summary?.recommendedPart ?? "alto"];
  return `quick-${await semanticDigest({ workspaceDigest: preparation.workspace.digest, parts, confirmedAt: choice.confirmedAt,
    answers: choice.answers ?? {}, ...(choice.tempo ? { tempo: choice.tempo } : {}) })}`;
}
