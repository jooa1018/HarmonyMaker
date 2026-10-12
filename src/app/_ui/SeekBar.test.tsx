// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SeekBar, type SeekController } from "./SeekBar";
let root: Root, host: HTMLDivElement;
const seek = vi.fn();
const controller: SeekController = { seek, measureAt: value => value < 2 ? 0 : value < 8 ? 1 : 2, stepMeasure: (value, direction) => direction < 0 ? value < 8 ? 0 : 2 : value < 2 ? 2 : 8 };
const slider = () => host.querySelector<HTMLDivElement>('[role="slider"]')!;
async function pointer(type: string, x: number, id = 1) { await act(async () => slider().dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, pointerId: id, button: 0, isPrimary: true }))); }
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); seek.mockClear();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, width: 100 } as DOMRect);
  vi.spyOn(HTMLElement.prototype, "setPointerCapture").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "hasPointerCapture").mockReturnValue(false);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<SeekBar seconds={4} totalSeconds={10} controller={controller} />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("previews a drag without seeking and commits exactly once on release", async () => {
  await pointer("pointerdown", 20); await pointer("pointermove", 65); await pointer("pointermove", 85);
  expect(seek).not.toHaveBeenCalled(); expect(host.querySelector(".hm-seek-tip")?.textContent).toBe("2번째 마디 · 0:08");
  await pointer("pointerup", 85); expect(seek).toHaveBeenCalledExactlyOnceWith(8.5);
  await pointer("lostpointercapture", 85); await pointer("pointerup", 85); expect(seek).toHaveBeenCalledTimes(1);
});
it("clamps taps outside the bar and ignores a different pointer", async () => {
  await pointer("pointerdown", -10); await pointer("pointerup", 95, 2); expect(seek).not.toHaveBeenCalled();
  await pointer("pointerup", -10); expect(seek).toHaveBeenLastCalledWith(0);
  await pointer("pointerdown", 90); await pointer("pointerup", 130); expect(seek).toHaveBeenLastCalledWith(10);
});
it.each(["pointercancel", "lostpointercapture"])("discards an interrupted gesture (%s)", async event => {
  await pointer("pointerdown", 90); await pointer(event, 90); await pointer("pointerup", 90);
  expect(seek).not.toHaveBeenCalled(); expect(slider().getAttribute("aria-valuenow")).toBe("4");
  expect(host.querySelector<HTMLSpanElement>(".hm-seek-tip")?.hidden).toBe(true);
});
it("uses supplied measure boundaries for arrows, including pickup bars, and supports Home/End", async () => {
  for (const [key, expected] of [["ArrowLeft", 0], ["ArrowRight", 8], ["Home", 0], ["End", 10]] as const) {
    await act(async () => slider().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
    expect(seek).toHaveBeenLastCalledWith(expected);
  }
  expect(slider().getAttribute("aria-valuetext")).toBe("0:04, 1번째 마디");
});
