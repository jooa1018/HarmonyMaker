import { describe, expect, it } from "vitest";

import { validateVendorInputRequest } from "./contracts";

describe("bounded provider needs-input runtime codec", () => {
  it("accepts exact safe numeric and UTF-8 boundaries", () => {
    expect(validateVendorInputRequest({
      kind: "vendor-specific", requestId: "r".repeat(128), schemaId: "s".repeat(128),
      payload: { integer: Number.MAX_SAFE_INTEGER, text: "x".repeat(4_096) },
    }, 1)).toMatchObject({ kind: "vendor-specific", payload: { integer: Number.MAX_SAFE_INTEGER } });
    expect(validateVendorInputRequest({
      kind: "confirm-page-order", requestId: "order", pageIndices: [2, 0, 1],
    }, 3)).toEqual({ kind: "confirm-page-order", requestId: "order", pageIndices: [2, 0, 1] });
  });

  it("rejects unsafe numeric values and non-finite provider values", () => {
    for (const value of [Number.MAX_SAFE_INTEGER + 1, 1e308, 1.5, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() => validateVendorInputRequest({
        kind: "vendor-specific", requestId: "r", schemaId: "s", payload: { value },
      }, 1)).toThrow("OMR_PROVIDER_CONTRACT_INVALID");
    }
  });

  it("applies request, schema, key, value, and aggregate limits in UTF-8 bytes", () => {
    const emoji = "😀";
    const invalid = [
      { kind: "select-instrument", requestId: emoji.repeat(64), choices: ["Voice"] },
      { kind: "vendor-specific", requestId: "r", schemaId: emoji.repeat(64), payload: {} },
      { kind: "vendor-specific", requestId: "r", schemaId: "s", payload: { [emoji.repeat(64)]: true } },
      { kind: "vendor-specific", requestId: "r", schemaId: "s", payload: { value: emoji.repeat(1_025) } },
      { kind: "vendor-specific", requestId: "r", schemaId: "s", payload: { first: "a".repeat(4_090), second: "b".repeat(4_090) } },
    ];
    for (const request of invalid) {
      expect(() => validateVendorInputRequest(request, 1)).toThrow("OMR_PROVIDER_CONTRACT_INVALID");
    }
  });

  it("rejects malformed page permutations, duplicate choices, and extra fields", () => {
    for (const request of [
      { kind: "confirm-page-order", requestId: "r", pageIndices: [0, 0] },
      { kind: "confirm-page-order", requestId: "r", pageIndices: [0, 2] },
      { kind: "select-instrument", requestId: "r", choices: ["Voice", "Voice"] },
      { kind: "select-instrument", requestId: "r", choices: ["Voice"], extra: true },
    ]) expect(() => validateVendorInputRequest(request, 2)).toThrow("OMR_PROVIDER_CONTRACT_INVALID");
  });
});
