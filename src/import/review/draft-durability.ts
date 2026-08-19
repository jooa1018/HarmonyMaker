export const DIRECT_IMPORT_DRAFT_DURABILITY = "non-durable-until-project-created" as const;

export const DIRECT_IMPORT_DRAFT_RELOAD_NOTICE =
  "직접 MusicXML Quick Review 초안은 프로젝트 생성 전에는 이 탭에만 유지됩니다. 새로고침하면 초안이 사라지며, 프로젝트 생성 이후부터 IndexedDB에 저장됩니다.";

export function directImportDraftSurvivesReload(projectCreated: boolean): boolean {
  return projectCreated;
}
