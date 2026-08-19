import { describe, expect, it } from "vitest";

import type { PracticeSharePayload } from "../domain/share";
import { completedShareRecoveryTransport, dispatchShareOwnerReconciliation } from "./share-create-api";
import {
  allowShareCreateFreshIntent, bindShareCreateSession, completeShareCreateRecovery,
  IndexedDbShareCreateRecoveryStore, MemoryShareCreateRecoveryStore, prepareShareCreateRecovery, ShareCreateOperationGate,
  restoredShareCreateUiAuthority, type CanonicalShareCreateRequest, type ShareCreateRecoveryEnvelope,
} from "./share-create-recovery";

const digest = "a".repeat(64) as PracticeSharePayload["arrangementArtifactDigest"];
const now = new Date("2026-01-01T00:00:00.000Z");
const K1 = "11111111-1111-4111-8111-111111111111";
const K2 = "22222222-2222-4222-8222-222222222222";

function canonicalRequest(title = "Frozen at 00:00"): CanonicalShareCreateRequest {
  return {
    rightsBasis: "self-authored",
    payload: {
      schemaVersion: 3, title, tempo: { beatUnit: 4, dotted: false, bpm: 80 },
      key: { tonic: { step: "C", alter: 0 }, mode: "major" }, presetId: "standard",
      arrangementArtifactDigest: digest, effectiveChordTimelineDigest: digest,
      arrangement: { measures: [{ index: 0, lyricVerseIndex: 1, timeSignature: [4, 4], duration: [4, 1] }], tracks: [{ kind: "source-lead", label: "Lead", events: [] }] },
      lyrics: [], rightsShareConfirmed: true,
    },
  };
}

function ids(...values: string[]): () => string { const queue = [...values]; return () => queue.shift() ?? "unexpected-id"; }

function memoryIndexedDb(): IDBFactory {
  const rows = new Map<string, ShareCreateRecoveryEnvelope>();
  let storeCreated = false;
  const request = <T>(result: T): IDBRequest<T> => {
    const value = { result, onsuccess: null, onerror: null } as unknown as IDBRequest<T>;
    queueMicrotask(() => value.onsuccess?.({ target: value } as unknown as Event));
    return value;
  };
  const objectStore = {
    put(value: ShareCreateRecoveryEnvelope) { rows.set(value.projectId, structuredClone(value)); return request(value.projectId); },
    get(key: string) { return request(rows.get(key)); },
    delete(key: string) { rows.delete(key); return request(undefined); },
  } as unknown as IDBObjectStore;
  const database = {
    objectStoreNames: { contains: () => storeCreated },
    createObjectStore: () => { storeCreated = true; return objectStore; },
    transaction: () => {
      const transaction = { oncomplete: null, onerror: null, onabort: null, error: null, objectStore: () => objectStore } as unknown as IDBTransaction;
      setTimeout(() => transaction.oncomplete?.({ target: transaction } as unknown as Event), 0);
      return transaction;
    },
    close: () => undefined,
  } as unknown as IDBDatabase;
  return {
    open: () => {
      const value = { result: database, onupgradeneeded: null, onsuccess: null, onerror: null, error: null } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => {
        if (!storeCreated) value.onupgradeneeded?.({ target: value } as unknown as IDBVersionChangeEvent);
        value.onsuccess?.({ target: value } as unknown as Event);
      });
      return value;
    },
  } as unknown as IDBFactory;
}

