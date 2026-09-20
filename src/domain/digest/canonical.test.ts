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

  it("preserves exact canonical output across large immutable strings and later changes", () => {
    const first = 'e\u0301\\"\n'.repeat(20_000), second = 'different\ud800'.repeat(10_000);
    for (const value of [first, first, second, first])
      expect(canonicalJson({ proof: value })).toBe('{"proof":' + JSON.stringify(value.normalize("NFC")) + '}');
    expect(() => canonicalJson({ proof: first, invalid: undefined })).toThrow();
    expect(() => canonicalJson({ proof: first, "é": 1, "e\u0301": 2 })).toThrow("collide");
  });

  it("hashes owned semantic bytes equally and isolates caller-owned binary input", async () => {
    const value = { proof: 'e\u0301\\"\n'.repeat(20_000) };
    expect(await semanticDigest(value)).toBe(await binaryDigest(new TextEncoder().encode(canonicalJson(value))));
    const bytes = new TextEncoder().encode("abc"), digest = binaryDigest(bytes);
    bytes.fill(0);
    expect(await digest).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, 1.5, BigInt(1)])("rejects non-canonical value %s", (value) => {
    expect(() => canonicalJson({ value })).toThrow();
  });

  it("rejects sparse arrays and non-normalized fraction shapes", () => {
    expect(() => canonicalJson(Array(2))).toThrow("sparse");
    expect(() => canonicalJson({ n: 2, d: 4 })).toThrow("normalized");
  });

  it("rejects NFC-equivalent object-key collisions before sorting regardless of insertion order", () => {
    const composedFirst = { "é": 1, "e\u0301": 2 };
    const decomposedFirst = { "e\u0301": 2, "é": 1 };
    expect(() => canonicalJson(composedFirst)).toThrow("collide after NFC normalization");
    expect(() => canonicalJson(decomposedFirst)).toThrow("collide after NFC normalization");
    expect(canonicalJson({ "e\u0301": 1, z: 2 })).toBe('{"z":2,"é":1}');
  });
});
