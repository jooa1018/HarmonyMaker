import { afterEach, expect, it, vi } from "vitest";
import { createWorkerTransport, type WorkerLike } from "./transport";
import type { ClientMessage, Request } from "./protocol";

class FakeWorker implements WorkerLike {
  onmessage: WorkerLike["onmessage"] = null;
  onerror: WorkerLike["onerror"] = null;
  onmessageerror: WorkerLike["onmessageerror"] = null;
  sent: ClientMessage[] = [];
  terminated = false;
  postMessage(message: ClientMessage) { this.sent.push(structuredClone(message)); }
  terminate() { this.terminated = true; }
  emit(data: unknown) { this.onmessage?.({ data }); }
  ready() { this.emit({ kind: "ready", protocol: 1 }); }
  request() { return this.sent.filter((m): m is Request => m.kind === "request").at(-1)!; }
  result(value: unknown, request = this.request()) { this.emit({ kind: "result", generation: request.generation, id: request.id, value }); }
  commit() { const r = this.request(); this.emit({ kind: "commit-ready", generation: r.generation, id: r.id }); }
}
function setup(timeout = 60_000) {
  const workers: FakeWorker[] = [];
  const client = createWorkerTransport(() => { const worker = new FakeWorker(); workers.push(worker); return worker; }, timeout);
  return { client, workers };
}
afterEach(() => vi.useRealTimers());

it("loads lazily, serializes jobs, snapshots inputs and ignores reordered old responses", async () => {
  const { client, workers } = setup();
  expect(workers).toHaveLength(0);
  const input = { projectId: "one" }, a = client.request("open", input), b = client.request("list", null);
  input.projectId = "changed";
  const w = workers[0]; expect(w.sent).toEqual([]);
  w.ready(); const first = w.request(); expect(first.input).toEqual({ projectId: "one" });
  expect(w.sent).toHaveLength(1);
  w.result(null); await expect(a).resolves.toBeNull();
  expect(w.request().operation).toBe("list");
  w.result("stale", first); w.result([{ projectId: "one", updatedAt: "now" }]);
  await expect(b).resolves.toHaveLength(1); await client.dispose();
});

it("terminates cancelled work, rejects queued old handles, and ignores the old generation after restart", async () => {
  const { client, workers } = setup(), controller = new AbortController();
  const a = client.request("list", null, { signal: controller.signal }), b = client.request("open", { projectId: "id" });
  const rejected = Promise.all([expect(a).rejects.toMatchObject({ name: "AbortError" }), expect(b).rejects.toMatchObject({ name: "AbortError" })]);
  workers[0].ready(); const old = workers[0].request(); controller.abort(); await rejected;
  expect(workers[0].terminated).toBe(true);
  const fresh = client.request("list", null); workers[1].ready();
  workers[0].result([], old); workers[1].emit({ kind: "result", generation: old.generation, id: old.id, value: [] });
  workers[1].result([]); await expect(fresh).resolves.toEqual([]); await client.dispose();
});

it("does not cancel or terminate after commit grant; dispose waits for the actual result", async () => {
  const { client, workers } = setup(), controller = new AbortController(), stages: string[] = [];
  const result = client.request("delete", { projectId: "id" }, { signal: controller.signal, onStage: s => stages.push(s) });
  workers[0].ready(); workers[0].commit();
  expect(workers[0].sent.at(-1)?.kind).toBe("commit");
  expect(client.cancel()).toBe("committing"); controller.abort();
  let disposed = false; const disposing = client.dispose().then(() => { disposed = true; });
  await Promise.resolve(); expect(disposed).toBe(false); expect(workers[0].terminated).toBe(false);
  workers[0].result(null); await expect(result).resolves.toBeNull(); await disposing;
  expect(stages.at(-1)).toBe("committing"); expect(workers[0].terminated).toBe(true);
});

it("cancels queued requests without affecting the active commit", async () => {
  const { client, workers } = setup(), controller = new AbortController();
  const writing = client.request("delete", { projectId: "id" });
  workers[0].ready(); workers[0].commit();
  const queued = client.request("list", null, { signal: controller.signal }), rejected = expect(queued).rejects.toMatchObject({ name: "AbortError" });
  controller.abort(); await rejected; expect(workers[0].terminated).toBe(false);
  workers[0].result(null); await writing; expect(workers[0].sent.filter(m => m.kind === "request")).toHaveLength(1);
  await client.dispose();
});

it.each(["error", "messageerror"] as const)("reports an uncertain commit on %s rather than success or cancellation", async kind => {
  const { client, workers } = setup(), result = client.request("delete", { projectId: "id" });
  workers[0].ready(); workers[0].commit();
  if (kind === "error") workers[0].onerror?.({ preventDefault() {} }); else workers[0].onmessageerror?.();
  await expect(result).rejects.toMatchObject({ code: "WORKER_COMMIT_OUTCOME_UNKNOWN" });
});

it("reports a write failure after commit and remains usable", async () => {
  const { client, workers } = setup(), result = client.request("delete", { projectId: "id" });
  workers[0].ready(); workers[0].commit(); const r = workers[0].request();
  workers[0].emit({ kind: "error", generation: r.generation, id: r.id, code: "INDEXEDDB_FAILED", messageKo: "저장 실패" });
  await expect(result).rejects.toMatchObject({ code: "INDEXEDDB_FAILED" });
  const next = client.request("list", null); workers[0].result([]); await expect(next).resolves.toEqual([]); await client.dispose();
});

it.each([null, {}, { kind: "ready", protocol: 2 }])("rejects malformed startup replies %j", async data => {
  const { client, workers } = setup(), result = client.start();
  workers[0].emit(data); await expect(result).rejects.toMatchObject({ code: "WORKER_RESPONSE_INVALID" });
});
it("rejects malformed operation results", async () => {
  const { client, workers } = setup(), result = client.request("list", null);
  workers[0].ready(); workers[0].result({ project: {} });
  await expect(result).rejects.toMatchObject({ code: "WORKER_RESPONSE_INVALID" });
});
it("times out startup without a main-thread fallback", async () => {
  vi.useFakeTimers(); const { client, workers } = setup(3000), result = client.start();
  const rejected = expect(result).rejects.toMatchObject({ code: "WORKER_LOAD_TIMEOUT" });
  await vi.advanceTimersByTimeAsync(3000); await rejected; expect(workers[0].terminated).toBe(true);
});
it("handles a synchronous cancel from the loading callback without starting a worker", async () => {
  const { client, workers } = setup();
  await expect(client.request("list", null, { onStage: () => { client.cancel(); } })).rejects.toMatchObject({ name: "AbortError" });
  expect(workers).toHaveLength(0);
});
it("keeps commit safe if an onStage callback throws or aborts", async () => {
  const { client, workers } = setup(), controller = new AbortController();
  const result = client.request("delete", { projectId: "id" }, { signal: controller.signal, onStage: stage => { if (stage === "committing") { controller.abort(); throw Error("UI"); } } });
  workers[0].ready(); workers[0].commit(); workers[0].result(null);
  await expect(result).resolves.toBeNull(); await client.dispose();
});
