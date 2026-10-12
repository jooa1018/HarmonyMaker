import { createHarmonyWorkerClient, type HarmonyWorkerClient, type PreparationHandle, type ProjectHandle } from "../../product/harmony-worker/client";

type Handle = PreparationHandle | ProjectHandle;
/** A screen owns a realm. No opaque handle survives its cancellation or failure. */
export class ScreenWorkerSession {
  private client?: HarmonyWorkerClient;
  private generation = 0;
  private active = true;
  private handles = new Set<Handle>();
  constructor(private readonly factory = createHarmonyWorkerClient) {}
  activate() { this.active = true; }
  async run<T>(work: (client: HarmonyWorkerClient) => Promise<T>): Promise<T> {
    if (!this.active) throw new DOMException("작업을 취소했어요.", "AbortError");
    const client = this.client ??= this.factory(), generation = this.generation;
    try {
      const value = await work(client);
      if (generation !== this.generation) throw new DOMException("작업을 취소했어요.", "AbortError");
      this.remember(value);
      return value;
    } catch (error) {
      if (generation === this.generation) this.invalidate();
      throw error;
    }
  }
  private remember(value: unknown) {
    if (!value || typeof value !== "object") return;
    if ("handle" in value && typeof value.handle === "string") this.handles.add(value.handle as Handle);
    if ("project" in value) this.remember(value.project);
    if ("preparation" in value) this.remember(value.preparation);
  }
  release(handle: Handle) {
    if (!this.handles.delete(handle)) return;
    void this.client?.release(handle).catch(() => {});
  }
  cancel() {
    const result = this.client?.cancel() ?? "idle";
    if (result !== "committing") this.invalidate();
    return result;
  }
  private invalidate() {
    const client = this.client;
    this.client = undefined; this.generation++; this.handles.clear();
    void client?.dispose();
  }
  close() {
    this.active = false;
    const client = this.client;
    for (const handle of this.handles) void client?.release(handle).catch(() => {});
    this.invalidate();
  }
}
