import { describe, expect, it, vi } from "vitest";

import type { HarmonyProject } from "../domain/project";
import type { LocalProjectRecord, LocalProjectStore } from "./local-project-store";
import {
  authoritativeWorkspaceProject,
  deleteWorkspaceProjectAndNavigate,
  WorkspaceRouteController,
} from "./workspace-route-state";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

const project = (title: string) => ({ source: { title } }) as HarmonyProject;
const record = (projectId: string, title = projectId, updatedAt = `2026-08-19T00:00:0${title.length % 10}.000Z`): LocalProjectRecord => ({
  projectId,
  updatedAt,
  project: project(title),
});

class ControllableProjectStore implements LocalProjectStore {
  readonly loads = new Map<string, Deferred<LocalProjectRecord | undefined>>();
  readonly saves: LocalProjectRecord[] = [];
  readonly deletes: string[] = [];
  readonly current = new Map<string, LocalProjectRecord>();
  saveBarrier?: Deferred<void>;
  deleteBarrier?: Deferred<void>;

  load(projectId: string): Promise<LocalProjectRecord | undefined> {
    const operation = deferred<LocalProjectRecord | undefined>();
    this.loads.set(projectId, operation);
    return operation.promise;
  }

  async save(value: LocalProjectRecord): Promise<void> {
    this.saves.push(value);
    await this.saveBarrier?.promise;
    this.current.set(value.projectId, value);
  }

  async saveIfCurrent(value: LocalProjectRecord, expectedUpdatedAt: string, isStillCurrent: () => boolean = () => true): Promise<boolean> {
    const current = this.current.get(value.projectId);
    if (!current || current.updatedAt !== expectedUpdatedAt || !isStillCurrent()) return false;
    this.saves.push(value);
    await this.saveBarrier?.promise;
    this.current.set(value.projectId, value);
    return true;
  }

  async list(): Promise<readonly Pick<LocalProjectRecord, "projectId" | "updatedAt">[]> { return []; }
  async delete(projectId: string): Promise<void> {
    this.deletes.push(projectId);
    await this.deleteBarrier?.promise;
    this.current.delete(projectId);
  }
  async deleteIfCurrent(projectId: string, expectedUpdatedAt: string, isStillCurrent: () => boolean = () => true): Promise<boolean> {
    const current = this.current.get(projectId);
    if (!current || current.updatedAt !== expectedUpdatedAt || !isStillCurrent()) return false;
    this.deletes.push(projectId);
    await this.deleteBarrier?.promise;
    this.current.delete(projectId);
    return true;
  }
}

async function load(controller: WorkspaceRouteController, store: ControllableProjectStore, projectId: string, value = record(projectId)) {
  const operation = controller.request(projectId);
  store.current.set(projectId, value);
  store.loads.get(projectId)!.resolve(value);
  await operation;
}

