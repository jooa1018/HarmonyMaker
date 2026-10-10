import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createApiRequest } from "../http/request-context";
import { normalizeClientIp, resolveClientIp } from "./client-ip";
import { MemoryGovernanceStore } from "../persistence/memory-store.test-adapter";
import { QuotaAndIdempotencyService } from "./quota-core";
const context = createApiRequest("/api/session");
const request = (headers: Record<string, string>) => new Request("https://example.test/api/session", { headers });
afterEach(() => vi.restoreAllMocks());

describe("trusted single client IP", () => {
  it("uses the Vercel default and ignores attacker-supplied forwarding chains", () => {
    expect(resolveClientIp(request({ "x-real-ip": "192.0.2.7", "x-forwarded-for": "198.51.100.9, 203.0.113.2" }), context, { VERCEL: "1" })).toBe("192.0.2.7");
  });
  it("accepts only the explicitly configured header outside Vercel", () => {
    expect(resolveClientIp(request({ "x-client-ip": "192.0.2.8", "x-real-ip": "198.51.100.9" }), context, { TRUSTED_CLIENT_IP_HEADER: "X-Client-IP" })).toBe("192.0.2.8");
  });
  it.each([{}, { TRUSTED_CLIENT_IP_HEADER: "x-client-ip" }, { VERCEL: "1" }])("uses no fallback header when trusted evidence is absent", environment => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(resolveClientIp(request({ "x-forwarded-for": "192.0.2.7" }), context, environment)).toBeUndefined();
  });
  it.each(["x-forwarded-for", "Forwarded", "bad header"])("rejects unsafe header configuration %s", header => {
    expect(() => resolveClientIp(request({}), context, { TRUSTED_CLIENT_IP_HEADER: header })).toThrow("TRUSTED_CLIENT_IP_HEADER_INVALID");
  });
  it.each(["192.0.2.1, 198.51.100.1", "192.0.2.1:443", "[2001:db8::1]", "fe80::1%eth0", "private-token", ""])("rejects malformed header %s without logging it", value => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(resolveClientIp(request({ "x-real-ip": value }), context, { VERCEL: "1" })).toBeUndefined();
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ event: "client-ip-unavailable", requestId: context.requestId, path: context.path, reason: "invalid" });
    if (value) expect(log.mock.calls[0][0]).not.toContain(value);
  });
  it("canonicalizes IPv6 variants and IPv4-mapped IPv6 into the same quota identity", () => {
    expect(normalizeClientIp("2001:0DB8:0:0:0:0:0:1")).toBe("2001:db8::1");
    expect(normalizeClientIp("::ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(normalizeClientIp("::ffff:c000:201")).toBe("192.0.2.1");
  });
});

describe("separate unknown-IP global quotas", () => {
  it("allows a larger bounded global bucket without consuming known-IP or other operation buckets", async () => {
    const store = new MemoryGovernanceStore();
    const quota = new QuotaAndIdempotencyService(store, Uint8Array.from({ length: 32 }, () => 1));
    const now = new Date("2026-10-10T00:00:00.000Z");
    const consume = (ipAddress: string | undefined, policyKey = "test") => quota.consumeClientIpHourly({ ipAddress, policyKey, limit: 1, now });
    for (let i = 0; i < 100; i++) expect(await consume(undefined)).toBe(true);
    expect(await consume(undefined)).toBe(false);
    expect(await consume("192.0.2.1")).toBe(true);
    expect(await consume("192.0.2.1")).toBe(false);
    expect(await consume(undefined, "another-operation")).toBe(true);
    expect(await quota.consumeClientIpHourly({ ipAddress: undefined, policyKey: "test", limit: 1, now: new Date("2026-10-10T01:00:00.000Z") })).toBe(true);
  });
});


describe("IPv6 /64 quota grouping", () => {
  it("shares a bucket within /64 and separates adjacent prefixes", async () => {
    const quota = new QuotaAndIdempotencyService(new MemoryGovernanceStore(), new Uint8Array(32).fill(1));
    const consume = (ipAddress: string) => quota.consumeClientIpHourly({ ipAddress, policyKey: "test", limit: 1, now: new Date("2026-10-10T00:00:00Z") });
    expect(await consume("2001:db8:abcd:12::1")).toBe(true);
    expect(await consume("2001:0DB8:abcd:0012:ffff:ffff:ffff:ffff")).toBe(false);
    expect(await consume("2001:db8:abcd:13::1")).toBe(true);
    expect(quota.ipHash("::1")).toBe(quota.ipHash("::2"));
    expect(quota.ipHash("2001:db8::1")).toBe(quota.ipHash("2001:db8:0:0:1:2:3:4"));
    expect(quota.ipHash("2001:db8::1")).not.toBe(quota.ipHash("2001:db8:0:1::1"));
  });
  it("keeps IPv4 address granularity including mapped IPv6", async () => {
    const quota = new QuotaAndIdempotencyService(new MemoryGovernanceStore(), new Uint8Array(32).fill(1));
    const consume = (ipAddress: string) => quota.consumeClientIpHourly({ ipAddress, policyKey: "test", limit: 1, now: new Date("2026-10-10T00:00:00Z") });
    expect(await consume("192.0.2.1")).toBe(true);
    expect(await consume("::ffff:192.0.2.1")).toBe(false);
    expect(await consume("::ffff:c000:201")).toBe(false);
    expect(await consume("192.0.2.2")).toBe(true);
  });
});
