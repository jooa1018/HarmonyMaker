import { describe, expect, it } from "vitest";

import { classifyShareCreateApiResult, classifyShareCreateTransportFailure, readShareCreateApiResponse } from "./share-create-api";

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
});
