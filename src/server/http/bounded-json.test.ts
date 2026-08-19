import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { assertBodylessRequest, hasExactRequestOrigin, readBoundedStructuredJson } from "./bounded-json";
import { parseShareCreateBody } from "./api";

const policy = { maxBytes: 16, invalidCode: "BODY_INVALID", tooLargeCode: "BODY_TOO_LARGE" } as const;

describe("bounded structured HTTP input", () => {
  it("rejects declared and streamed overflow before parsing", async () => {
    await expect(readBoundedStructuredJson(new Request("https://hm.test", { method: "POST", headers: { "content-length": "17" }, body: "{}" }), policy)).rejects.toThrow("BODY_TOO_LARGE");
    await expect(readBoundedStructuredJson(new Request("https://hm.test", { method: "POST", body: JSON.stringify({ value: "1234567890123456" }) }), policy)).rejects.toThrow("BODY_TOO_LARGE");
  });

  it("uses fatal UTF-8 and structured malformed-JSON rejection", async () => {
    await expect(readBoundedStructuredJson(new Request("https://hm.test", { method: "POST", body: Uint8Array.from([0xc3, 0x28]) }), policy)).rejects.toThrow("BODY_INVALID");
    await expect(readBoundedStructuredJson(new Request("https://hm.test", { method: "POST", body: "{" }), policy)).rejects.toThrow("BODY_INVALID");
    await expect(readBoundedStructuredJson(new Request("https://hm.test", { method: "POST", body: "{\"ok\":true}" }), policy)).resolves.toEqual({ ok: true });
  });

  it("enforces the bodyless session contract for content-length and actual bytes", async () => {
    await expect(assertBodylessRequest(new Request("https://hm.test", { method: "POST" }))).resolves.toBeUndefined();
    await expect(assertBodylessRequest(new Request("https://hm.test", { method: "POST", headers: { "content-length": "1" }, body: "x" }))).rejects.toThrow("SESSION_REQUEST_TOO_LARGE");
    await expect(assertBodylessRequest(new Request("https://hm.test", { method: "POST", headers: { "content-length": "invalid" }, body: "x" }))).rejects.toThrow("SESSION_REQUEST_INVALID");
    await expect(assertBodylessRequest(new Request("https://hm.test", { method: "POST", body: "x" }))).rejects.toThrow("SESSION_REQUEST_TOO_LARGE");
  });

  it("normalizes malformed and mismatched Origin to deterministic false", () => {
    expect(hasExactRequestOrigin(new Request("https://hm.test", { headers: { origin: "not a URL", host: "hm.test" } }))).toBe(false);
    expect(hasExactRequestOrigin(new Request("https://hm.test", { headers: { origin: "https://other.test", host: "hm.test" } }))).toBe(false);
    expect(hasExactRequestOrigin(new Request("https://hm.test", { headers: { origin: "https://hm.test", host: "internal", "x-forwarded-host": "hm.test" } }))).toBe(true);
  });

  it("locks the share create top-level object to exact bounded fields", async () => {
    const digest = "a".repeat(64);
    const payload = {
      schemaVersion: 3, title: "Fixture", tempo: { beatUnit: 4, dotted: false, bpm: 80 },
      key: { tonic: { step: "C", alter: 0 }, mode: "major" }, presetId: "standard",
      arrangementArtifactDigest: digest, effectiveChordTimelineDigest: digest,
      arrangement: { measures: [{ index: 0, lyricVerseIndex: 1, timeSignature: [4, 4], duration: [4, 1] }], tracks: [{ kind: "source-lead", label: "Lead", events: [] }] },
      lyrics: [], rightsShareConfirmed: true,
    };
    const request = { payload, rightsBasis: "self-authored", idempotencyKey: "request-key-0001" };
    await expect(parseShareCreateBody(request)).resolves.toMatchObject({ payload, rightsBasis: "self-authored", idempotencyKey: "request-key-0001" });
    await expect(parseShareCreateBody({ ...request, injected: true })).rejects.toThrow("SHARE_REQUEST_INVALID");
  });
});
