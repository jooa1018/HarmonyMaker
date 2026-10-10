// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AudioSheet } from "./AudioSheet";
import { silentAudio, type AudioPlayer, type AudioRenderer, type AudioResult } from "./audio-export";
const player: AudioPlayer = { tracks: [{ id: "lead", label: "멜로디", role: "lead" }, { id: "alto", label: "알토", role: "lower" }], solo: "alto", speed: 75, bandEnabled: false, hasBand: true, totalSeconds: 96 };
let root: Root, container: HTMLDivElement;
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(el => el.textContent === name || el.getAttribute("aria-label") === name)!;
const close = vi.fn();
async function mount(renderAudio: AudioRenderer = async () => silentAudio(), source = player) { await act(async () => root.render(<AudioSheet title="시험 곡" player={source} onClose={close} renderAudio={renderAudio} />)); }
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("navigator", { canShare: vi.fn(() => false), share: vi.fn(async () => {}) }); container = document.createElement("div"); document.body.append(container); root = createRoot(container); close.mockClear(); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("starts from the current player and passes only the chosen snapshot to the renderer", async () => {
  const render = vi.fn<AudioRenderer>(async () => silentAudio()); await mount(render);
  const checked = [...document.querySelectorAll<HTMLInputElement>('input:checked')].map(el => el.closest("label")?.textContent);
  expect(checked.some(text => text?.includes("알토 강조"))).toBe(true); expect(checked).toContain("75%");
  expect(document.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
  await act(async () => button("음원 만들기").click());
  expect(render.mock.calls[0][0]).toMatchObject({ mix: { kind: "emphasize", trackId: "alto" }, speed: 75, bandEnabled: false });
  expect(document.querySelector(".hm-filecard b")?.textContent).toBe("시험 곡 - 알토 강조 - 75%.wav");
});
it("cancels with AbortController and ignores a late completion", async () => {
  let finish!: (result: AudioResult) => void;
  const render = vi.fn<AudioRenderer>(() => new Promise(resolve => { finish = resolve; })); await mount(render);
  await act(async () => button("음원 만들기").click()); expect(document.querySelector('[role="status"]')?.textContent).toContain("음원 만드는 중");
  await act(async () => button("취소").click()); expect(render.mock.calls[0][0].signal.aborted).toBe(true);
  await act(async () => finish(silentAudio())); expect(document.querySelector(".hm-filecard")).toBeNull(); expect(button("음원 만들기")).toBeDefined();
});
it("aborts pending rendering on unmount", async () => {
  const render = vi.fn<AudioRenderer>(() => new Promise(() => {})); await mount(render);
  await act(async () => button("음원 만들기").click()); await act(async () => root.render(null));
  expect(render.mock.calls[0][0].signal.aborted).toBe(true);
});
it.each([true, false])("shows file sharing only when canShare(files) is %s", async available => {
  vi.mocked(navigator.canShare).mockReturnValue(available); await mount(); await act(async () => button("음원 만들기").click());
  expect(!!button("카카오톡 등으로 보내기")).toBe(available);
  expect(navigator.canShare).toHaveBeenCalledWith({ files: [expect.any(File)] });
  if (available) { await act(async () => button("카카오톡 등으로 보내기").click()); expect(navigator.share).toHaveBeenCalledWith({ title: "시험 곡", files: [expect.any(File)] }); }
});
it("treats an unavailable or throwing canShare as file-save only", async () => {
  vi.mocked(navigator.canShare).mockImplementation(() => { throw new TypeError("unsupported"); }); await mount(); await act(async () => button("음원 만들기").click());
  expect(button("카카오톡 등으로 보내기")).toBeUndefined(); expect(button("파일로 저장")).toBeDefined();
});
it("downloads the named WAV using a Blob URL and releases it", async () => {
  const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test"), revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toBe("시험 곡 - 알토 강조 - 75%.wav"); expect(this.href).toBe("blob:test"); });
  await mount(); await act(async () => button("음원 만들기").click()); await act(async () => button("파일로 저장").click());
  expect(createUrl).toHaveBeenCalledWith(expect.any(File)); expect(click).toHaveBeenCalledOnce();
  await act(async () => root.render(null)); expect(revoke).toHaveBeenCalledWith("blob:test");
});
it("keeps raw rendering errors in collapsed details and permits retry", async () => {
  await mount(async () => { throw new Error("AUDIO_RENDER_FAILURE"); }); await act(async () => button("음원 만들기").click());
  expect(document.querySelector('[role="alert"] > p')?.textContent).toBe("예상하지 못한 문제가 생겼어요. 다시 시도해 주세요.");
  expect(document.querySelector("details")?.open).toBe(false); expect(button("음원 만들기")).toBeDefined();
});
