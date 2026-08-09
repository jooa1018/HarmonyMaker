import { describe, expect, it } from "vitest";
import { fraction } from "../fraction";
import { binaryDigest, canonicalJson, semanticDigest } from "./canonical";

describe("canonical digest codec", () => {
  it("uses NFC, UTF-16 key order, and canonical Fractions", () => {
    expect(canonicalJson({ z: fraction(2, 4), a: "e\u0301" })).toBe('{"a":"é","z":{"d":2,"n":1}}');
  });

  it("matches the standard SHA-256 byte fixture", async () => {
    expect(await binaryDigest(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await semanticDigest({ a: 1 })).toHaveLength(64);
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, 1.5, BigInt(1)])("rejects non-canonical value %s", (value) => {
    expect(() => canonicalJson({ value })).toThrow();
  });

  it("rejects sparse arrays and non-normalized fraction shapes", () => {
    expect(() => canonicalJson(Array(2))).toThrow("sparse");
    expect(() => canonicalJson({ n: 2, d: 4 })).toThrow("normalized");
  });
});
