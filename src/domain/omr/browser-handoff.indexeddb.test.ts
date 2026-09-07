import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { completeOmrImportHandoff, OMR_HANDOFF_TTL_MS, recordOmrImportHandoffFailure, storeOmrImportHandoff, takeOmrImportHandoff } from "./browser-handoff";

beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const bytes = new TextEncoder().encode("<score-partwise/>");
const store = () => storeOmrImportHandoff({ fileName: "omr-result.musicxml", mimeType: "application/vnd.recordare.musicxml+xml", bytes });

it("keeps exact failed bytes for bounded rereads, then removes them on the third failure", async () => {
  await store();
  const first = await takeOmrImportHandoff();
  expect(first).toBeDefined();
  if (!first) return;
  expect(new Uint8Array(await first.file.arrayBuffer())).toEqual(bytes);
  expect(await recordOmrImportHandoffFailure(first.handoffId)).toBe(true);
  const second = await takeOmrImportHandoff();
  expect(second?.handoffId).toBe(first.handoffId);
  expect(second?.expiresAt).toBe(first.expiresAt);
  expect(await recordOmrImportHandoffFailure(first.handoffId)).toBe(true);
  expect(await recordOmrImportHandoffFailure(first.handoffId)).toBe(false);
  expect(await takeOmrImportHandoff()).toBeUndefined();
});

it("does not extend the original expiry on reread", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const start = Date.now();
  await store();
  const first = await takeOmrImportHandoff();
  vi.setSystemTime(start + OMR_HANDOFF_TTL_MS);
  expect(await takeOmrImportHandoff()).toBeUndefined();
  expect(await recordOmrImportHandoffFailure(first!.handoffId)).toBe(false);
});

it("only completes the matching handoff", async () => {
  await store();
  const first = await takeOmrImportHandoff();
  await completeOmrImportHandoff("different-handoff");
  expect((await takeOmrImportHandoff())?.handoffId).toBe(first?.handoffId);
  await completeOmrImportHandoff(first!.handoffId);
  expect(await takeOmrImportHandoff()).toBeUndefined();
});
