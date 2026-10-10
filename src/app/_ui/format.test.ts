import { describe, expect, it } from "vitest";
import { ctaLabel, formatClock, formatMeasureList, formatSavedDate, partialTitle, partsLabelKo, titleFromFileName } from "./format";
import { stripAbcTitle, voiceColorVars, voiceIdsInOrder } from "./score-colors";

describe("display formatting", () => {
  it.each([
    [[3], "3번째"], [[12, 13], "12·13번째"], [[20, 13, 12, 15, 14, 12], "12–15·20번째"], [[], ""],
  ] as const)("formats printed measure groups %j", (input, expected) => expect(formatMeasureList(input)).toBe(expected));
  it("handles a missing part without inventing measure numbers", () => {
    expect(partialTitle("테너", [])).toBe("테너를 만들지 못했어요");
    expect(partialTitle("테너", [3])).toBe("테너 3번째 마디는 만들지 못했어요");
  });
  it("normalizes selected part labels without changing input", () => {
    expect(partsLabelKo(["tenor", "alto"])).toBe("알토와 테너");
    expect(partsLabelKo(["alto"])).toBe("알토");
    expect(ctaLabel("both")).toBe("알토·테너 화음 만들기");
    expect(ctaLabel(undefined)).toBe("화음 파트를 골라 주세요");
  });
  it("formats time and filenames at display boundaries", () => {
    expect(formatClock(83.4)).toBe("1:23");
    expect(formatClock(-1)).toBe("0:00");
    expect(formatClock(NaN)).toBe("0:00");
    expect(titleFromFileName("주의 길을 걸어요.MUSICXML")).toBe("주의 길을 걸어요");
    expect(titleFromFileName("song.v2.mxl")).toBe("song.v2");
    expect(titleFromFileName("song.pdf")).toBe("song.pdf");
  });
  it("includes the year only for another calendar year", () => {
    const now = new Date(2026, 9, 10);
    expect(formatSavedDate(new Date(2026, 9, 10).toISOString(), now)).toBe("10월 10일");
    expect(formatSavedDate(new Date(2025, 11, 3).toISOString(), now)).toBe("2025년 12월 3일");
  });
});
describe("score voice colors", () => {
  it("uses score order, flattening groups and keeping rhythm tracks", () => {
    const abc = "%%score { (lead rhythm1) [upper lower] }\nV:lower\nV:upper\nV:lead";
    expect(voiceIdsInOrder(abc)).toEqual(["lead", "rhythm1", "upper", "lower"]);
    expect(voiceColorVars(abc)).toEqual({ "--hm-v0": "var(--hm-melody)", "--hm-v1": "var(--hm-muted)", "--hm-v2": "var(--hm-tenor)", "--hm-v3": "var(--hm-alto)" });
  });
  it("falls back to unique voice declarations with a safe unknown color", () => {
    expect(voiceIdsInOrder("V:lead\nV:old\nV:lead")).toEqual(["lead", "old"]);
    expect(voiceColorVars("V:old")).toEqual({ "--hm-v0": "currentColor" });
    expect(voiceIdsInOrder("")).toEqual([]);
  });
  it("strips title fields while preserving music and lyrics", () => {
    expect(stripAbcTitle("X:1\r\nT:Song\r\nK:G\r\nw: 가 사\r\nT:subtitle")).toBe("X:1\r\nK:G\r\nw: 가 사\r\n");
  });
});
