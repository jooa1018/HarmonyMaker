import type { HarmonyProject } from "../../domain/project";
import { parseScoreWorkspace } from "../../import/workspace/journal";
import { prepareQuickHarmonyWorkspace } from "../../product/quick-harmony";

export async function reprepareProject(project: HarmonyProject) {
  const info = project.source.importInfo;
  if (info?.sourceKind !== "score-workspace") return undefined;
  const workspace = await parseScoreWorkspace(info.workspaceMetadata.proof);
  return { preparation: await prepareQuickHarmonyWorkspace(workspace), fileName: info.originalFileName ?? project.source.title };
}
