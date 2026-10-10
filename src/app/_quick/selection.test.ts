import { describe, expect, it } from "vitest";
import type { QuickHarmonyPreparation } from "../../product/quick-harmony";
import { prepareQuickHarmony } from "../../product/quick-harmony";
import { confirmRights, emptySelection, harmonyChoice, preparedSelection, questionKind, unansweredQuestions } from "./selection";
const now = "2026-10-10T00:00:00.000Z";
const xml = `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>화면 시험</work-title></work><part-list><score-part id="P1"><part-name>멜로디</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><harmony><root><root-step>C</root-step></root><kind>major</kind></harmony><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`;
const load = () => prepareQuickHarmony({ bytes: new TextEncoder().encode(xml), fileName: "화면 시험.musicxml" });
describe("quick selection", () => {
  it("uses the engine recommendation without confirming rights", async () => {
    const preparation = await load();
    const selection = preparedSelection(preparation);
    expect(selection.part).toBe(preparation.summary?.recommendedPart);
    expect(harmonyChoice(preparation, selection)).toBeUndefined();
    const confirmed = confirmRights({ ...selection, part: "both" }, true, () => now);
    expect(harmonyChoice(preparation, confirmed)).toEqual({ parts: ["alto", "tenor"], rightsConfirmed: true, confirmedAt: now, answers: {} });
  });
  it("keeps the first confirmation time on retry and re-check; a new file resets it", async () => {
    let calls = 0;
    const clock = () => { calls++; return now; };
    const first = confirmRights(emptySelection(), true, clock);
    const retry = confirmRights(confirmRights(first, false, clock), true, clock);
    expect(retry.confirmedAt).toBe(now); expect(calls).toBe(1);
    expect(preparedSelection(await load()).confirmedAt).toBeUndefined();
  });
  it("accepts only an offered lead answer and keeps edit questions blocking", async () => {
    const preparation = await load();
    const lead = { id: "engine-question", messageKo: "엔진 문장을 그대로 표시", actionKo: "선택 안내", choices: [{ value: "P1:1:1", labelKo: "선율" }] };
    const edit = { ...lead, id: "edit", choices: [{ value: "edit-in-workspace", labelKo: "수정" }] };
    const prep: QuickHarmonyPreparation = { ...preparation, status: "needs-input", summary: undefined, questions: [lead] };
    expect(questionKind(lead)).toBe("lead"); expect(questionKind(edit)).toBe("edit");
    const selection = { ...confirmRights({ ...emptySelection(), part: "alto" }, true, () => now), answers: { lead: "other" } };
    expect(harmonyChoice(prep, selection)).toBeUndefined();
    const answered = { ...selection, answers: { lead: "P1:1:1" } };
    expect(unansweredQuestions(prep, answered)).toHaveLength(0);
    expect(harmonyChoice({ ...prep, questions: [lead, edit] }, answered)).toBeUndefined();
  });
  it("does not turn unsupported or unreadable input into a generation choice", async () => {
    const unsupported = await prepareQuickHarmony({ bytes: new Uint8Array(), fileName: "bad.xml" });
    expect(harmonyChoice(unsupported, { ...confirmRights(emptySelection(), true, () => now), part: "alto" })).toBeUndefined();
  });
});
