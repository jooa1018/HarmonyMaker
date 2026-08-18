import { describe, expect, it, vi } from "vitest";

import {
  OmrApiRequestError, acquireOmrJob, readOmrApiJson, type OmrBrowserStorage,
} from "./browser-recovery";

function memoryStorage(initial: Readonly<Record<string, string>> = {}): OmrBrowserStorage & { readonly values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

const createStorageKey = "create:input";
const recoveryStorageKey = `${createStorageKey}:recovered-handle`;

describe("OMR browser recovery authority", () => {
  it("preserves structured HTTP status, code, and Korean message without raw payload exposure", async () => {
    const response = new Response(JSON.stringify({
      error: { code: "OMR_CREATE_REPLAY_UNAVAILABLE", messageKo: "새 요청 키가 필요합니다.", providerSecret: "never-expose" },
      providerPayload: "never-expose",
    }), { status: 409, headers: { "content-type": "application/json" } });
    const caught = await readOmrApiJson(response).catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(OmrApiRequestError);
    expect(caught).toMatchObject({ status: 409, code: "OMR_CREATE_REPLAY_UNAVAILABLE", messageKo: "새 요청 키가 필요합니다." });
    expect(String(caught)).not.toContain("never-expose");
  });

  it("keeps an active recovery handle and never creates a duplicate job", async () => {
    const storage = memoryStorage({ [recoveryStorageKey]: "handle:active" });
    const create = vi.fn();
    await expect(acquireOmrJob({
      storage, createStorageKey, recoveryStorageKey, forceFresh: false,
      createRequest: () => ({ idempotencyKey: "fresh" }),
      recover: async () => ({ kind: "processing" as const }), create,
    })).resolves.toEqual({ kind: "acquired", handle: "handle:active", recoveredStatus: { kind: "processing" } });
    expect(storage.getItem(recoveryStorageKey)).toBe("handle:active");
    expect(create).not.toHaveBeenCalled();
  });

  it("stops a stale recovery loop and requires an explicit fresh start", async () => {
    const storage = memoryStorage({ [recoveryStorageKey]: "handle:stale" });
    const recover = vi.fn(async () => { throw new OmrApiRequestError(404, "OMR_JOB_UNAVAILABLE", "복구할 수 없습니다."); });
    const create = vi.fn();
    await expect(acquireOmrJob({
      storage, createStorageKey, recoveryStorageKey, forceFresh: false,
      createRequest: () => ({ idempotencyKey: "fresh" }), recover, create,
    })).resolves.toEqual({ kind: "fresh-start-required", reason: "stale-recovery-handle" });
    expect(storage.getItem(recoveryStorageKey)).toBeNull();
    expect(recover).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it("preserves the recovery handle on network and 5xx ambiguity", async () => {
    for (const failure of [new TypeError("network lost"), new OmrApiRequestError(503, "OMR_INTERNAL", "일시 오류")]) {
      const storage = memoryStorage({ [recoveryStorageKey]: "handle:keep" });
      await expect(acquireOmrJob({
        storage, createStorageKey, recoveryStorageKey, forceFresh: false,
        createRequest: () => ({ idempotencyKey: "unused" }),
        recover: async () => { throw failure; }, create: vi.fn(),
      })).rejects.toBe(failure);
      expect(storage.getItem(recoveryStorageKey)).toBe("handle:keep");
    }
  });

  it("retires only the rejected create key and performs no automatic fresh create", async () => {
    const oldRequest = { pageCount: 1, idempotencyKey: "old-key" };
    const baseStorage = memoryStorage({
      [createStorageKey]: JSON.stringify(oldRequest),
      [recoveryStorageKey]: "stale-companion",
    });
    let recoveryLookup = 0;
    const storage: OmrBrowserStorage = {
      getItem(key) {
        if (key === recoveryStorageKey && recoveryLookup++ === 0) return null;
        return baseStorage.getItem(key);
      },
      setItem: (key, value) => baseStorage.setItem(key, value),
      removeItem: (key) => baseStorage.removeItem(key),
    };
    const create = vi.fn(async () => { throw new OmrApiRequestError(409, "OMR_CREATE_REPLAY_UNAVAILABLE", "retired"); });
    await expect(acquireOmrJob({
      storage, createStorageKey, recoveryStorageKey, forceFresh: false,
      createRequest: () => ({ pageCount: 1, idempotencyKey: "must-not-run" }),
      recover: vi.fn(), create,
    })).resolves.toEqual({ kind: "fresh-start-required", reason: "retired-create-replay" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(oldRequest);
    expect(baseStorage.getItem(createStorageKey)).toBeNull();
    expect(baseStorage.getItem(recoveryStorageKey)).toBeNull();
  });

  it("uses one fresh random key on explicit action and lets the same input acquire a new handle", async () => {
    const storage = memoryStorage({ [createStorageKey]: JSON.stringify({ pageCount: 1, idempotencyKey: "old-key" }) });
    const create = vi.fn(async (request: Readonly<Record<string, unknown>>) => ({ handle: `handle:${String(request.idempotencyKey)}` }));
    const freshRequest = vi.fn(() => ({ pageCount: 1, pageDigest: "same-input", idempotencyKey: "fresh-random-key" }));
    await expect(acquireOmrJob({
      storage, createStorageKey, recoveryStorageKey, forceFresh: true,
      createRequest: freshRequest, recover: vi.fn(), create,
    })).resolves.toEqual({ kind: "acquired", handle: "handle:fresh-random-key" });
    expect(freshRequest).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ pageCount: 1, pageDigest: "same-input", idempotencyKey: "fresh-random-key" });
    expect(storage.getItem(createStorageKey)).toBeNull();
    expect(storage.getItem(recoveryStorageKey)).toBe("handle:fresh-random-key");
  });

  it("keeps the old create key after an ambiguous timeout", async () => {
    const request = { pageCount: 1, idempotencyKey: "stable-key" };
    const storage = memoryStorage({ [createStorageKey]: JSON.stringify(request) });
    const timeout = new TypeError("response lost");
    await expect(acquireOmrJob({
      storage, createStorageKey, recoveryStorageKey, forceFresh: false,
      createRequest: () => ({ idempotencyKey: "must-not-rotate" }),
      recover: vi.fn(), create: async () => { throw timeout; },
    })).rejects.toBe(timeout);
    expect(JSON.parse(storage.getItem(createStorageKey) ?? "{}")).toEqual(request);
  });
});
