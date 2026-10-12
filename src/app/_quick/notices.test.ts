import { expect, it } from "vitest";
import { uniqueNotices, uniquePartReasons } from "./notices";

it("groups six repeated cards while retaining distinct actions, measures and original diagnostics", () => {
  const repeated = Array.from({ length: 6 }, (_, index) => ({ id: `note-${index}`, messageKo: "16번째 마디: 아직 읽을 수 없는 악보 기호가 있어요", actionKo: "원본 악보를 확인해 주세요." }));
  const otherAction = { ...repeated[0], id: "action", actionKo: "MuseScore에서 수정해 주세요." };
  const otherMeasure = { ...repeated[0], id: "measure", messageKo: "17번째 마디: 아직 읽을 수 없는 악보 기호가 있어요" };
  const input = Object.freeze([...repeated, otherAction, otherMeasure]);
  expect(uniqueNotices(input)).toEqual([repeated[0], otherAction, otherMeasure]);
  expect(input).toHaveLength(8);
});

it("merges equal blocked reasons across parts while retaining distinct reasons and source results", () => {
  const alto = { part: "alto", reasonKo: "악보 판정에서 생성이 중단됐어요." };
  const tenor = { part: "tenor", reasonKo: alto.reasonKo };
  const distinct = { part: "other", reasonKo: "다른 판정 사유" };
  const parts = Object.freeze([alto, tenor, distinct]);
  expect(uniquePartReasons(parts)).toEqual([alto, distinct]);
  expect(parts).toHaveLength(3);
  expect(uniquePartReasons([])).toEqual([]);
});