describe("executable workspace route operation controller", () => {
  it("executes A→B slow/missing/corrupt/back without displaying or mutating A under B", async () => {
    const store = new ControllableProjectStore();
    const controller = new WorkspaceRouteController(store);
    await load(controller, store, "A");
    expect(authoritativeWorkspaceProject(controller.state, "A")?.source.title).toBe("A");

    const slowB = controller.request("B");
    expect(controller.state).toEqual({ requestedId: "B", loadStatus: "loading" });
    expect(() => controller.beginMutation("B")).toThrow("WORKSPACE_PROJECT_AUTHORITY_UNAVAILABLE");
    store.loads.get("B")!.resolve(undefined);
    await slowB;
    expect(controller.state).toEqual({ requestedId: "B", loadStatus: "missing" });

    const corruptB = controller.request("B");
    store.loads.get("B")!.reject(new Error("corrupt IndexedDB value"));
    await corruptB;
    expect(controller.state).toEqual({ requestedId: "B", loadStatus: "corrupt" });

    await load(controller, store, "A", record("A", "A-back"));
    expect(authoritativeWorkspaceProject(controller.state, "A")?.source.title).toBe("A-back");
  });

  it("ignores an old A completion after B and a slow B completion after B→A back", async () => {
    const store = new ControllableProjectStore();
    const controller = new WorkspaceRouteController(store);
    const pendingA = controller.request("A");
    const oldA = store.loads.get("A")!;
    const pendingB = controller.request("B");
    const slowB = store.loads.get("B")!;
    const backA = controller.request("A");
    const newA = store.loads.get("A")!;

    oldA.resolve(record("A", "old-A"));
    await pendingA;
    expect(controller.state).toEqual({ requestedId: "A", loadStatus: "loading" });
    slowB.resolve(record("B", "late-B"));
    await pendingB;
    expect(controller.state).toEqual({ requestedId: "A", loadStatus: "loading" });
    const currentA = record("A", "new-A");
    store.current.set("A", currentA);
    newA.resolve(currentA);
    await backA;
    expect(authoritativeWorkspaceProject(controller.state, "A")?.source.title).toBe("new-A");
  });

  it.each(["save", "generation", "edit", "share", "select"])(
    "rejects %s mutation while B is loading",
    async () => {
      const store = new ControllableProjectStore();
      const controller = new WorkspaceRouteController(store);
      await load(controller, store, "A");
      void controller.request("B");
      expect(() => controller.beginMutation("B")).toThrow("WORKSPACE_PROJECT_AUTHORITY_UNAVAILABLE");
    },
  );

  it("writes an in-flight save to the exact loaded A key/value and never applies it to B", async () => {
    const store = new ControllableProjectStore();
    const controller = new WorkspaceRouteController(store);
    await load(controller, store, "A");
    store.saveBarrier = deferred<void>();
    const savedA = project("A-saved");
    const save = controller.saveProject("A", savedA, "2026-08-19T01:00:00.000Z", "A");
    await Promise.resolve();
    expect(store.saves).toEqual([{ projectId: "A", updatedAt: "2026-08-19T01:00:00.000Z", project: savedA }]);

    const pendingB = controller.request("B");
    const currentB = record("B");
    store.current.set("B", currentB);
    store.loads.get("B")!.resolve(currentB);
    await pendingB;
    store.saveBarrier.resolve();
    expect(await save).toEqual({ applied: false, record: store.saves[0] });
    expect(authoritativeWorkspaceProject(controller.state, "B")?.source.title).toBe("B");
  });

  it.each(["generation", "edit", "share"])(
    "fences a deferred %s result after A→B without an IndexedDB write",
    async () => {
      const store = new ControllableProjectStore();
      const controller = new WorkspaceRouteController(store);
      await load(controller, store, "A");
      const completion = deferred<HarmonyProject>();
      const mutation = controller.runMutation("A", async () => completion.promise, "2026-08-19T02:00:00.000Z");
      const pendingB = controller.request("B");
      const currentB = record("B");
      store.current.set("B", currentB);
      store.loads.get("B")!.resolve(currentB);
      await pendingB;
      completion.resolve(project("forged-B-retarget"));
      expect(await mutation).toEqual({ applied: false, superseded: true });
      expect(store.saves).toEqual([]);
      expect(authoritativeWorkspaceProject(controller.state, "B")?.source.title).toBe("B");
    },
  );

  it("fences a deferred same-ID result after a newer A revision loads", async () => {
    const store = new ControllableProjectStore();
    const controller = new WorkspaceRouteController(store);
    await load(controller, store, "A", record("A", "A-v0", "2026-08-19T00:00:00.000Z"));
    const completion = deferred<HarmonyProject>();
    const mutation = controller.runMutation("A", async () => completion.promise, "2026-08-19T02:00:00.000Z");

    const reload = controller.request("A");
    const newer = record("A", "A-v1", "2026-08-19T01:00:00.000Z");
    store.current.set("A", newer);
    store.loads.get("A")!.resolve(newer);
    await reload;
    completion.resolve(project("A-v0-late"));

    expect(await mutation).toEqual({ applied: false, superseded: true });
    expect(store.saves).toEqual([]);
    expect(authoritativeWorkspaceProject(controller.state, "A")?.source.title).toBe("A-v1");
  });

  it("fences a deferred first-A result after an A→B→A ABA route sequence", async () => {
    const store = new ControllableProjectStore();
    const controller = new WorkspaceRouteController(store);
    await load(controller, store, "A", record("A", "A-first", "2026-08-19T00:00:00.000Z"));
    const completion = deferred<HarmonyProject>();
    const mutation = controller.runMutation("A", async () => completion.promise, "2026-08-19T03:00:00.000Z");

    await load(controller, store, "B", record("B", "B", "2026-08-19T01:00:00.000Z"));
    await load(controller, store, "A", record("A", "A-second", "2026-08-19T02:00:00.000Z"));
    completion.resolve(project("A-first-late"));

    expect(await mutation).toEqual({ applied: false, superseded: true });
    expect(store.saves).toEqual([]);
    expect(authoritativeWorkspaceProject(controller.state, "A")?.source.title).toBe("A-second");
  });

  it("lets exactly one same-revision compare-and-set save win", async () => {
    const store = new ControllableProjectStore();
    const controller = new WorkspaceRouteController(store);
    await load(controller, store, "A", record("A", "A-v0", "2026-08-19T00:00:00.000Z"));
    const authority = controller.beginMutation("A").projectId;

    const first = await controller.saveProject("A", project("A-v1"), "2026-08-19T01:00:00.000Z", authority);
    const second = await controller.saveProject("A", project("A-v2"), "2026-08-19T01:00:00.000Z", authority);

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(store.current.get("A")?.project.source.title).toBe("A-v1");
  });

  it("classifies a mismatched IndexedDB record key as corrupt", async () => {
    const store = new ControllableProjectStore();
    const controller = new WorkspaceRouteController(store);
    const operation = controller.request("B");
    store.loads.get("B")!.resolve(record("A"));
    expect(await operation).toMatchObject({ status: "corrupt", requestedId: "B", applied: true });
    expect(controller.state).toEqual({ requestedId: "B", loadStatus: "corrupt" });
  });

  it("deletes exact A but ignores its delayed navigation completion after B loads", async () => {
    const store = new ControllableProjectStore();
    const controller = new WorkspaceRouteController(store);
    const navigate = vi.fn();
    await load(controller, store, "A");
    store.deleteBarrier = deferred<void>();

    const deletion = deleteWorkspaceProjectAndNavigate(controller, "A", navigate);
    expect(store.deletes).toEqual(["A"]);
    const pendingB = controller.request("B");
    const currentB = record("B");
    store.current.set("B", currentB);
    store.loads.get("B")!.resolve(currentB);
    await pendingB;
    store.deleteBarrier.resolve();

    expect(await deletion).toEqual({ applied: false, deletedProjectId: "A" });
    expect(store.deletes).toEqual(["A"]);
    expect(navigate).not.toHaveBeenCalled();
    expect(authoritativeWorkspaceProject(controller.state, "B")?.source.title).toBe("B");
  });

  it("navigates exactly once after deleting the still-current A authority", async () => {
    const store = new ControllableProjectStore();
    const controller = new WorkspaceRouteController(store);
    const navigate = vi.fn();
    await load(controller, store, "A");

    await expect(deleteWorkspaceProjectAndNavigate(controller, "A", navigate))
      .resolves.toEqual({ applied: true, deletedProjectId: "A" });
    expect(store.deletes).toEqual(["A"]);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
