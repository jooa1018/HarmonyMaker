// @vitest-environment happy-dom
import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HarmonyWorkerClient, PreparationHandle, PreparationView } from "../../product/harmony-worker/client";
import { PreparationScreen } from "./PreparationScreen";
import { ScreenWorkerSession } from "../_worker/session";
import { useQuickPreparation, type QuickPreparationController } from "./useQuickPreparation";
const handle = "prepare:fixture" as PreparationHandle;
const prep: PreparationView = { handle, status: "needs-input", questions: [{ id: "lead", messageKo: "멜로디 확인", actionKo: "선택", choices: [{ value: "P1", labelKo: "멜로디" }] }], notes: [], reasons: [] };
let ui: QuickPreparationController, root: Root, host: HTMLDivElement, session: ScreenWorkerSession;
const generate = vi.fn();
const client = { prepare: vi.fn(), answer: vi.fn(), release: vi.fn(async () => null), cancel: vi.fn(() => "cancelled"), dispose: vi.fn(async () => {}) };
function Harness() { const value = useQuickPreparation(session); useEffect(() => { ui = value; }); return <PreparationScreen ui={value} onGenerate={generate} onEdit={() => {}} />; }
async function upload() { await act(async () => ui.chooseFile(new File(["xml"], "score.musicxml"))); }
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks();
  client.prepare.mockResolvedValue(prep); client.answer.mockResolvedValue({ ...prep, status: "ready", questions: [] });
  session = new ScreenWorkerSession(() => client as unknown as HarmonyWorkerClient);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<StrictMode><Harness /></StrictMode>));
});
afterEach(async () => { await act(async () => root.unmount()); session.close(); host.remove(); vi.unstubAllGlobals(); });
it("answers through the worker with all selected answers, while retaining the explicit tempo and rights for generation", async () => {
  await upload();
  await act(async () => { ui.setTempo(72); ui.setRights(true); });
  await act(async () => ui.answerQuestion(prep.questions[0], "P1"));
  expect(client.answer).toHaveBeenCalledWith(handle, expect.objectContaining({ answers: { lead: "P1" } }), expect.anything());
  expect(client.answer.mock.calls[0][1]).not.toHaveProperty("tempo");
  expect(ui.selection).toMatchObject({ rights: true, tempoOverride: 72, answers: { lead: "P1" } });
  expect(ui.preparation?.status).toBe("ready");
  expect(client.release).not.toHaveBeenCalled();
  await act(async () => ui.reset()); await act(async () => {});
  expect(client.release).toHaveBeenCalledWith(handle);
});
it("does not restore a late answer after another file is chosen", async () => {
  await upload(); let resolve!: (value: PreparationView) => void;
  client.answer.mockImplementationOnce(() => new Promise<PreparationView>(done => { resolve = done; }));
  await act(async () => ui.answerQuestion(prep.questions[0], "P1")); expect(ui.answering).toBe(true);
  const next = { ...prep, handle: "new" as PreparationHandle, status: "ready" as const, questions: [] };
  client.prepare.mockResolvedValueOnce(next); await upload();
  await act(async () => resolve(prep));
  expect(ui.preparation).toEqual(next); expect(ui.answering).toBe(false); expect(ui.selection.answers).toEqual({});
});
it("cancels preparation and discards an old response instead of reviving its handle", async () => {
  let resolve!: (value: PreparationView) => void, pending!: Promise<void>;
  client.prepare.mockImplementationOnce(() => new Promise<PreparationView>(done => { resolve = done; }));
  await act(async () => { pending = ui.chooseFile(new File(["xml"], "score.musicxml")); });
  await act(async () => ui.cancel());
  await act(async () => { resolve(prep); await pending; });
  expect(ui.preparation).toBeUndefined(); expect(ui.error).toBeUndefined(); expect(ui.reading).toBe(false);
  expect(client.dispose).toHaveBeenCalled();
});

it("shows the engine pickup question, previews and generates its selected value, then clears it for another file", async () => {
  const question = { id: "pickup-chord", messageKo: "엔진의 못갖춘마디 질문", actionKo: "엔진의 코드 안내", choices: [{ value: "use-following-first-chord", labelKo: "C 코드 사용하기" }] };
  client.prepare.mockResolvedValueOnce({ ...prep, questions: [question] });
  await upload();
  expect(host.querySelector(".hm-notice.is-ask .hm-notice-title")?.textContent).toBe(question.messageKo);
  expect(host.querySelector(".hm-notice.is-ask .hm-notice-text")?.textContent).toBe(question.actionKo);
  expect(host.querySelectorAll(".hm-choices input")).toHaveLength(1);
  expect(host.querySelector(".hm-choice")?.textContent).toBe(question.choices[0].labelKo);
  expect(host.textContent).toContain("직접 고치려면 MuseScore에서 못갖춘마디에 코드를 넣어 다시 올려 주세요.");
  await act(async () => { ui.setPart("alto"); ui.setRights(true); });
  const button = () => host.querySelector<HTMLButtonElement>(".hm-cta button")!;
  expect(button().disabled).toBe(true);
  await act(async () => host.querySelector<HTMLInputElement>(".hm-choices input")!.click());
  expect(client.answer).toHaveBeenCalledWith(handle, expect.objectContaining({ answers: { pickupChord: question.choices[0].value } }), expect.anything());
  expect(button().disabled).toBe(false);
  await act(async () => button().click());
  expect(generate).toHaveBeenCalledWith(expect.objectContaining({ answers: { pickupChord: question.choices[0].value } }));
  client.prepare.mockResolvedValueOnce({ ...prep, questions: [question] });
  await upload();
  expect(ui.selection.answers).toEqual({});
  expect(host.querySelector<HTMLInputElement>(".hm-choices input")!.checked).toBe(false);
  await act(async () => { ui.setPart("alto"); ui.setRights(true); });
  expect(button().disabled).toBe(true);
});

it("shows a shared blocking message and action once instead of repeating part cards", async () => {
  const reason = { id: "common", messageKo: "공통 차단 사유", actionKo: "엔진이 제공한 고치는 방법", choices: [] };
  client.prepare.mockResolvedValueOnce({ ...prep, status: "unsupported", reasons: [reason, { ...reason, id: "duplicate" }], questions: [] });
  await upload();
  await act(async () => root.render(<PreparationScreen ui={{ ...ui, preparation: { ...ui.preparation!, status: "needs-input" } }} blocked={[
    { part: "alto", status: "missing", missingMeasures: [], reasonKo: reason.messageKo },
    { part: "tenor", status: "missing", missingMeasures: [], reasonKo: reason.messageKo },
  ]} onGenerate={generate} onEdit={() => {}} />));
  expect(host.querySelectorAll(".hm-notice.is-stop")).toHaveLength(1);
  expect(host.querySelector(".hm-notice-title")?.textContent).toBe(reason.messageKo);
  expect(host.querySelector(".hm-notice-text")?.textContent).toBe(reason.actionKo);
});
