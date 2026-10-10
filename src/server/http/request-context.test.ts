import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
vi.mock("../substrate/services", () => ({ getProductionServices: vi.fn(async () => { throw new Error("private-cookie shared-score 192.0.2.9"); }) }));
import { createApiRequest, mapApiFailure } from "./api";
import { GET } from "../../app/api/shares/[token]/route";
import { POST } from "../../app/api/session/route";
afterEach(() => vi.restoreAllMocks());

describe("request-correlated API failures", () => {
  it.each(["unregistered detail", "UNKNOWN_CONFLICT", "UNKNOWN_PENDING", "SHARE_ROUNDTRIP_FAILED"])("returns 500 for unknown/internal RangeError %s", async message => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const context = createApiRequest("/api/shares/[token]");
    const response = await mapApiFailure(new RangeError(message), context);
    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBe(context.requestId);
    expect(await response.json()).toMatchObject({ error: { code: "SERVER_OPERATION_FAILED" } });
    const event = JSON.parse(log.mock.calls[0][0]);
    expect(event).toMatchObject({ requestId: context.requestId, path: context.path, kind: "RangeError" });
    expect(event.timestamp).toMatch(/^\d{4}-/u);
    expect(event).toHaveProperty("stack");
  });
  it.each(["SHARE_REQUEST_INVALID", "ABUSE_REPORT_INVALID", "IDEMPOTENCY_KEY_INVALID"])("keeps known input error %s at 400", async code => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await mapApiFailure(new RangeError(code))).status).toBe(400);
    expect(log).not.toHaveBeenCalled();
  });
  it("never logs raw URL tokens, request headers, error prose or stack paths", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await GET(new NextRequest("https://example.test/api/shares/secret-token?cookie=private-cookie", { headers: { cookie: "private-cookie", "x-request-id": "attacker-id" } }), { params: Promise.resolve({ token: "secret-token" }) });
    const text = log.mock.calls[0][0] as string;
    expect(text).not.toMatch(/secret-token|private-cookie|shared-score|192\.0\.2\.9|attacker-id/u);
    expect(JSON.parse(text).requestId).toBe(response.headers.get("x-request-id"));
    expect(JSON.parse(text).path).toBe("/api/shares/[token]");
  });
  it("adds independent request IDs even to early security rejections and success JSON", async () => {
    const a = await POST(new NextRequest("https://example.test/api/session", { method: "POST", headers: { origin: "https://foreign.test", host: "example.test" } }));
    const b = createApiRequest("/api/session").json({ ok: true });
    expect(a.status).toBe(403);
    expect(a.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/u);
    expect(b.headers.get("x-request-id")).not.toBe(a.headers.get("x-request-id"));
    expect(await b.json()).toEqual({ ok: true });
  });
});
