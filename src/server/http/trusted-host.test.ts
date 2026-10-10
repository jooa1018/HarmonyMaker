import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { hasExactRequestOrigin } from "./bounded-json";
import { requestHost } from "./trusted-host";

const request = (forwarded = "public.test") => new Request("https://internal.test", {
  headers: { host: "internal.test", origin: "https://public.test", "x-forwarded-host": forwarded },
});

describe("deployment-controlled forwarded host trust", () => {
  it("ignores spoofed forwarded authority by default", () => {
    expect(requestHost(request(), {})).toBe("internal.test");
    expect(hasExactRequestOrigin(request(), {})).toBe(false);
  });
  it("allows the configured proxy and Vercel defaults, with explicit opt-out", () => {
    expect(hasExactRequestOrigin(request(), { TRUST_FORWARDED_HOST: "1" })).toBe(true);
    expect(hasExactRequestOrigin(request(), { VERCEL: "1" })).toBe(true);
    expect(hasExactRequestOrigin(request(), { VERCEL: "1", TRUST_FORWARDED_HOST: "0" })).toBe(false);
    expect(hasExactRequestOrigin(request(), { VERCEL: "1", TRUST_FORWARDED_HOST: "invalid" })).toBe(false);
  });
  it.each(["public.test, attacker.test", "user@public.test", "public.test/path", "public.test#x", "public.test?x", "public.test\\x", "public.test:bad", ""]) (
    "fails closed for malformed trusted authority %s", (host) => {
      expect(requestHost(request(host), { TRUST_FORWARDED_HOST: "1" })).toBeUndefined();
      expect(hasExactRequestOrigin(request(host), { TRUST_FORWARDED_HOST: "1" })).toBe(false);
    },
  );
  it("falls back to Host only when the trusted header is absent", () => {
    const req = new Request("https://public.test", { headers: { host: "public.test", origin: "https://public.test" } });
    expect(hasExactRequestOrigin(req, { TRUST_FORWARDED_HOST: "1" })).toBe(true);
  });
  it("retains ports and IPv6 authorities", () => {
    const req = new Request("http://[::1]:3000", { headers: { host: "[::1]:3000", origin: "http://[::1]:3000" } });
    expect(hasExactRequestOrigin(req, {})).toBe(true);
  });
});
