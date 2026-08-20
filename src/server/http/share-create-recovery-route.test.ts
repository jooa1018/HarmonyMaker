import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getProductionServices = vi.hoisted(() => vi.fn());
vi.mock("../substrate/services", () => ({ getProductionServices }));

import { NextRequest } from "next/server";
import { POST } from "../../app/api/shares/recover/route";

const K1 = "11111111-1111-4111-8111-111111111111";
const requestDigest = "a".repeat(64);

function request(body: unknown): NextRequest {
  return new NextRequest("https://hm.test/api/shares/recover", {
    method: "POST",
    headers: { origin: "https://hm.test", host: "hm.test", "content-type": "application/json", "x-csrf-token": "csrf" },
    body: JSON.stringify(body),
  });
}

afterEach(() => getProductionServices.mockReset());

describe("cross-session share-create recovery route", () => {
  it("requires an authenticated bounded UUIDv4 K1 request", async () => {
    const authorizeMutation = vi.fn().mockResolvedValue({ id: "1" });
    getProductionServices.mockResolvedValue({ sessions: { authorizeMutation } });
    expect((await POST(request({ idempotencyKey: "predictable-key", requestDigest }))).status).toBe(400);
    expect(authorizeMutation).toHaveBeenCalledOnce();
  });

  it("only observes/fences the exact K1+digest and never calls share creation", async () => {
    const recoverIdempotency = vi.fn().mockResolvedValue({ status: "missing" });
    const create = vi.fn();
    const createAndCompleteIdempotency = vi.fn();
    getProductionServices.mockResolvedValue({
      sessions: { authorizeMutation: vi.fn().mockResolvedValue({ id: "1" }) },
      quota: { recoverIdempotency },
      shares: { create, createAndCompleteIdempotency, replayIdempotentCreate: vi.fn() },
    });
    const response = await POST(request({ idempotencyKey: K1, requestDigest }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "SHARE_CREATE_DETERMINISTIC_NO_EFFECT" } });
    expect(recoverIdempotency).toHaveBeenCalledWith({ operation: "share-create-v1", key: K1, requestDigest, now: expect.any(Date) });
    expect(create).not.toHaveBeenCalled();
    expect(createAndCompleteIdempotency).not.toHaveBeenCalled();
  });
});
