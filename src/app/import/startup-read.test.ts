import { describe, expect, it, vi } from "vitest";
import { readImportStartup } from "./startup-read";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

describe("import startup read versus later explicit input", () => {
  it(
    "does not clear the manually loaded draft when startup saved[0] arrives last",
    async () => {
      let sequence = 0;
      const captured = sequence, readingSaved = deferred<void>(), saved = deferred<readonly { id: string }[]>();
      let draft: { id: string } | undefined;
      const restore = vi.fn(() => { draft = undefined; });
      const startup = readImportStartup(() => sequence === captured, async () => undefined, () => {
        readingSaved.resolve(); return saved.promise;
      }).then((result) => {
        if (result.kind === "saved" && result.saved[0]) restore();
        return result;
      });
      await readingSaved.promise;
      sequence += 1;
      draft = { id: "explicit-new-input" };
      // The same new file can already be present in recovery storage. Restoring
      // even this matching saved[0] would clear its successfully parsed draft.
      saved.resolve([{ id: "explicit-new-input" }]);
      expect(await startup).toEqual({ kind: "stale" });
      expect(restore).not.toHaveBeenCalled();
      expect(draft).toEqual({ id: "explicit-new-input" });
    },
  );

  it("does not deliver a delayed startup handoff over a later file", async () => {
    let sequence = 0;
    const captured = sequence, handoff = deferred<{ id: string } | undefined>();
    const loadSaved = vi.fn(async () => []);
    const startup = readImportStartup(() => sequence === captured, () => handoff.promise, loadSaved);
    sequence += 1;
    handoff.resolve({ id: "older-handoff" });
    expect(await startup).toEqual({ kind: "stale" });
    expect(loadSaved).not.toHaveBeenCalled();
  });

  it("does not report a stale storage rejection as an error in the newer input", async () => {
    let current = true;
    const readingSaved = deferred<void>(), saved = deferred<readonly string[]>();
    const startup = readImportStartup(() => current, async () => undefined, () => {
      readingSaved.resolve(); return saved.promise;
    });
    await readingSaved.promise;
    current = false;
    saved.reject(new Error("older storage read failed"));
    expect(await startup).toEqual({ kind: "stale" });
  });

  it("still reports a current storage failure instead of hiding corruption", async () => {
    const error = new Error("current storage corrupt");
    await expect(readImportStartup(() => true, async () => undefined, async () => { throw error; })).rejects.toBe(error);
  });

  it("preserves ordinary startup saved recovery and its existing records", async () => {
    const saved = Object.freeze([Object.freeze({ id: "preserved", revision: 7 })]);
    const take = vi.fn(async () => undefined), loadSaved = vi.fn(async () => saved);
    const result = await readImportStartup(() => true, take, loadSaved);
    expect(result).toEqual({ kind: "saved", saved });
    if (result.kind !== "saved") throw new Error("saved startup expected");
    expect(result.saved).toBe(saved);
    expect(take).toHaveBeenCalledOnce(); expect(loadSaved).toHaveBeenCalledOnce();
  });

  it("retains current handoff precedence without reading unrelated recoveries", async () => {
    const handoff = Object.freeze({ id: "current-handoff" }), loadSaved = vi.fn(async () => ["old recovery"]);
    expect(await readImportStartup(() => true, async () => handoff, loadSaved)).toEqual({ kind: "handoff", handoff });
    expect(loadSaved).not.toHaveBeenCalled();
  });

  it("does not start storage work for an already superseded startup", async () => {
    const take = vi.fn(async () => undefined), loadSaved = vi.fn(async () => []);
    expect(await readImportStartup(() => false, take, loadSaved)).toEqual({ kind: "stale" });
    expect(take).not.toHaveBeenCalled(); expect(loadSaved).not.toHaveBeenCalled();
  });
});
