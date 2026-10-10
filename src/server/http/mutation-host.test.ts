import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
const authorize = vi.hoisted(() => vi.fn(async (evidence: unknown) => evidence));
vi.mock("../substrate/services", () => ({ getProductionServices: async () => ({ sessions: { authorizeMutation: authorize } }) }));
import { authorizeMutation } from "./api";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("mutation authority at the HTTP boundary", () => {
  it.each(["0", "1"])("passes only the deployment-approved host (trust=%s)", async trust => {
    vi.stubEnv("TRUST_FORWARDED_HOST", trust);
    const request = new NextRequest("https://internal.test/api/shares", {
      headers: { host: "internal.test", origin: "https://public.test", "x-forwarded-host": "public.test" },
    });
    await authorizeMutation(request);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ host: trust === "1" ? "public.test" : "internal.test" }));
    expect(authorize.mock.calls[0][0]).not.toHaveProperty("forwardedHost");
  });
});
