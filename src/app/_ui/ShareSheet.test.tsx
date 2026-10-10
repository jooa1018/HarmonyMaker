// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ShareSheet } from "./ShareSheet";
import type { CreateLinkOutcome } from "../_result/create-share";

let root: Root, container: HTMLDivElement;
const unsupported = "이 악보는 아직 공유할 수 없어요. 곧 지원할 예정이에요.";
const retry = "공유 링크를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.";
const created = { status: "created", url: "https://example.test/share#p=fixture", stored: false } as const;
const createButton = () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => /^(새 )?공유 링크 만들기$/.test(button.textContent ?? ""))!;
const checkbox = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
async function mount(createLink: (fresh: boolean) => Promise<CreateLinkOutcome>) {
  await act(async () => root.render(<ShareSheet createLink={createLink} onClose={() => {}} />));
  expect(createButton().disabled).toBe(true);
  await act(async () => checkbox().click());
}
async function create() { await act(async () => createButton().click()); }
function expectFailure(message: string, code: string) {
  expect(container.querySelector('[role="alert"] > p')?.textContent).toBe(message);
  expect(container.querySelector("details")?.open).toBe(false);
  expect(container.querySelector("details pre")?.textContent).toBe(code);
  const visible = container.cloneNode(true) as HTMLElement;
  visible.querySelectorAll("details").forEach(element => element.remove());
  expect(visible.textContent).not.toContain(code);
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it.each(["SHARE_SOURCE_SLURS_UNSUPPORTED", "SHARE_SEPARATE_RHYTHM_VOICES_UNSUPPORTED", "SHARE_ARRANGEMENT_CHORD_POLICY_UNSUPPORTED"])("explains %s and keeps its code collapsed", async code => {
  await mount(async () => { throw new RangeError(code); });
  await create(); expectFailure(unsupported, code);
});
it.each(["NETWORK_UNCERTAIN", "SHARE_SESSION_UNAVAILABLE", "INTERNAL_SERVER_ERROR"])("explains server/transport outcome %s without exposing it", async code => {
  await mount(async () => ({ status: "retry", code }));
  await create(); expectFailure(retry, code);
});
it("handles thrown network errors and closes previously expanded details on another failure", async () => {
  const request = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
  await mount(request); await create(); expectFailure(retry, "Failed to fetch");
  container.querySelector("details")!.open = true;
  await create(); expectFailure(retry, "Failed to fetch");
  expect(request).toHaveBeenCalledTimes(2);
});
it.each(["thrown", "returned"])("asks for rights confirmation again after a %s rights failure", async mode => {
  const request = vi.fn<(fresh: boolean) => Promise<CreateLinkOutcome>>()
    .mockImplementationOnce(async () => { if (mode === "thrown") throw new RangeError("SHARE_RIGHTS_REQUIRED"); return { status: "retry", code: "SHARE_RIGHTS_REQUIRED" }; })
    .mockResolvedValueOnce(created);
  await mount(request); await create();
  expectFailure("공유 권리 확인에 다시 체크한 뒤 공유 링크를 만들어 주세요.", "SHARE_RIGHTS_REQUIRED");
  expect(checkbox().checked).toBe(false); expect(createButton().disabled).toBe(true);
  await act(async () => createButton().click()); expect(request).toHaveBeenCalledTimes(1);
  await act(async () => checkbox().click()); await create();
  expect(container.querySelector('[role="status"]')?.textContent).toContain("공유 링크를 만들었어요");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it("preserves explicit fresh intent while showing a network failure after a retired share", async () => {
  const request = vi.fn<(fresh: boolean) => Promise<CreateLinkOutcome>>()
    .mockResolvedValueOnce({ status: "fresh", code: "SHARE_CREATE_REPLAY_RETIRED" })
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce(created);
  await mount(request); await create();
  expectFailure("이전 공유가 끝났어요. 새 링크를 만들 수 있어요.", "SHARE_CREATE_REPLAY_RETIRED");
  await create(); expectFailure(retry, "Failed to fetch");
  await create(); expect(request.mock.calls).toEqual([[false], [true], [true]]);
});
it("keeps keyboard focus inside the sheet when inspecting collapsed or expanded details", async () => {
  await mount(async () => { throw new RangeError("SHARE_SOURCE_SLURS_UNSUPPORTED"); }); await create();
  const close = container.querySelector<HTMLButtonElement>('button[aria-label="닫기"]')!;
  const details = container.querySelector("details")!;
  const summary = details.querySelector("summary")!;
  summary.focus();
  await act(async () => summary.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(close);
  details.open = true;
  const pre = details.querySelector("pre")!; pre.focus();
  await act(async () => pre.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(close);
  await act(async () => close.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(pre);
});
