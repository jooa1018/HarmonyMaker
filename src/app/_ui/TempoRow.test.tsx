// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TempoRow } from "./TempoRow";
let root: Root, host: HTMLDivElement, now: number;
const changes = vi.fn();
function Harness({ score = false }: { score?: boolean }) {
  const [value, setValue] = useState<number>();
  return <TempoRow tempo={{ bpm: 80, beatUnit: 4, dotted: score, origin: score ? "score" : "auto" }} value={value} onChange={value => { changes(value); setValue(value); }} min={30} max={200} />;
}
const button = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
const tap = () => host.querySelector<HTMLButtonElement>(".hm-tap")!;
const bpm = () => Number(host.querySelector("output > span:nth-child(2)")?.textContent);
async function pointer(el: HTMLElement, type: string) { await act(async () => el.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, isPrimary: true, pointerId: 1 }))); }
async function tick(ms: number) { await act(async () => vi.advanceTimersByTime(ms)); }
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers(); now = 0; changes.mockClear();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("does not emit an override until edited, and clears it when restored", async () => {
  expect(changes).not.toHaveBeenCalled();
  await act(async () => button("1 빠르게").click()); expect(bpm()).toBe(81); expect(changes).toHaveBeenLastCalledWith(81);
  expect(host.querySelector<HTMLSpanElement>(".hm-tempo-badge")?.hidden).toBe(true);
  await act(async () => button("1 느리게").click()); expect(changes).toHaveBeenLastCalledWith(undefined);
  expect(host.querySelector<HTMLSpanElement>(".hm-tempo-badge")?.hidden).toBe(false);
});
it("steps once on pointer press, repeats after the hold delay, stops on release without a duplicate click", async () => {
  const plus = button("1 빠르게"); await pointer(plus, "pointerdown"); expect(bpm()).toBe(81);
  await tick(479); expect(bpm()).toBe(81); await tick(1); expect(bpm()).toBe(82); await tick(160); expect(bpm()).toBe(84);
  await pointer(plus, "pointerup"); await tick(1000); expect(bpm()).toBe(84);
  await act(async () => plus.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }))); expect(bpm()).toBe(84);
});
it.each(["pointerleave", "pointercancel", "blur"])("stops the hold on %s", async type => {
  const plus = button("1 빠르게"); await pointer(plus, "pointerdown");
  await act(async () => plus.dispatchEvent(type === "blur" ? new FocusEvent("focusout", { bubbles: true }) : new PointerEvent(type === "pointerleave" ? "pointerout" : type, { bubbles: true })));
  await tick(1000); expect(bpm()).toBe(81);
});
it("averages only the six newest tap intervals, rounds and resets after a two-second gap", async () => {
  await pointer(tap(), "pointerdown"); expect(changes).not.toHaveBeenCalled();
  for (const interval of [1000, 500, 500, 500, 500, 500, 500]) { now += interval; await pointer(tap(), "pointerdown"); }
  expect(bpm()).toBe(120); expect(tap().classList.contains("is-tapping")).toBe(true);
  await tick(2000); expect(tap().classList.contains("is-tapping")).toBe(false);
  now += 2001; changes.mockClear(); await pointer(tap(), "pointerdown"); expect(changes).not.toHaveBeenCalled();
  now += 700; await pointer(tap(), "pointerdown"); expect(bpm()).toBe(86);
});
it("clamps taps and held buttons to supplied limits, supports keyboard tapping, and clears timers on unmount", async () => {
  await pointer(tap(), "pointerdown"); now += 100; await pointer(tap(), "pointerdown");
  expect(bpm()).toBe(200); expect(button("1 빠르게").disabled).toBe(true);
  const minus = button("1 느리게"); await pointer(minus, "pointerdown"); await tick(20000); expect(bpm()).toBe(30); expect(minus.disabled).toBe(true);
  await pointer(minus, "pointerup"); now += 2001;
  for (const key of ["Enter", " "]) { await act(async () => tap().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))); now += 1000; }
  expect(bpm()).toBe(60);
  await pointer(button("1 빠르게"), "pointerdown"); await act(async () => root.render(null)); changes.mockClear(); await tick(1000); expect(changes).not.toHaveBeenCalled();
});
it("renders the score badge and dotted-quarter beat without claiming the tempo was invented", async () => {
  await act(async () => root.render(<Harness score />));
  expect(host.querySelector(".hm-tempo-badge.is-score")?.textContent).toBe("악보에 적힌 빠르기");
  expect(host.querySelector("output")?.textContent).toContain("♩. = 80"); expect(host.textContent).not.toContain("빠르기 표시가 없어");
});
