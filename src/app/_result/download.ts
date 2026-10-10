import { exportArrangementMusicXml } from "../../product/musicxml-export";
import { materializeActiveArrangement } from "../../product/render";
import type { HarmonyProject } from "../../domain/project";
export function projectMusicXml(project: HarmonyProject) {
  const materialized = materializeActiveArrangement(project, project.selectedPresetId ?? "standard");
  if (materialized.validity !== "valid") throw new Error("INVALID_ARRANGEMENT_EXPORT_BLOCKED");
  return exportArrangementMusicXml(materialized.document, materialized.trackRoles, {
    title: project.source.title, key: project.source.defaultKey, tempo: project.source.defaultTempo,
    ...(project.source.composer ? { composer: project.source.composer } : {}),
    ...(project.source.importInfo?.sourceKind === "score-workspace" ? { workspaceProjection: project.source.importInfo.workspaceMetadata } : {}),
  });
}
export function downloadMusicXml(project: HarmonyProject) {
  const url = URL.createObjectURL(new Blob([projectMusicXml(project)], { type: "application/vnd.recordare.musicxml+xml" }));
  const link = document.createElement("a");
  link.href = url; link.download = `${(project.source.title || "화음 악보").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")}.musicxml`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
