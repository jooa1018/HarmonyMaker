import { expect, it, vi } from "vitest";
import type { HarmonyWorkerClient, PreparationHandle, ProjectHandle } from "../../product/harmony-worker/client";
import { HarmonyWorkerError } from "../../product/harmony-worker/client";
import { ScreenWorkerSession } from "./session";
import { stageLabel, workerFailure } from "./presentation";
const prep = "prep:one" as PreparationHandle, project = "project:one" as ProjectHandle;
function fixture() {
  const clients: ReturnType<typeof make>[] = [];
  function make() { return { cancel: vi.fn((): "cancelled" | "committing" | "idle" => "cancelled"), dispose: vi.fn(async () => {}), release: vi.fn(async () => null) }; }
  const session = new ScreenWorkerSession(() => { const client = make(); clients.push(client); return client as unknown as HarmonyWorkerClient; });
  return { session, clients };
}
it("releases unused handles once, and releases remaining handles on navigation", async () => {
  const { session, clients } = fixture();
  await session.run(async () => ({ preparation: { handle: prep } }));
  await session.run(async () => ({ project: { handle: project } }));
  session.release(prep); session.release(prep); session.close();
  expect(clients[0].release.mock.calls).toEqual([[prep], [project]]);
  expect(clients[0].dispose).toHaveBeenCalledTimes(1);
  await expect(session.run(async () => 1)).rejects.toMatchObject({ name: "AbortError" });
  expect(clients).toHaveLength(1);
});
it("discards all old handles and ignores late responses after cancellation", async () => {
  const { session, clients } = fixture(); let resolve!: (value: { handle: ProjectHandle }) => void;
  await session.run(async () => ({ handle: prep }));
  const pending = session.run(() => new Promise<{ handle: ProjectHandle }>(done => { resolve = done; }));
  expect(session.cancel()).toBe("cancelled"); resolve({ handle: project });
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  session.release(prep); session.release(project);
  expect(clients[0].release).not.toHaveBeenCalled();
  await session.run(async () => ({ handle: "new" as ProjectHandle }));
  expect(clients).toHaveLength(2);
});
it("keeps the realm and returned saved handle while commit rejects cancellation", async () => {
  const { session, clients } = fixture(); let resolve!: (value: { handle: ProjectHandle }) => void;
  const pending = session.run(() => new Promise<{ handle: ProjectHandle }>(done => { resolve = done; }));
  clients[0].cancel.mockReturnValue("committing");
  expect(session.cancel()).toBe("committing"); expect(clients[0].dispose).not.toHaveBeenCalled();
  resolve({ handle: project }); await pending; session.release(project);
  expect(clients[0].release).toHaveBeenCalledWith(project);
});
it.each([new DOMException("cancelled", "AbortError"), new HarmonyWorkerError("WORKER_HANDLE_EXPIRED", "오래된 참조"), new HarmonyWorkerError("WORKER_FAILED", "실패")])("starts a clean realm after %s", async error => {
  const { session, clients } = fixture(); await session.run(async () => ({ handle: prep }));
  await expect(session.run(async () => { throw error; })).rejects.toBe(error);
  session.release(prep); expect(clients[0].release).not.toHaveBeenCalled();
  await session.run(async () => null); expect(clients).toHaveLength(2);
});
it("can reactivate after Strict Mode cleanup without accepting the previous response", async () => {
  const { session, clients } = fixture(); let resolve!: () => void;
  const old = session.run(() => new Promise<void>(done => { resolve = done; }));
  session.close(); session.activate(); await session.run(async () => null); resolve();
  await expect(old).rejects.toMatchObject({ name: "AbortError" });
  expect(clients[1].dispose).not.toHaveBeenCalled();
});
it("preserves quota wording and distinguishes saved, unknown and delete commit states", () => {
  expect(workerFailure(new HarmonyWorkerError("STORAGE_QUOTA_EXCEEDED", "엔진이 제공한 문구")).message).toBe("엔진이 제공한 문구");
  expect(workerFailure(new HarmonyWorkerError("WORKER_SAVED_VIEW_FAILED", "detail")).message).toBe("저장은 됐어요. 내 악보에서 다시 열어 주세요.");
  expect(workerFailure(new HarmonyWorkerError("WORKER_COMMIT_OUTCOME_UNKNOWN", "detail")).message).toBe("저장됐는지 확인하지 못했어요. 내 악보에서 확인해 주세요.");
  expect(stageLabel("committing")).toBe("저장 마무리"); expect(stageLabel("committing", true)).toBe("지우는 중");
});
