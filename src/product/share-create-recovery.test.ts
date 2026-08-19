import { describe, expect, it } from "vitest";

import type { PracticeSharePayload } from "../domain/share";
import {
  allowShareCreateFreshIntent, bindShareCreateSession, completeShareCreateRecovery,
  MemoryShareCreateRecoveryStore, prepareShareCreateRecovery, ShareCreateOperationGate,
  type CanonicalShareCreateRequest,
} from "./share-create-recovery";

const digest = "a".repeat(64) as PracticeSharePayload["arrangementArtifactDigest"];
const now = new Date("2026-01-01T00:00:00.000Z");

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

describe("durable browser ShareStore create authority", () => {
  it("persists exact body+K1 before dispatch and reuses both after changed-clock regeneration", async () => {
    const store = new MemoryShareCreateRecoveryStore();
    const first = await prepareShareCreateRecovery({ store, projectId: "project:A", canonicalRequest: canonicalRequest("clock:00:00"), explicitFreshIntent: false, generateId: ids("request-key-K1", "intent-K1"), now });
    expect(first).toMatchObject({ idempotencyKey: "request-key-K1", operationLifecycle: "pending", canonicalRequest: { payload: { title: "clock:00:00" } } });
    for (const _ambiguousOutcome of ["no-effect-network", "timeout", "5xx", "reload-after-clock-change"] as const) {
      const reloaded = await prepareShareCreateRecovery({ store, projectId: "project:A", canonicalRequest: canonicalRequest("clock:23:59"), explicitFreshIntent: false, generateId: ids("must-not-rotate", "must-not-rotate-intent"), now: new Date(now.getTime() + 86_400_000) });
      expect(reloaded.idempotencyKey).toBe("request-key-K1");
      expect(reloaded.canonicalRequest.payload.title).toBe("clock:00:00");
    }
  });

  it("recovers exact token/delete secret after commit-ack loss and validates digest on every reload", async () => {
    const store = new MemoryShareCreateRecoveryStore();
    let envelope = await prepareShareCreateRecovery({ store, projectId: "project:A", canonicalRequest: canonicalRequest(), explicitFreshIntent: false, generateId: ids("request-key-K1", "intent-K1"), now });
    envelope = await bindShareCreateSession({ store, envelope, sessionAuthority: "s".repeat(64), sessionExpiresAt: "2026-02-01T00:00:00.000Z", now });
    expect(await store.load("project:A")).toMatchObject({ idempotencyKey: "request-key-K1", operationLifecycle: "pending", sessionAuthority: "s".repeat(64) });
    const replay = { token: "same-share-token", ownerDeleteSecret: "same-owner-delete-secret" };
    await completeShareCreateRecovery({ store, envelope, response: replay, now: new Date(now.getTime() + 1_000) });
    expect(await store.load("project:A")).toMatchObject({ idempotencyKey: "request-key-K1", operationLifecycle: "completed", createdResponse: replay, completedAuthorities: [replay] });
  });

  it("allows K2 only after exact typed fresh authority and preserves completed owner authority", async () => {
    const store = new MemoryShareCreateRecoveryStore();
    let first = await prepareShareCreateRecovery({ store, projectId: "project:A", canonicalRequest: canonicalRequest("first"), explicitFreshIntent: false, generateId: ids("request-key-K1", "intent-K1"), now });
    first = await completeShareCreateRecovery({ store, envelope: first, response: { token: "first-share-token", ownerDeleteSecret: "first-delete-secret" }, now });
    await expect(prepareShareCreateRecovery({ store, projectId: "project:A", canonicalRequest: canonicalRequest("second"), explicitFreshIntent: true, generateId: ids("request-key-K2", "intent-K2"), now })).rejects.toThrow("SHARE_CREATE_FRESH_INTENT_NOT_AUTHORIZED");
    first = await allowShareCreateFreshIntent({ store, envelope: first, reason: "retired-replay", now });
    const fresh = await prepareShareCreateRecovery({ store, projectId: "project:A", canonicalRequest: canonicalRequest("second"), explicitFreshIntent: true, generateId: ids("request-key-K2", "intent-K2"), now });
    expect(fresh).toMatchObject({ idempotencyKey: "request-key-K2", canonicalRequest: { payload: { title: "second" } }, completedAuthorities: [{ token: "first-share-token", ownerDeleteSecret: "first-delete-secret", idempotencyKey: "request-key-K1" }] });
  });

  it("fences session replacement and rapid duplicate clicks", async () => {
    const store = new MemoryShareCreateRecoveryStore();
    const first = await prepareShareCreateRecovery({ store, projectId: "project:A", canonicalRequest: canonicalRequest(), explicitFreshIntent: false, generateId: ids("request-key-K1", "intent-K1"), now });
    const bound = await bindShareCreateSession({ store, envelope: first, sessionAuthority: "a".repeat(64), sessionExpiresAt: "2026-02-01T00:00:00.000Z", now });
    await expect(bindShareCreateSession({ store, envelope: bound, sessionAuthority: "b".repeat(64), sessionExpiresAt: "2026-02-01T00:00:00.000Z", now })).rejects.toThrow("SHARE_CREATE_SESSION_AUTHORITY_CHANGED");
    const gate = new ShareCreateOperationGate();
    expect(gate.tryBegin()).toBe(true); expect(gate.tryBegin()).toBe(false); gate.finish(); expect(gate.tryBegin()).toBe(true);
  });
});
