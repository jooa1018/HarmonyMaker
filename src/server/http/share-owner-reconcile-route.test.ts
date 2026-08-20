import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getProductionServices = vi.hoisted(() => vi.fn());
vi.mock("../substrate/services", () => ({ getProductionServices }));

import { NextRequest } from "next/server";
import { POST } from "../../app/api/shares/[token]/reconcile/route";

const context = { params: Promise.resolve({ token: "stored-share-token-1234" }) };
const secret = "owner-delete-secret-1234";

function request(body: string, origin = "https://hm.test"): NextRequest {
  return new NextRequest("https://hm.test/api/shares/stored-share-token-1234/reconcile", {
    method: "POST",
    headers: { origin, host: "hm.test", "content-type": "application/json" },
    body,
  });
}

afterEach(() => getProductionServices.mockReset());

describe("share owner reconciliation route authority", () => {
  it("rejects origin and bounded-body failures before service composition", async () => {
    expect((await POST(request(JSON.stringify({ ownerDeleteSecret: secret }), "https://other.test"), context)).status).toBe(403);
    expect(getProductionServices).not.toHaveBeenCalled();
    expect((await POST(request(JSON.stringify({ ownerDeleteSecret: "x".repeat(9_000) })), context)).status).toBe(413);
    expect(getProductionServices).not.toHaveBeenCalled();
    expect((await POST(request(JSON.stringify({ ownerDeleteSecret: "too-short" })), context)).status).toBe(400);
    expect(getProductionServices).not.toHaveBeenCalled();
  });

  it("validates the owner secret after the bounded body and returns typed active or retired outcomes", async () => {
    const reconcileOwnerAuthority = vi.fn()
      .mockResolvedValueOnce({ status: "active" })
      .mockResolvedValueOnce({ status: "retired", reason: "expired" });
    getProductionServices.mockResolvedValue({ shares: { reconcileOwnerAuthority } });
    const active = await POST(request(JSON.stringify({ ownerDeleteSecret: secret })), context);
    expect(active.status).toBe(200);
    await expect(active.json()).resolves.toEqual({ ok: true, state: "active" });
    const retired = await POST(request(JSON.stringify({ ownerDeleteSecret: secret })), context);
    expect(retired.status).toBe(409);
    await expect(retired.json()).resolves.toMatchObject({ error: { code: "SHARE_CREATE_REPLAY_RETIRED", reason: "expired" } });
    expect(reconcileOwnerAuthority).toHaveBeenNthCalledWith(1, "stored-share-token-1234", secret, expect.any(Date));
  });
});
