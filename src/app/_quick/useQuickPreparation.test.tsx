// @vitest-environment happy-dom
import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HarmonyWorkerClient, PreparationHandle, PreparationView } from "../../product/harmony-worker/client";
import { ScreenWorkerSession } from "../_worker/session";
import { useQuickPreparation, type QuickPreparationController } from "./useQuickPreparation";
const handle = "prepare:fixture" as PreparationHandle;
const prep: PreparationView = { handle, status: "needs-input", questions: [{ id: "lead", messageKo: "멜로디 확인", actionKo: "선택", choices: [{ value: "P1", labelKo: "멜로디" }] }], notes: [], reasons: [] };
let ui: QuickPreparationController, root: Root, host: HTMLDivElement, session: ScreenWorkerSession;
const client = { prepare: vi.fn(), answer: vi.fn(), release: vi.fn(async () => null), cancel: vi.fn(() => "cancelled"), dispose: vi.fn(async () => {}) };
function Harness() { const value = useQuickPreparation(session); useEffect(() => { ui = value; }); return null; }
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
  await act(async () => ui.setLead("P1"));
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
  await act(async () => ui.setLead("P1")); expect(ui.answering).toBe(true);
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
