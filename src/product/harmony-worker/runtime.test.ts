import { expect, it } from "vitest";
import { runWorker, type WorkerPort } from "./runtime";
import type { ClientMessage, WorkerMessage } from "./protocol";

const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
it("executes serially and accepts only the active request's commit grant", async () => {
  const messages: WorkerMessage[] = [], ran: number[] = [];
  let receive!: (event: { data: ClientMessage }) => void;
  const port: WorkerPort = { postMessage: m => messages.push(m), addEventListener: (_, fn) => { receive = fn; } };
  runWorker(port, { async execute(request, execution) { ran.push(request.id); if (request.operation === "delete") await execution.beforeCommit(); return null; } });
  receive({ data: { kind: "request", generation: 1, id: 1, operation: "delete", input: { projectId: "one" } } });
  receive({ data: { kind: "request", generation: 1, id: 2, operation: "ping", input: null } });
  await flush(); expect(ran).toEqual([1]);
  receive({ data: { kind: "commit", generation: 0, id: 1 } });
  receive({ data: { kind: "commit", generation: 1, id: 2 } });
  await flush(); expect(ran).toEqual([1]);
  receive({ data: { kind: "commit", generation: 1, id: 1 } });
  await flush(); expect(ran).toEqual([1, 2]);
  expect(messages.filter(m => m.kind === "result").map(m => m.id)).toEqual([1, 2]);
});
it("returns a safe explicit error and processes the following command", async () => {
  const messages: WorkerMessage[] = [];
  let receive!: (event: { data: ClientMessage }) => void;
  runWorker({ postMessage: m => messages.push(m), addEventListener: (_, fn) => { receive = fn; } }, {
    async execute(request) { if (request.id === 1) throw Error("GRAMMAR_VERSION_UNSUPPORTED"); return null; },
  });
  for (const id of [1, 2]) receive({ data: { kind: "request", generation: 1, id, operation: "ping", input: null } });
  await flush();
  expect(messages).toContainEqual(expect.objectContaining({ kind: "error", id: 1, code: "GRAMMAR_VERSION_UNSUPPORTED" }));
  expect(messages).toContainEqual(expect.objectContaining({ kind: "result", id: 2 }));
});
