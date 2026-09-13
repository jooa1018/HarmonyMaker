import { describe, expect, it } from "vitest";
import { parseArrangementChordPolicyMetadata } from "./arrangement-policy-metadata";

// Public serialization fixture, independent of any user music or workspace proof.
function fixture() {
  return {
    version: "hm-arrangement-chord-policy-v1",
    resolutionPolicy: { gapPolicy: "carry-until-next", initialPickup: "anticipate-first-chord" },
    spans: [{
      id: "pcs:pickup",
      range: {
        start: { performanceMeasureIndex: 0, offset: { n: 0, d: 1 } },
        end: { performanceMeasureIndex: 1, offset: { n: 0, d: 1 } },
      },
      symbol: "Bb",
      origin: { kind: "arrangement-policy", policy: "anticipate-first-chord", followingSourceChordEventId: "ch:following" },
    }],
  };
}

function expectRejected(value: unknown) {
  expect(() => parseArrangementChordPolicyMetadata(JSON.stringify(value)))
    .toThrow("MUSICXML_ARRANGEMENT_POLICY_METADATA_INVALID");
}

describe("arrangement policy metadata parser", () => {
  it.each(["carry-until-next", "block-gap"])("preserves valid %s export evidence exactly", (gapPolicy) => {
    const value = fixture();
    value.resolutionPolicy.gapPolicy = gapPolicy;
    expect(parseArrangementChordPolicyMetadata(JSON.stringify(value))).toEqual(value);
  });

  it.each([
    { label: "single-item carry array", gapPolicy: ["carry-until-next"] },
    { label: "single-item block array", gapPolicy: ["block-gap"] },
    { label: "object", gapPolicy: { value: "carry-until-next" } },
  ])("rejects a $label without coercing it into a policy string", ({ gapPolicy }) => {
    const value = fixture();
    expectRejected({ ...value, resolutionPolicy: { ...value.resolutionPolicy, gapPolicy } });
  });

  it("rejects zero spans instead of preserving an option with no policy evidence", () => {
    expectRejected({ ...fixture(), spans: [] });
  });

  it("rejects duplicate span IDs even when both ranges are individually valid", () => {
    const value = fixture();
    const second = {
      ...value.spans[0],
      range: {
        start: { performanceMeasureIndex: 1, offset: { n: 0, d: 1 } },
        end: { performanceMeasureIndex: 2, offset: { n: 0, d: 1 } },
      },
    };
    expectRejected({ ...value, spans: [value.spans[0], second] });
  });

  it("accepts exactly 64000 characters and rejects 64001 despite otherwise valid JSON", () => {
    const encoded = JSON.stringify(fixture());
    const atLimit = encoded + " ".repeat(64_000 - encoded.length);
    expect(atLimit).toHaveLength(64_000);
    expect(parseArrangementChordPolicyMetadata(atLimit)).toEqual(fixture());
    expect(() => parseArrangementChordPolicyMetadata(atLimit + " "))
      .toThrow("MUSICXML_ARRANGEMENT_POLICY_METADATA_INVALID");
  });

  it("rejects an unknown metadata version", () => {
    expectRejected({ ...fixture(), version: "hm-arrangement-chord-policy-v2" });
  });

  it.each(["root", "resolutionPolicy", "span", "origin"])("rejects extra keys at %s", (location) => {
    const value = fixture();
    const unknown = { silentlyApproved: true };
    if (location === "root") expectRejected({ ...value, ...unknown });
    else if (location === "resolutionPolicy") expectRejected({ ...value, resolutionPolicy: { ...value.resolutionPolicy, ...unknown } });
    else if (location === "span") expectRejected({ ...value, spans: [{ ...value.spans[0], ...unknown }] });
    else expectRejected({ ...value, spans: [{ ...value.spans[0], origin: { ...value.spans[0].origin, ...unknown } }] });
  });
});
