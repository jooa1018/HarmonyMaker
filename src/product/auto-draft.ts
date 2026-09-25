import type { ArrangementPresetId } from "../domain/config";
import type { Diagnostic } from "../domain/diagnostics";
import type { HarmonyProject } from "../domain/project";
import { deriveQuickReview } from "../import/review/quick-review";
import { assessAutoDraft, autoDraftGeneratable, type AutoDraftAssessment, type AutoDraftOptions } from "../import/workspace/auto-draft";
import { projectAutoDraftWorkspace } from "../import/workspace/projection";
import type { ScoreWorkspace } from "../import/workspace/model";
import { createProjectFromQuickReview, generateProjectVariant, type ProductGenerationOutcome } from "./workspace";

/**
 * Minimal-input entry point: score workspace + optional harmony part → project.
 * The assessment is recomputed here from the exact workspace revision and
 * options; a verdict computed earlier by a UI is never trusted as input.
 */
export type AutoDraftGenerationResult =
  | { readonly status: "not-generated"; readonly assessment: AutoDraftAssessment }
  | { readonly status: "source-blocked"; readonly assessment: AutoDraftAssessment; readonly diagnostics: readonly Diagnostic[] }
  | { readonly status: "generated"; readonly assessment: AutoDraftAssessment; readonly project: HarmonyProject; readonly generation: ProductGenerationOutcome };

export async function generateAutoDraftProject(workspace: ScoreWorkspace, options: AutoDraftOptions = {}, presetId: ArrangementPresetId = "standard"): Promise<AutoDraftGenerationResult> {
  const assessment = await assessAutoDraft(workspace, options);
  if (!autoDraftGeneratable(assessment)) return { status: "not-generated", assessment };
  const draft = await projectAutoDraftWorkspace(workspace, options);
  const analysis = await deriveQuickReview(draft, workspace.algorithmVersions);
  // The assessment shares the structural gate with the Source validator. A
  // block here means the two disagree; surface it rather than retrying.
  if (!analysis.state.readyForPlanning) return { status: "source-blocked", assessment, diagnostics: analysis.diagnostics };
  const project = await createProjectFromQuickReview(draft, analysis, presetId);
  const generation = await generateProjectVariant(project, presetId);
  return { status: "generated", assessment, project: generation.project, generation };
}

/** Source status for display/export. Automatic drafts are never "reviewed". */
export function projectSourceStatus(project: HarmonyProject): "auto-draft" | "reviewed-workspace" | "other" {
  const info = project.source.importInfo;
  if (info?.sourceKind !== "score-workspace") return "other";
  return info.workspaceMetadata.version === "hm-workspace-auto-draft-v1" ? "auto-draft" : "reviewed-workspace";
}