describe("durable browser ShareStore create authority", () => {
  it("persists exact body+K1 before dispatch and reuses both after changed-clock regeneration", async () => {
    const store = new MemoryShareCreateRecoveryStore();
    const first = await prepareShareCreateRecovery({ store, projectId: "project:A", canonicalRequest: canonicalRequest("clock:00:00"), explicitFreshIntent: false, generateId: ids(K1, "intent-K1"), now });
    expect(first).toMatchObject({ idempotencyKey: K1, operationLifecycle: "pending", canonicalRequest: { payload: { title: "clock:00:00" } } });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const reloaded = await prepareShareCreateRecovery({ store, projectId: "project:A", canonicalRequest: canonicalRequest("clock:23:59"), explicitFreshIntent: false, generateId: ids("must-not-rotate", "must-not-rotate-intent"), now: new Date(now.getTime() + 86_400_000 + attempt) });
      expect(reloaded.idempotencyKey).toBe(K1);
      expect(reloaded.canonicalRequest.payload.title).toBe("clock:00:00");
    }
  });

  it("recovers exact token/delete secret after commit-ack loss and validates digest on every reload", async () => {
    const store = new MemoryShareCreateRecoveryStore();
    let envelope = await prepareShareCreateRecovery({ store, projectId: "project:A", canonicalRequest: canonicalRequest(), explicitFreshIntent: false, generateId: ids(K1, "intent-K1"), now });
    envelope = await bindShareCreateSession({ store, envelope, sessionAuthority: "s".repeat(64), sessionExpiresAt: "2026-02-01T00:00:00.000Z", now });
    expect(await store.load("project:A")).toMatchObject({ idempotencyKey: K1, operationLifecycle: "pending", sessionAuthority: "s".repeat(64) });
    const replay = { token: "same-share-token", ownerDeleteSecret: "same-owner-delete-secret" };
    await completeShareCreateRecovery({ store, envelope, response: replay, now: new Date(now.getTime() + 1_000) });
    expect(await store.load("project:A")).toMatchObject({ idempotencyKey: K1, operationLifecycle: "completed", createdResponse: replay, completedAuthorities: [replay] });
  });

  it("allows K2 only after exact typed fresh authority and preserves completed owner authority", async () => {
    const store = new MemoryShareCreateRecoveryStore();
    let first = await prepareShareCreateRecovery({ store, projectId: "project:A", canonicalRequest: canonicalRequest("first"), explicitFreshIntent: false, generateId: ids(K1, "intent-K1"), now });
    first = await completeShareCreateRecovery({ store, envelope: first, response: { token: "first-share-token", ownerDeleteSecret: "first-delete-secret" }, now });
    await expect(prepareShareCreateRecovery({ store, projectId: "project:A", canonicalRequest: canonicalRequest("second"), explicitFreshIntent: true, generateId: ids(K2, "intent-K2"), now })).rejects.toThrow("SHARE_CREATE_FRESH_INTENT_NOT_AUTHORIZED");
    await allowShareCreateFreshIntent({ store, envelope: first, reason: "retired-replay", now });
    const fresh = await prepareShareCreateRecovery({ store, projectId: "project:A", canonicalRequest: canonicalRequest("second"), explicitFreshIntent: true, generateId: ids(K2, "intent-K2"), now });
    expect(fresh).toMatchObject({ idempotencyKey: K2, canonicalRequest: { payload: { title: "second" } }, completedAuthorities: [{ token: "first-share-token", ownerDeleteSecret: "first-delete-secret", idempotencyKey: K1 }] });
  });

  it("reconciles completed owner authority after session rotation and creates K2 only after exact retirement", async () => {
    const store = new MemoryShareCreateRecoveryStore();
    let completed = await prepareShareCreateRecovery({ store, projectId: "project:A", canonicalRequest: canonicalRequest("expired"), explicitFreshIntent: false, generateId: ids(K1, "intent-K1"), now });
    completed = await bindShareCreateSession({ store, envelope: completed, sessionAuthority: "a".repeat(64), sessionExpiresAt: "2026-01-31T00:00:00.000Z", now });
    completed = await completeShareCreateRecovery({ store, envelope: completed, response: { token: "expired-share-token", ownerDeleteSecret: "expired-delete-secret" }, now });
    expect(completedShareRecoveryTransport(completed, "b".repeat(64))).toBe("owner-reconcile");
    const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("/api/shares/expired-share-token/reconcile");
      expect(JSON.parse(String(init?.body))).toEqual({ ownerDeleteSecret: "expired-delete-secret" });
      return new Response(JSON.stringify({ ok: false, error: { code: "SHARE_CREATE_REPLAY_RETIRED", reason: "expired" } }), { status: 409 });
    };
    const outcome = await dispatchShareOwnerReconciliation({ envelope: completed, fetcher });
    expect(outcome).toEqual({ kind: "fresh-allowed", code: "SHARE_CREATE_REPLAY_RETIRED", reason: "expired" });
    if (outcome.kind !== "fresh-allowed") throw new Error("expected retired replay");
    completed = await allowShareCreateFreshIntent({ store, envelope: completed, reason: "retired-replay", now: new Date(now.getTime() + 181 * 86_400_000) });
    const fresh = await prepareShareCreateRecovery({ store, projectId: "project:A", canonicalRequest: canonicalRequest("fresh"), explicitFreshIntent: true, generateId: ids(K2, "intent-K2"), now: new Date(now.getTime() + 181 * 86_400_000 + 1) });
    expect(fresh).toMatchObject({ idempotencyKey: K2, operationLifecycle: "pending", completedAuthorities: [{ token: "expired-share-token", idempotencyKey: K1 }] });
  });

  it("rejects a completed replay that changes token or owner delete authority", async () => {
    const store = new MemoryShareCreateRecoveryStore();
    let completed = await prepareShareCreateRecovery({ store, projectId: "project:A", canonicalRequest: canonicalRequest(), explicitFreshIntent: false, generateId: ids(K1, "intent-K1"), now });
    completed = await completeShareCreateRecovery({ store, envelope: completed, response: { token: "same-share-token", ownerDeleteSecret: "same-delete-secret" }, now });
    await expect(completeShareCreateRecovery({ store, envelope: completed, response: { token: "other-share-token", ownerDeleteSecret: "other-delete-secret" }, now })).rejects.toThrow("SHARE_CREATE_REPLAY_AUTHORITY_MISMATCH");
  });

  it("fences session replacement and rapid duplicate clicks", async () => {
    const store = new MemoryShareCreateRecoveryStore();
    const first = await prepareShareCreateRecovery({ store, projectId: "project:A", canonicalRequest: canonicalRequest(), explicitFreshIntent: false, generateId: ids(K1, "intent-K1"), now });
    const bound = await bindShareCreateSession({ store, envelope: first, sessionAuthority: "a".repeat(64), sessionExpiresAt: "2026-02-01T00:00:00.000Z", now });
    await expect(bindShareCreateSession({ store, envelope: bound, sessionAuthority: "b".repeat(64), sessionExpiresAt: "2026-02-01T00:00:00.000Z", now })).rejects.toThrow("SHARE_CREATE_SESSION_AUTHORITY_CHANGED");
    const gate = new ShareCreateOperationGate();
    expect(gate.tryBegin()).toBe(true); expect(gate.tryBegin()).toBe(false); gate.finish(); expect(gate.tryBegin()).toBe(true);
  });

  it("requires UUIDv4 K1 and reloads a pending envelope through a new IndexedDB store instance", async () => {
    const factory = memoryIndexedDb();
    const firstInstance = new IndexedDbShareCreateRecoveryStore(factory);
    await expect(prepareShareCreateRecovery({ store: firstInstance, projectId: "project:invalid", canonicalRequest: canonicalRequest(), explicitFreshIntent: false, generateId: ids("low-entropy-key", "intent"), now })).rejects.toThrow("IDEMPOTENCY_KEY_INVALID");
    const envelope = await prepareShareCreateRecovery({ store: firstInstance, projectId: "project:durable", canonicalRequest: canonicalRequest("durable"), explicitFreshIntent: false, generateId: ids(K1, "intent"), now });
    await bindShareCreateSession({ store: firstInstance, envelope, sessionAuthority: "a".repeat(64), sessionExpiresAt: "2026-01-31T00:00:00.000Z", now });
    const secondInstance = new IndexedDbShareCreateRecoveryStore(factory);
    const pending = await secondInstance.load("project:durable");
    expect(pending).toMatchObject({ idempotencyKey: K1, operationLifecycle: "pending", canonicalRequest: { payload: { title: "durable" } } });
    if (!pending) throw new Error("pending recovery envelope missing");
    const response = { token: "durable-share-token", ownerDeleteSecret: "durable-owner-delete-secret" };
    await completeShareCreateRecovery({ store: secondInstance, envelope: pending, response, now: new Date(now.getTime() + 31 * 86_400_000) });
    const thirdInstance = new IndexedDbShareCreateRecoveryStore(factory);
    const completed = await thirdInstance.load("project:durable");
    expect(completed).toMatchObject({
      idempotencyKey: K1,
      operationLifecycle: "completed",
      createdResponse: response,
      completedAuthorities: [{ ...response, idempotencyKey: K1 }],
    });
    expect(completed?.createdResponse).toEqual(response); // Exact input consumed by the owner-delete workflow after reload.
  });

  it("restores deterministic-no-effect fresh authority while the old envelope remains pending", async () => {
    const factory = memoryIndexedDb();
    const beforeReload = new IndexedDbShareCreateRecoveryStore(factory);
    const pending = await prepareShareCreateRecovery({ store: beforeReload, projectId: "project:fresh-reload", canonicalRequest: canonicalRequest("old"), explicitFreshIntent: false, generateId: ids(K1, "intent-1"), now });
    await allowShareCreateFreshIntent({ store: beforeReload, envelope: pending, reason: "deterministic-no-effect", now });
    const afterReload = new IndexedDbShareCreateRecoveryStore(factory);
    const reloaded = await afterReload.load("project:fresh-reload");
    if (!reloaded) throw new Error("fresh recovery envelope missing");
    expect(reloaded).toMatchObject({ operationLifecycle: "pending", freshIntentAuthority: { reason: "deterministic-no-effect" } });
    const restored = restoredShareCreateUiAuthority(reloaded);
    expect(restored).toEqual({ freshIntentAllowed: true });
    expect(restored.createdResponse).toBeUndefined();
    const fresh = await prepareShareCreateRecovery({ store: afterReload, projectId: "project:fresh-reload", canonicalRequest: canonicalRequest("new"), explicitFreshIntent: true, generateId: ids(K2, "intent-2"), now: new Date(now.getTime() + 1) });
    expect(fresh).toMatchObject({ operationLifecycle: "pending", idempotencyKey: K2, canonicalRequest: { payload: { title: "new" } } });
  });
});
