import { createWorkerEngine } from "./engine";
import { runWorker, type WorkerPort } from "./runtime";

runWorker(globalThis as unknown as WorkerPort, createWorkerEngine());
