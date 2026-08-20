import { describe, expect, it } from "vitest";
import {
  DIRECT_IMPORT_DRAFT_DURABILITY,
  DIRECT_IMPORT_DRAFT_RELOAD_NOTICE,
  directImportDraftSurvivesReload,
} from "./draft-durability";

describe("direct MusicXML Quick Review durability boundary", () => {
  it("is explicitly non-durable until project creation and durable afterwards", () => {
    expect(DIRECT_IMPORT_DRAFT_DURABILITY).toBe("non-durable-until-project-created");
    expect(directImportDraftSurvivesReload(false)).toBe(false);
    expect(directImportDraftSurvivesReload(true)).toBe(true);
    expect(DIRECT_IMPORT_DRAFT_RELOAD_NOTICE).toContain("새로고침하면 초안이 사라지며");
    expect(DIRECT_IMPORT_DRAFT_RELOAD_NOTICE).toContain("프로젝트 생성 이후부터 IndexedDB");
  });
});
