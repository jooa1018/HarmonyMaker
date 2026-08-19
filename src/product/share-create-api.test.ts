import { describe, expect, it } from "vitest";

import { classifyShareCreateApiResult, classifyShareCreateReadOnlyRecoveryResult, classifyShareCreateTransportFailure, classifyShareOwnerReconcileApiResult, completedShareRecoveryTransport, dispatchShareCreateReadOnlyRecovery, dispatchShareCreateRecovery, dispatchShareOwnerReconciliation, pendingShareRecoveryTransport, readShareCreateApiResponse, serializedShareCreateRecoveryRequest } from "./share-create-api";
import type { ShareCreateRecoveryEnvelope } from "./share-create-recovery";

const K1 = "11111111-1111-4111-8111-111111111111";

describe("typed browser ShareStore create outcome policy", () => {
  it("retains exact body+K1 for uncertain transport, timeout, rate limit, 5xx, and pending", () => {
    expect(classifyShareCreateTransportFailure(new TypeError("network"))).toEqual({ kind: "retain", code: "NETWORK_UNCERTAIN" });
    expect(classifyShareCreateApiResult(408, {})).toEqual({ kind: "retain", code: "REQUEST_TIMEOUT" });
    expect(classifyShareCreateApiResult(429, { error: { code: "QUOTA_EXCEEDED" } })).toEqual({ kind: "retain", code: "RATE_LIMITED" });
    expect(classifyShareCreateApiResult(503, { error: { code: "SERVER_OPERATION_FAILED" } })).toEqual({ kind: "retain", code: "SERVER_TRANSIENT" });
    expect(classifyShareCreateApiResult(409, { error: { code: "IDEMPOTENCY_PENDING" } })).toEqual({ kind: "retain", code: "IDEMPOTENCY_PENDING" });
  });

  it("allows fresh only for exact retired replay and fails closed on request conflict", () => {
    expect(classifyShareCreateApiResult(409, { error: { code: "SHARE_CREATE_REPLAY_RETIRED" } })).toEqual({ kind: "fresh-allowed", code: "SHARE_CREATE_REPLAY_RETIRED" });
    expect(classifyShareCreateApiResult(409, { error: { code: "IDEMPOTENCY_CONFLICT" } })).toEqual({ kind: "conflict", code: "IDEMPOTENCY_CONFLICT" });
    expect(classifyShareCreateApiResult(400, { error: { code: "SOME_OTHER_4XX" } })).toEqual({ kind: "rejected", code: "SOME_OTHER_4XX" });
  });

  it("accepts only a consumer-complete stored success response", async () => {
    const response = new Response(JSON.stringify({ ok: true, share: { kind: "store", token: "stored-token-123", ownerDeleteSecret: "delete-secret-123" } }), { status: 201 });
    await expect(readShareCreateApiResponse(response)).resolves.toEqual({ kind: "completed", response: { token: "stored-token-123", ownerDeleteSecret: "delete-secret-123" } });
    expect(classifyShareCreateApiResult(201, { ok: true, share: { kind: "url" } })).toEqual({ kind: "retain", code: "RESPONSE_UNCERTAIN" });
    await expect(readShareCreateApiResponse(new Response("{", { status: 200 }))).resolves.toEqual({ kind: "retain", code: "RESPONSE_UNCERTAIN" });
    await expect(readShareCreateApiResponse(new Response("{", { status: 408 }))).resolves.toEqual({ kind: "retain", code: "REQUEST_TIMEOUT" });
    await expect(readShareCreateApiResponse(new Response("{", { status: 429 }))).resolves.toEqual({ kind: "retain", code: "RATE_LIMITED" });
    await expect(readShareCreateApiResponse(new Response("{", { status: 503 }))).resolves.toEqual({ kind: "retain", code: "SERVER_TRANSIENT" });
  });

  it("dispatches a completed envelope with the exact frozen request and K1", async () => {
    const envelope = {
      version: 1,
      projectId: "project:A",
      canonicalRequest: {
        rightsBasis: "self-authored",
        payload: {
          schemaVersion: 3, title: "frozen", tempo: { beatUnit: 4, dotted: false, bpm: 80 },
          key: { tonic: { step: "C", alter: 0 }, mode: "major" }, presetId: "standard",
          arrangementArtifactDigest: "a".repeat(64), effectiveChordTimelineDigest: "a".repeat(64),
          arrangement: { measures: [{ index: 0, lyricVerseIndex: 1, timeSignature: [4, 4], duration: [4, 1] }], tracks: [{ kind: "source-lead", label: "Lead", events: [] }] },
          lyrics: [], rightsShareConfirmed: true,
        },
      },
      requestDigest: "b".repeat(64), idempotencyKey: K1, operationLifecycle: "completed",
      explicitFreshIntentId: "intent-K1", createdResponse: { token: "stored-token-123", ownerDeleteSecret: "delete-secret-123" },
      completedAuthorities: [], updatedAt: "2026-01-01T00:00:00.000Z",
    } as unknown as ShareCreateRecoveryEnvelope;
    const fetcher = async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.body).toBe(serializedShareCreateRecoveryRequest(envelope));
      expect(JSON.parse(String(init?.body))).toEqual({ ...envelope.canonicalRequest, idempotencyKey: K1 });
      return new Response(JSON.stringify({ ok: true, share: { kind: "store", ...envelope.createdResponse } }), { status: 200 });
    };
    await expect(dispatchShareCreateRecovery({ envelope, csrfToken: "csrf", fetcher })).resolves.toEqual({ kind: "completed", response: envelope.createdResponse });
    expect(completedShareRecoveryTransport(envelope, "old-session-authority")).toBe("owner-reconcile");
    expect(completedShareRecoveryTransport({ ...envelope, sessionAuthority: "same-session-authority" }, "same-session-authority")).toBe("idempotent-replay");
  });

  it("uses a read-only cross-session endpoint for pending K1 and never serializes a new create body", async () => {
    const envelope = {
      operationLifecycle: "pending",
      idempotencyKey: K1,
      requestDigest: "b".repeat(64),
      sessionAuthority: "a".repeat(64),
    } as ShareCreateRecoveryEnvelope;
    expect(pendingShareRecoveryTransport(envelope, "b".repeat(64))).toBe("cross-session-recovery");
    expect(pendingShareRecoveryTransport(envelope, "a".repeat(64))).toBe("idempotent-replay");
    const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("/api/shares/recover");
      expect(JSON.parse(String(init?.body))).toEqual({ idempotencyKey: K1, requestDigest: "b".repeat(64) });
      expect(String(init?.body)).not.toContain("canonicalRequest");
      return new Response(JSON.stringify({ ok: true, share: { kind: "store", token: "stored-token-123", ownerDeleteSecret: "delete-secret-123" } }), { status: 200 });
    };
    await expect(dispatchShareCreateReadOnlyRecovery({ envelope, csrfToken: "csrf", fetcher })).resolves.toEqual({ kind: "completed", response: { token: "stored-token-123", ownerDeleteSecret: "delete-secret-123" } });
    expect(classifyShareCreateReadOnlyRecoveryResult(409, { error: { code: "IDEMPOTENCY_PENDING" } })).toEqual({ kind: "retain", code: "IDEMPOTENCY_PENDING" });
    expect(classifyShareCreateReadOnlyRecoveryResult(409, { error: { code: "SHARE_CREATE_DETERMINISTIC_NO_EFFECT" } })).toEqual({ kind: "fresh-allowed", code: "SHARE_CREATE_DETERMINISTIC_NO_EFFECT" });
    expect(classifyShareCreateReadOnlyRecoveryResult(409, { error: { code: "IDEMPOTENCY_AMBIGUOUS" } })).toEqual({ kind: "conflict", code: "IDEMPOTENCY_AMBIGUOUS" });
    expect(classifyShareCreateReadOnlyRecoveryResult(429, {})).toEqual({ kind: "retain", code: "RATE_LIMITED" });
  });

  it("uses exact owner authority after session rotation and only accepts typed natural/delete retirement", async () => {
    const envelope = {
      operationLifecycle: "completed",
      createdResponse: { token: "stored-token-123", ownerDeleteSecret: "delete-secret-123" },
    } as ShareCreateRecoveryEnvelope;
    const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("/api/shares/stored-token-123/reconcile");
      expect(JSON.parse(String(init?.body))).toEqual({ ownerDeleteSecret: "delete-secret-123" });
      return new Response(JSON.stringify({ ok: false, error: { code: "SHARE_CREATE_REPLAY_RETIRED", reason: "owner-deleted" } }), { status: 409 });
    };
    await expect(dispatchShareOwnerReconciliation({ envelope, fetcher })).resolves.toEqual({ kind: "fresh-allowed", code: "SHARE_CREATE_REPLAY_RETIRED", reason: "owner-deleted" });
    expect(classifyShareOwnerReconcileApiResult(200, { ok: true, state: "active" })).toEqual({ kind: "active" });
    expect(classifyShareOwnerReconcileApiResult(409, { error: { code: "SHARE_CREATE_REPLAY_RETIRED" } })).toEqual({ kind: "rejected", code: "SHARE_CREATE_REPLAY_RETIRED" });
    expect(classifyShareOwnerReconcileApiResult(404, { error: { code: "SHARE_UNAVAILABLE" } })).toEqual({ kind: "rejected", code: "SHARE_UNAVAILABLE" });
  });
});
